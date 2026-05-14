/**
 * search.js — AI-driven formula search.
 *
 * Two-phase: (1) Claude turns the query into a search plan, then
 * (2) we hit Supabase, fall back if no results, and re-rank by boost terms.
 */
import { json } from '../lib/responses.js';
import { sb } from '../lib/supabase.js';
import { claudeMessages, extractClaudeJson, CLAUDE_MODEL } from '../lib/claude.js';
import { dailyLimitFor } from '../config.js';
import { getDailyUsage, recordUsage } from '../auth.js';

const SEARCH_PLAN_SYSTEM = `You are a chemical-formula search planner. Output ONLY valid JSON with this exact shape:
{"must":["..."],"categories":["..."],"boost":["..."]}

- "must": ONE primary product noun in English that MUST appear in name (soap, shampoo, cream, disinfectant, detergent, polish, paint, fertilizer, toothpaste, lotion, gel, etc.). Most specific one. Never multiple alternatives.
- "categories": 1-3 best-fit from: hair_care, skin_care, body_care, personal_hygiene, color_cosmetics, cleaning, disinfectants, laundry, dishwashing, automotive, industrial, agriculture, food_beverage, pet_care, adhesives, coatings, specialty, oral_care, lip_care, paint_coating, glass_ceramics, hair_removal, home_fragrance, household, pool_water_treatment, water_treatment, boiler_cooling, metal_treatment, body_treatment, topical_analgesic, face_makeup, face_mask, massage, pest_control, skincare_anti_aging, skincare_brightening, stationery
- "boost": 2-5 modifier words that signal exact intent

EXAMPLES:
"شامبو طبيعي للشعر الجاف" -> {"must":["shampoo"],"categories":["hair_care"],"boost":["natural","dry","herbal"]}
"صابون معقم" -> {"must":["soap"],"categories":["personal_hygiene","disinfectants"],"boost":["antibacterial","antiseptic","sanitizer","disinfectant"]}
"معجون أسنان للأطفال" -> {"must":["toothpaste"],"categories":["oral_care"],"boost":["children","kids","baby"]}`;

/** Ask Claude for a search plan. Returns null on failure. */
async function claudePlan(query, env) {
  const res = await claudeMessages(env, {
    model: CLAUDE_MODEL,
    max_tokens: 250,
    system: SEARCH_PLAN_SYSTEM,
    messages: [{ role: 'user', content: query }],
  });
  if (!res.ok) return null;
  return extractClaudeJson(res.data);
}

export async function handleSearch(url, auth, env) {
  const query = (url.searchParams.get('q') || '').trim();
  if (!query) return json({ rows: [], error: 'empty' });

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

  // Step 1: Claude → search plan
  const plan = await claudePlan(query, env);
  if (!plan) return json({ rows: [], plan: null, error: 'claude_failed' }, 500);
  if (!plan.must?.length) return json({ rows: [], plan, error: 'no_must_term' });

  // Step 2: Supabase
  const must = String(plan.must[0] || '').replace(/[%_,()*\s]/g, '').trim();
  if (!must) return json({ rows: [], plan, error: 'empty_must' });

  const select =
    'id,name,name_en,category,sub_category,form_type,components,trust_score';
  let path = `/formulas?select=${select}&order=trust_score.desc&limit=80&or=(name.ilike.*${must}*,name_en.ilike.*${must}*)`;
  if (Array.isArray(plan.categories) && plan.categories.length) {
    const cats = plan.categories.map((c) => `"${String(c).replace(/"/g, '')}"`).join(',');
    path += `&category=in.(${cats})`;
  }

  const sbRes = await sb(env, path);
  if (!sbRes.ok) {
    return json(
      { error: 'supabase_error', plan, detail: (await sbRes.text()).slice(0, 300) },
      500
    );
  }
  let rows = await sbRes.json();
  if (!Array.isArray(rows)) rows = [];

  // Fallback: drop category filter
  if (rows.length === 0 && plan.categories?.length) {
    const fbPath = `/formulas?select=${select}&order=trust_score.desc&limit=80&or=(name.ilike.*${must}*,name_en.ilike.*${must}*)`;
    const fb = await sb(env, fbPath);
    if (fb.ok) {
      const j = await fb.json();
      if (Array.isArray(j)) rows = j;
    }
  }

  // Boost ranking
  const boost = (plan.boost || []).map((b) => String(b).toLowerCase()).filter(Boolean);
  const ranked = rows
    .map((r) => {
      const hay = `${r.name || ''} ${r.name_en || ''} ${r.sub_category || ''}`.toLowerCase();
      let score = 0;
      for (const b of boost) if (hay.includes(b)) score += 10;
      score += (r.trust_score || 0) / 10;
      return { ...r, _score: score };
    })
    .sort((a, b) => b._score - a._score);

  await recordUsage(auth.id, '/search', env);

  return json({
    query,
    plan,
    count: ranked.length,
    rows: ranked.slice(0, 24),
    usage: { used: used + 1, limit, plan: auth.plan },
  });
}
