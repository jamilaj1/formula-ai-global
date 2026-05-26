/**
 * search.js — AI-driven formula search.
 *
 * Two-phase: (1) Claude turns the query into a search plan, then
 * (2) we hit Supabase, fall back if no results, and re-rank by boost terms.
 */
import { json } from '../lib/responses.js';
// Phase 1.1 enabled RLS on `formulas` which denies anon SELECT, so the
// Worker now reads `formulas` via the service-role helper (sbService).
// service_role bypasses RLS by Supabase design — appropriate here because
// the Worker is server-side, never exposes the raw key to the client, and
// we still rate-limit + quota-cap the endpoint at the top.
import { sbService } from '../lib/supabase.js';
import { claudeCall, extractClaudeJson } from '../lib/claude.js';
import { buildCacheKey, cacheGet, cachePut } from '../lib/cache.js';
import { dailyLimitFor } from '../config.js';
import { getDailyUsage, recordUsage } from '../auth.js';
import { rateLimit, rateLimitResponse, clientIP } from '../lib/ratelimit.js';

const SEARCH_PLAN_SYSTEM = `You are a chemical-formula search planner. Output ONLY valid JSON with this exact shape:
{"must":["..."],"categories":["..."],"boost":["..."]}

- "must": ONE primary product noun in English that MUST appear in name (soap, shampoo, cream, disinfectant, detergent, polish, paint, fertilizer, toothpaste, lotion, gel, etc.). Most specific one. Never multiple alternatives.
- "categories": 1-3 best-fit from: hair_care, skin_care, body_care, personal_hygiene, color_cosmetics, cleaning, disinfectants, laundry, dishwashing, automotive, industrial, agriculture, food_beverage, pet_care, adhesives, coatings, specialty, oral_care, lip_care, paint_coating, glass_ceramics, hair_removal, home_fragrance, household, pool_water_treatment, water_treatment, boiler_cooling, metal_treatment, body_treatment, topical_analgesic, face_makeup, face_mask, massage, pest_control, skincare_anti_aging, skincare_brightening, stationery
- "boost": 2-5 modifier words that signal exact intent

EXAMPLES:
"شامبو طبيعي للشعر الجاف" -> {"must":["shampoo"],"categories":["hair_care"],"boost":["natural","dry","herbal"]}
"صابون معقم" -> {"must":["soap"],"categories":["personal_hygiene","disinfectants"],"boost":["antibacterial","antiseptic","sanitizer","disinfectant"]}
"معجون أسنان للأطفال" -> {"must":["toothpaste"],"categories":["oral_care"],"boost":["children","kids","baby"]}`;

/**
 * Ask Claude for a search plan.
 *
 * Cached per (system, query) for 24h — search plans are deterministic and
 * the same query from any user produces the same plan, so caching is
 * always safe here. Returns:
 *   - plan object on success (cached or fresh)
 *   - null on failure (caller treats as 'claude_failed')
 * Also returns the `meta` object the caller needs for recordUsage().
 *
 * @param {string} query
 * @param {object} env
 * @param {string} plan  user plan (for model selection on cache miss)
 * @returns {Promise<{plan: object|null, meta: object}>}
 */
async function claudePlan(query, env, plan) {
  const messages = [{ role: 'user', content: query }];
  const cacheKey = await buildCacheKey({
    model: '/search-plan',
    system: SEARCH_PLAN_SYSTEM,
    messages,
  });

  const cached = await cacheGet(env, cacheKey);
  if (cached) {
    return {
      plan: extractClaudeJson(cached),
      meta: {
        model: cached._model || null,
        input_tokens: 0,
        output_tokens: 0,
        est_cost_usd: 0,
        cache_hit: true,
      },
    };
  }

  const cr = await claudeCall(
    env,
    {
      max_tokens: 250,
      system: SEARCH_PLAN_SYSTEM,
      messages,
    },
    { plan }
  );
  if (!cr.ok) {
    return {
      plan: null,
      meta: { model: cr.model_used || null, status_code: cr.status || 500 },
    };
  }
  await cachePut(env, cacheKey, { ...cr.data, _model: cr.model_used });
  return {
    plan: extractClaudeJson(cr.data),
    meta: {
      model: cr.model_used,
      input_tokens:  cr.usage?.input_tokens  || 0,
      output_tokens: cr.usage?.output_tokens || 0,
      est_cost_usd:  cr.cost_usd             || 0,
      cache_hit:     false,
    },
  };
}

export async function handleSearch(url, auth, env, request) {
  const query = (url.searchParams.get('q') || '').trim();
  if (!query) return json({ rows: [], error: 'empty' });

  // ── Anti-scraping gate ───────────────────────────────────────────
  // 30 requests / 60 seconds, keyed by user-id when signed in or by IP
  // otherwise. Burst this and you get a clean 429 with Retry-After.
  const rlKey = auth?.id
    ? `search:user:${auth.id}`
    : `search:ip:${clientIP(request || { headers: new Headers() })}`;
  const rl = await rateLimit(env, { bucket: rlKey, limit: 30, window: 60 });
  if (!rl.ok) return rateLimitResponse(rl);

  const limit = dailyLimitFor(auth.plan);
  const used = await getDailyUsage(auth.id, env);
  if (used >= limit) {
    return json(
      {
        rows: [],
        count: 0,
        error: 'rate_limit_exceeded',
        detail: `Daily limit reached (${used}/${limit}). Upgrade or sign in for more.`,
        limit,
        used,
        plan: auth.plan,
      },
      429
    );
  }

  // Step 1: Claude → search plan (cached 24h per (system, query))
  const { plan, meta: planMeta } = await claudePlan(query, env, auth.plan);
  if (!plan) {
    // Record the failed call so we still see it in the cost report.
    await recordUsage(auth.id, '/search', env, planMeta);
    return json({ rows: [], plan: null, error: 'claude_failed' }, 500);
  }
  if (!plan.must?.length) {
    await recordUsage(auth.id, '/search', env, planMeta);
    return json({ rows: [], plan, error: 'no_must_term' });
  }

  // Step 2: build a candidate pool, then rank by RELEVANCE (not trust).
  // Keep the primary product noun but DO NOT strip spaces — turn them
  // into ilike wildcards so "hand wash" matches "Hand Wash"/"Handwash".
  const nounRaw = String(plan.must[0] || '').trim();
  const noun = nounRaw.replace(/[%_(),"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!noun) return json({ rows: [], plan, error: 'empty_must' });
  const nounLike = noun.split(' ').filter(Boolean).join('*');

  const select =
    'id,name,name_en,category,sub_category,form_type,components,trust_score';
  const baseFilter =
    `or=(name.ilike.*${nounLike}*,name_en.ilike.*${nounLike}*,sub_category.ilike.*${nounLike}*)`;
  let path = `/formulas?select=${select}&order=trust_score.desc&limit=120&${baseFilter}`;
  if (Array.isArray(plan.categories) && plan.categories.length) {
    const cats = plan.categories.map((c) => `"${String(c).replace(/"/g, '')}"`).join(',');
    path += `&category=in.(${cats})`;
  }

  const sbRes = await sbService(env, path);
  if (!sbRes.ok) {
    return json(
      { error: 'supabase_error', plan, detail: (await sbRes.text()).slice(0, 300) },
      500
    );
  }
  let rows = await sbRes.json();
  if (!Array.isArray(rows)) rows = [];

  // Fallback 1: same noun filter, drop category
  if (rows.length === 0 && plan.categories?.length) {
    const fb = await sbService(env, `/formulas?select=${select}&order=trust_score.desc&limit=120&${baseFilter}`);
    if (fb.ok) { const j = await fb.json(); if (Array.isArray(j)) rows = j; }
  }
  // Fallback 2: category-only pool (stay on-topic instead of empty)
  if (rows.length === 0 && plan.categories?.length) {
    const cats = plan.categories.map((c) => `"${String(c).replace(/"/g, '')}"`).join(',');
    const fb = await sbService(env, `/formulas?select=${select}&order=trust_score.desc&limit=120&category=in.(${cats})`);
    if (fb.ok) { const j = await fb.json(); if (Array.isArray(j)) rows = j; }
  }

  // ── Relevance ranking ──────────────────────────────────────────────
  // Topical match dominates; trust is only a small tiebreaker so generic
  // matches no longer outrank the formula the user actually asked for.
  const norm = (s) => String(s || '').toLowerCase();
  const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'with', 'to',
    'مع', 'من', 'في', 'عن', 'على', 'الى', 'هل']);
  const qTokens = [...new Set(
    norm(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w))
  )];
  const mustTokens = (plan.must || []).flatMap((m) => norm(m).split(/\s+/)).filter(Boolean);
  const boost = (plan.boost || []).map(norm).filter(Boolean);
  const planCats = (plan.categories || []).map(norm);
  const nounLc = norm(noun);

  let ranked = rows
    .map((r) => {
      const name = `${norm(r.name)} ${norm(r.name_en)}`;
      const comps = Array.isArray(r.components)
        ? r.components.map((c) => norm(c && (c.name_en || c.name))).join(' ')
        : '';
      const hay = `${name} ${norm(r.sub_category)} ${norm(r.category)} ${comps}`;
      let score = 0;
      if (nounLc && name.includes(nounLc)) score += 40;
      for (const b of boost) if (b && hay.includes(b)) score += 12;
      for (const m of mustTokens) if (m && name.includes(m)) score += 8;
      for (const t of qTokens) if (hay.includes(t)) score += 5;
      if (planCats.includes(norm(r.category))) score += 6;
      score += Math.min(5, (r.trust_score || 0) * 0.05);
      return { ...r, _score: score };
    })
    .filter((r) => r._score > 5)
    .sort((a, b) => b._score - a._score || (b.trust_score || 0) - (a.trust_score || 0));

  // Safety: never show "nothing" if we had candidate rows
  if (ranked.length === 0 && rows.length) {
    ranked = rows
      .map((r) => ({ ...r, _score: (r.trust_score || 0) * 0.05 }))
      .sort((a, b) => b._score - a._score);
  }

  // Record with the cost meta from the planning call (cache hit or live).
  await recordUsage(auth.id, '/search', env, planMeta);

  return json({
    query,
    plan,
    count: ranked.length,
    rows: ranked.slice(0, 24),
    usage: { used: used + 1, limit, plan: auth.plan },
  });
}
