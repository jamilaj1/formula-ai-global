/**
 * Formula AI Brain — unified Cloudflare Worker
 * ──────────────────────────────────────────────
 * Routes:
 *   GET  /                      → health check
 *   GET  /search?q=…            → AI-driven formula search (rate-limited)
 *   GET  /usage                 → return caller's daily search count + limit
 *   POST /chat                  → conversational AI with tool-use (Phase 3)
 *   GET  /chat/sessions         → list user's chat sessions
 *   GET  /chat/messages?session_id=…  → load full message history of a session
 *   POST /save_formula          → save a (possibly-modified) formula to user library (Phase 4)
 *   GET  /my_formulas           → list user's saved formulas
 *   POST /extract               → extract formulas from uploaded text/PDF via Claude (Phase 5)
 *   POST /discover              → harvest formulas from Semantic Scholar / PubMed / Lens / arXiv (Phase 12)
 *   GET  /discover/jobs         → list user's discovery jobs
 *   GET  /library               → list user's saved formulas (Phase 13)
 *   GET  /library/:id           → get one user formula full
 *   PUT  /library/:id           → update user formula
 *   DELETE /library/:id         → delete user formula
 *   GET  /prices                → list user's ingredient prices (Phase 14)
 *   POST /prices                → upsert an ingredient price
 *   DELETE /prices/:id          → delete a price
 *   POST /cost                  → calculate batch cost for a formula
 *   POST /scale                 → scale a formula to a target batch size (Phase 15)
 *   POST /safety                → Claude analyzes a formula's safety
 *   POST /lab                   → Claude predicts pH / viscosity / shelf life
 *   POST /paystack/checkout     → create Paystack transaction (global payments, Ghana-friendly)
 *   POST /paystack/webhook      → Paystack events → update profile.plan
 *   POST /stripe/checkout       → create Stripe checkout session (legacy fallback)
 *   POST /stripe/webhook        → Stripe events → update profile.plan
 *
 * Required environment variables (Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY      (secret) — Claude API
 *   SUPABASE_URL           (text)   — https://….supabase.co
 *   SUPABASE_ANON_KEY      (secret) — public anon key (for table reads)
 *   SUPABASE_SERVICE_KEY   (secret) — service-role key (for usage writes)
 *   STRIPE_SECRET_KEY      (secret) — sk_test_… or sk_live_…  (optional, only for /stripe/*)
 *   STRIPE_WEBHOOK_SECRET  (secret) — whsec_…                  (optional)
 *   STRIPE_PRICE_PRO       (text)   — price_… for Professional ($49/mo)
 *   STRIPE_PRICE_BIZ       (text)   — price_… for Business ($299/mo)
 *   STRIPE_PRICE_ENT       (text)   — price_… for Enterprise ($999/mo)
 */

const FREE_DAILY_LIMIT = 10;
const PAID_DAILY_LIMIT = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age':       '86400',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const url  = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/' || path === '/health') {
        return json({
          status: 'ok',
          service: 'Formula AI Brain v8',
          endpoints: [
            '/search', '/usage',
            '/chat', '/chat/sessions', '/chat/messages',
            '/save_formula', '/my_formulas',
            '/library', '/prices', '/cost', '/scale',
            '/extract',
            '/discover', '/discover/jobs',
            '/safety', '/lab',
            '/paystack/checkout', '/paystack/verify', '/paystack/webhook',
            '/stripe/checkout', '/stripe/webhook',
          ],
          phases: {
            1: 'search',
            2: 'auth+limits',
            3: 'chat',
            4: 'library',
            5: 'learn',
            12: 'discover (papers+patents)',
            13: 'library + cost + scale',
            14: 'paystack billing (global, Ghana-friendly)',
          },
        });
      }

      // Stripe webhook BEFORE auth check (Stripe signs its own requests)
      if (path === '/stripe/webhook' && request.method === 'POST') {
        return await handleStripeWebhook(request, env);
      }
      // Paystack webhook BEFORE auth check (Paystack signs its own requests)
      if (path === '/paystack/webhook' && request.method === 'POST') {
        return await handlePaystackWebhook(request, env);
      }

      // Resolve caller (authenticated user or anonymous IP)
      const auth = await resolveCaller(request, env);

      if (path === '/search') {
        return await handleSearch(url, auth, env);
      }
      if (path === '/usage') {
        return await handleUsage(auth, env);
      }
      if (path === '/chat' && request.method === 'POST') {
        return await handleChat(request, auth, env);
      }
      if (path === '/chat/sessions' && request.method === 'GET') {
        return await handleListSessions(auth, env);
      }
      if (path === '/chat/messages' && request.method === 'GET') {
        return await handleLoadMessages(url, auth, env);
      }
      if (path === '/save_formula' && request.method === 'POST') {
        return await handleSaveFormula(request, auth, env);
      }
      if (path === '/my_formulas' && request.method === 'GET') {
        return await handleMyFormulas(auth, env);
      }
      if (path === '/extract' && request.method === 'POST') {
        return await handleExtract(request, auth, env);
      }
      if (path === '/discover' && request.method === 'POST') {
        return await handleDiscover(request, auth, env);
      }
      if (path === '/discover/jobs' && request.method === 'GET') {
        return await handleListDiscoveryJobs(auth, env);
      }
      if (path === '/discover/debug' && request.method === 'GET') {
        return await handleDiscoverDebug(url, auth, env);
      }
      // Phase 13: Library
      if (path === '/library' && request.method === 'GET') {
        return await handleLibraryList(auth, env);
      }
      if (path.startsWith('/library/') && request.method === 'GET') {
        return await handleLibraryGet(path.slice(9), auth, env);
      }
      if (path.startsWith('/library/') && request.method === 'PUT') {
        return await handleLibraryUpdate(path.slice(9), request, auth, env);
      }
      if (path.startsWith('/library/') && request.method === 'DELETE') {
        return await handleLibraryDelete(path.slice(9), auth, env);
      }
      // Phase 14: Prices + Cost
      if (path === '/prices' && request.method === 'GET') {
        return await handlePricesList(auth, env);
      }
      if (path === '/prices' && request.method === 'POST') {
        return await handlePriceUpsert(request, auth, env);
      }
      if (path.startsWith('/prices/') && request.method === 'DELETE') {
        return await handlePriceDelete(path.slice(8), auth, env);
      }
      if (path === '/cost' && request.method === 'POST') {
        return await handleCost(request, auth, env);
      }
      // Phase 15: Scale
      if (path === '/scale' && request.method === 'POST') {
        return await handleScale(request, auth, env);
      }
      if (path === '/safety' && request.method === 'POST') {
        return await handleSafety(request, env);
      }
      if (path === '/lab' && request.method === 'POST') {
        return await handleLab(request, env);
      }
      if (path === '/stripe/checkout' && request.method === 'POST') {
        return await handleStripeCheckout(request, auth, env);
      }
      if (path === '/paystack/checkout' && request.method === 'POST') {
        return await handlePaystackCheckout(request, auth, env);
      }
      if (path === '/paystack/verify' && request.method === 'GET') {
        return await handlePaystackVerify(url, env);
      }
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (err) {
      return json({ error: 'unhandled', detail: err.message }, 500);
    }
  },
};

/* ─── Auth resolution ──────────────────────────────────────────── */

async function resolveCaller(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

  if (!token) return { kind: 'guest', id: `ip:${ip}`, plan: 'guest' };

  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
    });
    if (!r.ok) return { kind: 'guest', id: `ip:${ip}`, plan: 'guest' };
    const user = await r.json();

    // Fetch profile to get plan. Use SERVICE_KEY so RLS policies that lock
    // profiles to the row's owner can't silently downgrade paid users to
    // 'starter' when an internal lookup happens server-side.
    let plan = 'starter';
    try {
      const pr = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=plan`, {
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      });
      if (pr.ok) {
        const arr = await pr.json();
        if (arr[0]?.plan) plan = arr[0].plan;
      }
    } catch (_) { /* fall through with default 'starter' */ }

    return { kind: 'user', id: `user:${user.id}`, userId: user.id, email: user.email, plan };
  } catch (_) {
    return { kind: 'guest', id: `ip:${ip}`, plan: 'guest' };
  }
}

function dailyLimitFor(plan) {
  if (plan === 'guest')           return FREE_DAILY_LIMIT;
  if (plan === 'starter')         return FREE_DAILY_LIMIT * 2; // 20 for free signed-in
  if (plan === 'professional')    return PAID_DAILY_LIMIT;
  if (plan === 'business')        return PAID_DAILY_LIMIT * 5;     // 500
  if (plan === 'enterprise')      return 100000;                    // effectively unlimited
  return FREE_DAILY_LIMIT;
}

/* ─── Usage tracking ───────────────────────────────────────────── */

async function getDailyUsage(callerId, env) {
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const since = todayStart.toISOString();
  const url = `${env.SUPABASE_URL}/rest/v1/api_usage?select=id&caller_id=eq.${encodeURIComponent(callerId)}&created_at=gte.${since}`;
  try {
    const r = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        Prefer: 'count=exact',
      },
    });
    if (!r.ok) return 0;
    const range = r.headers.get('content-range') || '';
    const m = range.match(/\/(\d+|\*)$/);
    return m && m[1] !== '*' ? parseInt(m[1], 10) : 0;
  } catch (_) { return 0; }
}

async function recordUsage(callerId, endpoint, env) {
  // Best-effort; silent failure
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ caller_id: callerId, endpoint }),
    });
  } catch (_) {}
}

/* ─── /search ──────────────────────────────────────────────────── */

async function handleSearch(url, auth, env) {
  const query = (url.searchParams.get('q') || '').trim();
  if (!query) return json({ rows: [], error: 'empty' });

  const limit = dailyLimitFor(auth.plan);
  const used  = await getDailyUsage(auth.id, env);
  if (used >= limit) {
    return json({
      rows: [], count: 0,
      error: 'rate_limit_exceeded',
      detail: `Daily limit reached (${used}/${limit}). Upgrade or sign in for more.`,
      limit, used, plan: auth.plan,
    }, 429);
  }

  // Step 1: Claude → search plan
  const plan = await claudePlan(query, env);
  if (!plan) return json({ rows: [], plan: null, error: 'claude_failed' }, 500);
  if (!plan.must?.length) return json({ rows: [], plan, error: 'no_must_term' });

  // Step 2: Supabase
  const must = String(plan.must[0] || '').replace(/[%_,()*\s]/g, '').trim();
  if (!must) return json({ rows: [], plan, error: 'empty_must' });

  const select = 'id,name,name_en,category,sub_category,form_type,components,trust_score';
  let sbUrl = `${env.SUPABASE_URL}/rest/v1/formulas?select=${select}&order=trust_score.desc&limit=80&or=(name.ilike.*${must}*,name_en.ilike.*${must}*)`;
  if (Array.isArray(plan.categories) && plan.categories.length) {
    const cats = plan.categories.map(c => `"${String(c).replace(/"/g, '')}"`).join(',');
    sbUrl += `&category=in.(${cats})`;
  }

  const sbRes = await fetch(sbUrl, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
  });
  if (!sbRes.ok) return json({ error: 'supabase_error', plan, detail: (await sbRes.text()).slice(0, 300) }, 500);
  let rows = await sbRes.json();
  if (!Array.isArray(rows)) rows = [];

  // Fallback: drop category filter
  if (rows.length === 0 && plan.categories?.length) {
    const fb = await fetch(
      `${env.SUPABASE_URL}/rest/v1/formulas?select=${select}&order=trust_score.desc&limit=80&or=(name.ilike.*${must}*,name_en.ilike.*${must}*)`,
      { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } }
    );
    if (fb.ok) {
      const j = await fb.json();
      if (Array.isArray(j)) rows = j;
    }
  }

  // Boost ranking
  const boost = (plan.boost || []).map(b => String(b).toLowerCase()).filter(Boolean);
  const ranked = rows.map(r => {
    const hay = `${r.name || ''} ${r.name_en || ''} ${r.sub_category || ''}`.toLowerCase();
    let score = 0;
    for (const b of boost) if (hay.includes(b)) score += 10;
    score += (r.trust_score || 0) / 10;
    return { ...r, _score: score };
  }).sort((a, b) => b._score - a._score);

  await recordUsage(auth.id, '/search', env);

  return json({
    query, plan,
    count: ranked.length,
    rows: ranked.slice(0, 24),
    usage: { used: used + 1, limit, plan: auth.plan },
  });
}

async function claudePlan(query, env) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 250,
        system: `You are a chemical-formula search planner. Output ONLY valid JSON with this exact shape:
{"must":["..."],"categories":["..."],"boost":["..."]}

- "must": ONE primary product noun in English that MUST appear in name (soap, shampoo, cream, disinfectant, detergent, polish, paint, fertilizer, toothpaste, lotion, gel, etc.). Most specific one. Never multiple alternatives.
- "categories": 1-3 best-fit from: hair_care, skin_care, body_care, personal_hygiene, color_cosmetics, cleaning, disinfectants, laundry, dishwashing, automotive, industrial, agriculture, food_beverage, pet_care, adhesives, coatings, specialty, oral_care, lip_care, paint_coating, glass_ceramics, hair_removal, home_fragrance, household, pool_water_treatment, water_treatment, boiler_cooling, metal_treatment, body_treatment, topical_analgesic, face_makeup, face_mask, massage, pest_control, skincare_anti_aging, skincare_brightening, stationery
- "boost": 2-5 modifier words that signal exact intent

EXAMPLES:
"شامبو طبيعي للشعر الجاف" -> {"must":["shampoo"],"categories":["hair_care"],"boost":["natural","dry","herbal"]}
"صابون معقم" -> {"must":["soap"],"categories":["personal_hygiene","disinfectants"],"boost":["antibacterial","antiseptic","sanitizer","disinfectant"]}
"معجون أسنان للأطفال" -> {"must":["toothpaste"],"categories":["oral_care"],"boost":["children","kids","baby"]}`,
        messages: [{ role: 'user', content: query }],
      }),
    });
    if (!r.ok) return null;
    const cd = await r.json();
    const text = (cd.content?.[0]?.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    return JSON.parse(text);
  } catch (_) { return null; }
}

/* ─── /usage ────────────────────────────────────────────────────── */

async function handleUsage(auth, env) {
  const limit = dailyLimitFor(auth.plan);
  const used  = await getDailyUsage(auth.id, env);
  return json({
    kind: auth.kind, plan: auth.plan,
    limit, used,
    remaining: Math.max(0, limit - used),
    resetsAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
  });
}

/* ─── /safety ───────────────────────────────────────────────────── */

async function handleSafety(request, env) {
  let formula;
  try { formula = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!formula?.components?.length) return json({ error: 'missing_components' }, 400);

  const ingredients = formula.components
    .map(c => `${c.name_en} (${c.cas_number || 'no-CAS'}) ${c.percentage}%`)
    .join('; ');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        system: `You are a chemical safety expert. Analyze the given formula and output JSON:
{
  "overall_risk": "safe|caution|warning|dangerous",
  "ghs_classes": ["H315", ...],
  "regulatory_flags": [{"region":"EU","note":"..."},{"region":"US-FDA","note":"..."}],
  "warnings": [{"ingredient":"...","level":"caution","note":"..."}],
  "ppe_required": ["nitrile gloves","safety goggles", ...],
  "storage": "...",
  "summary_ar": "ملخص بالعربية..."
}
Output ONLY JSON, no prose.`,
        messages: [{ role: 'user', content: `Formula: ${formula.name_en || formula.name || 'unnamed'}\nIngredients: ${ingredients}\nForm type: ${formula.form_type || 'unknown'}` }],
      }),
    });
    if (!r.ok) return json({ error: 'claude_error', detail: (await r.text()).slice(0, 300) }, 500);
    const cd = await r.json();
    const text = (cd.content?.[0]?.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    let analysis;
    try { analysis = JSON.parse(text); } catch { return json({ error: 'parse_failed', raw: text.slice(0, 500) }, 500); }
    return json(analysis);
  } catch (err) {
    return json({ error: 'safety_failed', detail: err.message }, 500);
  }
}

/* ─── /lab ──────────────────────────────────────────────────────── */

async function handleLab(request, env) {
  let formula;
  try { formula = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!formula?.components?.length) return json({ error: 'missing_components' }, 400);

  const ingredients = formula.components
    .map(c => `${c.name_en} (${c.percentage}%)`)
    .join('; ');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 600,
        system: `You are a virtual chemistry lab. Predict the physical properties of the given formula. Output ONLY JSON:
{
  "ph_estimate": "5.5-6.5",
  "viscosity_cp": "2000-3000",
  "density_g_ml": "1.02",
  "appearance": "clear viscous liquid",
  "stability": "stable",
  "shelf_life_months": 24,
  "compatibility_notes": ["..."],
  "predicted_issues": []
}`,
        messages: [{ role: 'user', content: `Formula: ${formula.name_en || formula.name}\nIngredients: ${ingredients}\nForm type: ${formula.form_type || 'liquid'}` }],
      }),
    });
    if (!r.ok) return json({ error: 'claude_error' }, 500);
    const cd = await r.json();
    const text = (cd.content?.[0]?.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    let prediction;
    try { prediction = JSON.parse(text); } catch { return json({ error: 'parse_failed' }, 500); }
    return json(prediction);
  } catch (err) {
    return json({ error: 'lab_failed', detail: err.message }, 500);
  }
}

/* ─── /stripe/checkout ──────────────────────────────────────────── */

async function handleStripeCheckout(request, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'stripe_not_configured' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const planMap = {
    professional: env.STRIPE_PRICE_PRO,
    business:     env.STRIPE_PRICE_BIZ,
    enterprise:   env.STRIPE_PRICE_ENT,
  };
  const priceId = planMap[body.plan];
  if (!priceId) return json({ error: 'unknown_plan' }, 400);

  const origin = request.headers.get('Origin') || 'https://jamilformula.com';
  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    customer_email: auth.email,
    'metadata[user_id]': auth.userId,
    'metadata[plan]': body.plan,
    success_url: `${origin}/dashboard.html?checkout=success`,
    cancel_url:  `${origin}/pricing.html?checkout=cancel`,
  });

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!r.ok) return json({ error: 'stripe_error', detail: (await r.text()).slice(0, 300) }, 500);
  const session = await r.json();
  return json({ url: session.url, id: session.id });
}

/* ─── /stripe/webhook ───────────────────────────────────────────── */

async function handleStripeWebhook(request, env) {
  const body = await request.text();

  // Verify Stripe-Signature header (HMAC-SHA256 of `${timestamp}.${body}`).
  // Without this, anyone could POST a fake checkout.session.completed event
  // and upgrade themselves to enterprise without paying.
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response('webhook not configured', { status: 503 });
  }
  const sigHeader = request.headers.get('stripe-signature') || '';
  const sigOk = await verifyStripeSignature(body, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!sigOk) return new Response('invalid signature', { status: 401 });

  let event;
  try { event = JSON.parse(body); } catch { return new Response('invalid', { status: 400 }); }

  const type = event?.type || '';
  const obj  = event?.data?.object || {};

  if (type === 'checkout.session.completed' || type === 'customer.subscription.updated') {
    const userId = obj.metadata?.user_id || obj.subscription?.metadata?.user_id;
    const plan   = obj.metadata?.plan    || 'professional';
    if (userId) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ plan, stripe_customer_id: obj.customer || null }),
      });
    }
  }
  if (type === 'customer.subscription.deleted') {
    const userId = obj.metadata?.user_id;
    if (userId) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ plan: 'starter' }),
      });
    }
  }
  return new Response('ok', { status: 200 });
}

/* ─── /chat (Phase 3 — conversational AI with tool-use) ─────────── */

const CHAT_SYSTEM_PROMPT = `You are Formula AI, an expert chemical formulator. You have access to a database of 3,381 verified chemical formulas across 40 industries (cosmetics, cleaning, disinfectants, pharmaceuticals, automotive, agriculture, industrial, etc.).

CRITICAL RULES (NEVER violate):
1. **You MUST search the database before presenting any formula.** Do NOT invent ingredient lists, percentages, or CAS numbers from your own knowledge.
2. **NEVER embellish or change formula NAMES.** When you mention a formula to the user, you MUST use the EXACT name returned by search_formulas (the "name_en" field). Do not add adjectives, brand names, or descriptive prefixes that weren't in the result. Example:
   - search returned: "Hand Soap (Clear, Quality)" → present it as "Hand Soap (Clear, Quality)" — NOT "Herbal Essences Liquid Hand Soap" or "Premium Clear Hand Soap"
   - search returned: "Calcium Mineral Based Protection Complete Toothpaste" → present it exactly as is, do NOT shorten or rename
3. **All formula NAMES in the database are in English.** When the user asks in Arabic or any other language, you MUST translate the product type to its English equivalent before calling search_formulas.
   Examples:
   - "سائل تنظيف الغسيل" → search "laundry detergent" or "liquid detergent"
   - "شامبو طبيعي" → search "shampoo"
   - "كريم مرطب" → search "moisturizing cream" or "cream"
   - "معجون أسنان" → search "toothpaste"
   - "مطهر مستشفيات" → search "disinfectant" or "hospital disinfectant"
   - "صابون سائل" → search "liquid soap" or "soap"
   - "غسول يدين" → search "hand soap" or "hand wash"
   - "مزيل بقع" → search "stain remover"
   - "ملمع زجاج" → search "glass cleaner"
4. **Try multiple search variants if the first attempt returns 0 rows.** Try synonyms, single words, broader terms. Use category filters when helpful.
5. **If after 2-3 search attempts you still find nothing, tell the user honestly: "I couldn't find this exact type in the database (3,381 formulas). Would you like me to search a related category?"** Do NOT fabricate a formula.
6. **You may answer general chemistry questions** (what is X, how does Y work, why is Z used) from your expertise WITHOUT calling search_formulas — those are not "formula requests".
7. **When presenting search results, list them by their EXACT name. You may add a 1-line description in parentheses or after a dash, but the primary name must match the database exactly.** Translate the description to the user's language but keep the name in English.

Conversational flow:
- Talk like a senior chemist colleague — concise, professional, friendly.
- When user asks for a product type, ASK 1-2 clarifying questions FIRST (purpose, audience, budget, etc.). Don't dump lists.
- After clarification, ALWAYS call search_formulas with the English product noun. Present the top 2-3 matches conversationally with their trust scores. ASK which one to expand.
- When user picks one, call get_formula_details and present full ingredients (%, CAS, function), preparation steps, source.
- When user asks to MODIFY a formula, propose a chemically-sound substitute with clear reasoning. Show before/after.
- Respond in the SAME language the user wrote in (Arabic ↔ English). If mixed, follow the dominant language.
- Refuse politely if user asks for harmful/illegal formulations (drugs, explosives, weapons).

Tools:
- search_formulas(query, category?, limit?): query MUST be English. Tries name + name_en. Returns top matches by trust score.
- get_formula_details(formula_id): full row for one formula by UUID.
- save_modified_formula({parent_id?, name, category, components[], process_conditions?, notes?}): Save a modified formula to the user's library. Use ONLY after the user explicitly says they want to save the modified version (e.g. "save it", "احفظها", "save this version"). After saving, confirm with a short message including a tip on how to find it later.

Modification flow:
- When user asks to modify (replace ingredient, make it natural, scale up, etc.), propose the change in chat with full reasoning and the new ingredient table.
- ASK: "Do you want me to save this version to your library?"
- If yes, call save_modified_formula with the FULL new component list (every ingredient, balanced to ~100%) and the parent_id of the original formula.

Available categories (use these in the category parameter when filtering): hair_care, skin_care, body_care, personal_hygiene, color_cosmetics, cleaning, disinfectants, laundry, dishwashing, automotive, industrial, agriculture, food_beverage, pet_care, adhesives, coatings, specialty, oral_care, lip_care, paint_coating, glass_ceramics, hair_removal, home_fragrance, household, pool_water_treatment, water_treatment, boiler_cooling, metal_treatment, body_treatment, topical_analgesic, face_makeup, face_mask, massage, pest_control, skincare_anti_aging, skincare_brightening, stationery.

Trust the user — they're a working chemist or formulator. Be accurate and never bluff.`;

const CHAT_TOOLS = [
  {
    name: 'search_formulas',
    description: 'Search the chemical formulas database for matches. Returns top results sorted by trust score. Use this whenever the user asks about a product type or wants to find a formula. Query can be in English or Arabic.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Primary noun or product type (e.g. "shampoo", "hand sanitizer", "shampoo dry hair")' },
        category: { type: 'string', description: 'Optional category filter (hair_care, skin_care, disinfectants, cleaning, etc.)' },
        limit: { type: 'number', description: 'Max results (1-12, default 8)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_formula_details',
    description: 'Fetch the full ingredient list, percentages, CAS numbers, preparation steps and source for a single formula. Use AFTER the user has picked which formula they want to see.',
    input_schema: {
      type: 'object',
      properties: {
        formula_id: { type: 'string', description: 'UUID returned by search_formulas' },
      },
      required: ['formula_id'],
    },
  },
  {
    name: 'save_modified_formula',
    description: 'Save a modified formula to the user\'s personal library. Use this AFTER the user has explicitly approved a modification you proposed. The new formula keeps a reference to the parent (original) so we can show its origin.',
    input_schema: {
      type: 'object',
      properties: {
        parent_id:    { type: 'string', description: 'UUID of the original formula it was modified from (optional if creating a brand-new formula)' },
        name:         { type: 'string', description: 'Descriptive name including the modification, e.g. "Hand Sanitizer Gel — Triclosan replaced with Tea Tree Oil"' },
        category:     { type: 'string' },
        sub_category: { type: 'string' },
        form_type:    { type: 'string' },
        components:   {
          type: 'array',
          description: 'Full ingredient list with percentages summing to ~100%',
          items: {
            type: 'object',
            properties: {
              name_en:     { type: 'string' },
              cas_number:  { type: 'string' },
              percentage:  { type: 'number' },
              function:    { type: 'string' },
            },
            required: ['name_en', 'percentage'],
          },
        },
        process_conditions: { type: 'object', description: 'Optional: { order_of_addition: "..." }' },
        notes:        { type: 'string', description: 'Why this version was created (the user\'s original requirement)' },
      },
      required: ['name', 'components'],
    },
  },
];

async function executeChatTool(toolName, toolInput, env, auth) {
  if (toolName === 'save_modified_formula') {
    if (!auth || auth.kind !== 'user') {
      return { error: 'auth_required', detail: 'User must be signed in to save modified formulas.' };
    }
    if (!toolInput.name || !Array.isArray(toolInput.components) || !toolInput.components.length) {
      return { error: 'missing_fields' };
    }
    const payload = {
      user_id:       auth.userId,
      parent_id:     toolInput.parent_id || null,
      name:          String(toolInput.name).slice(0, 200),
      name_en:       String(toolInput.name).slice(0, 200),
      category:      toolInput.category || null,
      sub_category:  toolInput.sub_category || null,
      form_type:     toolInput.form_type || null,
      components:    toolInput.components,
      process_conditions: toolInput.process_conditions || {},
      properties:    toolInput.properties || {},
      trust_score:   80,
      notes:         toolInput.notes || null,
    };
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/user_formulas`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { error: 'db_error', detail: (await r.text()).slice(0, 200) };
    const arr = await r.json();
    return { saved: { id: arr[0].id, name: arr[0].name }, message: 'Formula saved to your library.' };
  }

  if (toolName === 'search_formulas') {
    const rawQuery = String(toolInput.query || '').trim();
    if (!rawQuery) return { error: 'empty_query', rows: [] };

    const limit = Math.min(Math.max(parseInt(toolInput.limit) || 8, 1), 12);
    const select = 'id,name,name_en,category,sub_category,form_type,trust_score,source_title,source_year';
    const hdrs = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };

    // Build a list of candidate search terms — every meaningful word, plus the full phrase.
    // We try each one until we get at least 2 hits. Stops short-circuit early.
    const stop = new Set(['the','a','an','for','with','of','in','to','and','or','on','from','high','low','quality','economical','natural','herbal','pure','best','good']);
    const words = rawQuery.toLowerCase().replace(/[%_,()*\-]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !stop.has(w));
    const variants = [];
    if (rawQuery.length >= 3) variants.push(rawQuery);
    for (const w of words) if (!variants.includes(w)) variants.push(w);

    const seen = new Set();
    const all = [];
    let attemptedCategoryFallback = false;

    for (const v of variants) {
      const safe = v.replace(/[%_,()*]/g, '').trim();
      if (!safe) continue;
      let url = `${env.SUPABASE_URL}/rest/v1/formulas?select=${select}&order=trust_score.desc&limit=${limit}&or=(name.ilike.*${encodeURIComponent(safe)}*,name_en.ilike.*${encodeURIComponent(safe)}*)`;
      if (toolInput.category) url += `&category=eq.${encodeURIComponent(toolInput.category)}`;
      const r = await fetch(url, { headers: hdrs });
      if (!r.ok) continue;
      const rows = await r.json();
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!seen.has(row.id)) { seen.add(row.id); all.push(row); }
      }
      if (all.length >= Math.max(3, limit / 2)) break;  // good enough
    }

    // If still nothing AND a category was passed, retry without category
    if (all.length === 0 && toolInput.category) {
      attemptedCategoryFallback = true;
      for (const v of variants.slice(0, 3)) {
        const safe = v.replace(/[%_,()*]/g, '').trim();
        if (!safe) continue;
        const url = `${env.SUPABASE_URL}/rest/v1/formulas?select=${select}&order=trust_score.desc&limit=${limit}&or=(name.ilike.*${encodeURIComponent(safe)}*,name_en.ilike.*${encodeURIComponent(safe)}*)`;
        const r = await fetch(url, { headers: hdrs });
        if (!r.ok) continue;
        const rows = await r.json();
        if (Array.isArray(rows)) for (const row of rows) {
          if (!seen.has(row.id)) { seen.add(row.id); all.push(row); }
        }
        if (all.length >= 2) break;
      }
    }

    return {
      rows: all.slice(0, limit),
      count: all.length,
      tried_variants: variants,
      category_fallback_used: attemptedCategoryFallback,
    };
  }

  if (toolName === 'get_formula_details') {
    const id = String(toolInput.formula_id || '').trim();
    if (!id) return { error: 'missing_id' };
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/formulas?id=eq.${id}&select=*`,
      { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } }
    );
    if (!r.ok) return { error: 'db_error' };
    const arr = await r.json();
    if (!arr.length) return { error: 'not_found' };
    return { formula: arr[0] };
  }

  return { error: 'unknown_tool' };
}

async function handleChat(request, auth, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const userMessage = String(body.message || '').trim();
  if (!userMessage) return json({ error: 'empty_message' }, 400);

  // Daily limit shared with /search
  const limit = dailyLimitFor(auth.plan);
  const used  = await getDailyUsage(auth.id, env);
  if (used >= limit) {
    return json({
      error: 'rate_limit_exceeded',
      detail: `Daily limit reached (${used}/${limit}). Upgrade or sign in for more.`,
      limit, used, plan: auth.plan,
    }, 429);
  }

  // Resolve session: create new if none provided
  let sessionId = body.session_id || null;
  if (!sessionId) {
    sessionId = await createChatSession(auth, userMessage.slice(0, 60), env);
    if (!sessionId) return json({ error: 'session_create_failed' }, 500);
  }

  // Load existing message history (Claude needs full context)
  const history = await loadChatHistory(sessionId, env);

  // Save the new user message
  await saveChatMessage(sessionId, 'user', { text: userMessage }, env);

  // Build messages array for Claude (each turn = role + content blocks)
  const messages = [
    ...history.map(m => claudeMessageFromRow(m)),
    { role: 'user', content: userMessage },
  ];

  // Tool-use loop (max 5 rounds to avoid runaway)
  let formulaRefs = [];
  let finalText = '';
  let stopReason = null;

  for (let round = 0; round < 5; round++) {
    const cr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1500,
        system: CHAT_SYSTEM_PROMPT,
        tools: CHAT_TOOLS,
        messages,
      }),
    });
    if (!cr.ok) {
      const errText = (await cr.text()).slice(0, 400);
      return json({ error: 'claude_error', detail: errText }, 500);
    }
    const cd = await cr.json();
    stopReason = cd.stop_reason;

    // Extract any text and any tool_use blocks
    const blocks = cd.content || [];
    const textBlocks = blocks.filter(b => b.type === 'text');
    const toolUseBlocks = blocks.filter(b => b.type === 'tool_use');

    if (textBlocks.length) {
      finalText = textBlocks.map(b => b.text).join('\n').trim();
    }

    if (stopReason !== 'tool_use' || !toolUseBlocks.length) {
      // Final answer reached
      messages.push({ role: 'assistant', content: blocks });
      break;
    }

    // Append assistant message with tool calls
    messages.push({ role: 'assistant', content: blocks });

    // Execute every tool call and append tool_result blocks
    const toolResults = [];
    for (const tu of toolUseBlocks) {
      const result = await executeChatTool(tu.name, tu.input, env, auth);
      // Track formula references for the frontend
      if (tu.name === 'search_formulas' && Array.isArray(result.rows)) {
        formulaRefs.push(...result.rows.map(r => ({ id: r.id, name: r.name_en || r.name, trust: r.trust_score })));
      }
      if (tu.name === 'get_formula_details' && result.formula) {
        formulaRefs.push({ id: result.formula.id, name: result.formula.name_en || result.formula.name, trust: result.formula.trust_score, full: true });
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  // Save assistant final message
  await saveChatMessage(sessionId, 'assistant', { text: finalText, formula_refs: formulaRefs }, env);

  // Count chat as 1 unit of usage (same bucket as /search)
  await recordUsage(auth.id, '/chat', env);

  return json({
    session_id: sessionId,
    reply: finalText,
    formula_refs: formulaRefs,
    usage: { used: used + 1, limit, plan: auth.plan },
  });
}

function claudeMessageFromRow(row) {
  // row.content stored as { text, formula_refs?, tool_blocks? }
  if (row.role === 'user') return { role: 'user', content: row.content?.text || '' };
  if (row.role === 'assistant') return { role: 'assistant', content: row.content?.text || '' };
  return null;
}

async function createChatSession(auth, title, env) {
  try {
    const payload = { title: (title || 'New chat').slice(0, 80) };
    if (auth.kind === 'user') payload.user_id = auth.userId;
    else payload.guest_id = auth.id;
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/chat_sessions`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return null;
    const arr = await r.json();
    return arr[0]?.id || null;
  } catch { return null; }
}

async function loadChatHistory(sessionId, env) {
  // Only load user/assistant turns (skip raw tool blocks — Claude rebuilds them per call)
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/chat_messages?session_id=eq.${sessionId}&role=in.(user,assistant)&select=role,content,created_at&order=created_at.asc&limit=40`;
    const r = await fetch(url, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

async function saveChatMessage(sessionId, role, content, env) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ session_id: sessionId, role, content }),
    });
  } catch {}
}

async function handleListSessions(auth, env) {
  if (auth.kind !== 'user') return json({ sessions: [] });
  try {
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/chat_sessions?user_id=eq.${auth.userId}&select=id,title,created_at,updated_at&order=updated_at.desc&limit=50`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    );
    if (!r.ok) return json({ sessions: [] });
    return json({ sessions: await r.json() });
  } catch { return json({ sessions: [] }); }
}

async function handleLoadMessages(url, auth, env) {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) return json({ error: 'missing_session_id' }, 400);
  // Verify ownership for users; guests can load any session id they hold (best-effort)
  if (auth.kind === 'user') {
    const own = await fetch(
      `${env.SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${sessionId}&user_id=eq.${auth.userId}&select=id`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    );
    if (!own.ok) return json({ error: 'forbidden' }, 403);
    const arr = await own.json();
    if (!arr.length) return json({ error: 'not_found' }, 404);
  }
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/chat_messages?session_id=eq.${sessionId}&select=role,content,created_at&order=created_at.asc&limit=200`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  if (!r.ok) return json({ messages: [] });
  return json({ session_id: sessionId, messages: await r.json() });
}

/* ─── /save_formula (Phase 4) ───────────────────────────────────── */

async function handleSaveFormula(request, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  if (!body.name || !Array.isArray(body.components) || !body.components.length) {
    return json({ error: 'missing_fields', detail: 'name and components[] are required' }, 400);
  }

  const payload = {
    user_id: auth.userId,
    parent_id: body.parent_id || null,
    name: String(body.name).slice(0, 200),
    name_en: body.name_en ? String(body.name_en).slice(0, 200) : null,
    category: body.category || null,
    sub_category: body.sub_category || null,
    form_type: body.form_type || null,
    description: body.description || null,
    components: body.components,
    process_conditions: body.process_conditions || {},
    properties: body.properties || {},
    trust_score: parseInt(body.trust_score) || 80,
    notes: body.notes || null,
  };

  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/user_formulas`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return json({ error: 'save_failed', detail: (await r.text()).slice(0, 300) }, 500);
  const arr = await r.json();
  return json({ saved: arr[0] });
}

async function handleMyFormulas(auth, env) {
  if (auth.kind !== 'user') return json({ formulas: [] });
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_formulas?user_id=eq.${auth.userId}&select=id,name,name_en,category,trust_score,parent_id,created_at,updated_at&order=updated_at.desc&limit=100`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  if (!r.ok) return json({ formulas: [] });
  return json({ formulas: await r.json() });
}

/* ─── /extract (Phase 5) ────────────────────────────────────────── */

async function handleExtract(request, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const text  = String(body.text || '').trim();
  const title = String(body.title || 'Untitled book').slice(0, 200);
  const author = body.author ? String(body.author).slice(0, 120) : null;
  const year   = parseInt(body.year) || null;

  if (text.length < 200) return json({ error: 'text_too_short', detail: 'Need at least 200 characters of book content' }, 400);
  if (text.length > 60000) return json({ error: 'text_too_long', detail: 'Max 60,000 chars per extract call. Split larger books into chunks.' }, 400);

  // Step 1: register the upload
  let bookId = null;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/uploaded_books`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: auth.userId,
        title, author, year,
        file_size_bytes: text.length,
        status: 'processing',
      }),
    });
    if (r.ok) {
      const arr = await r.json();
      bookId = arr[0]?.id || null;
    }
  } catch {}

  // Step 2: ask Claude to extract structured formulas
  const extractPrompt = `You are a chemistry-formula extraction system.
Given the following book/document text, extract every chemical formulation you find. Output ONLY a JSON array, no prose.
Each item must have this exact shape:
{
  "name": "english product name",
  "category": "one of: hair_care, skin_care, body_care, personal_hygiene, color_cosmetics, cleaning, disinfectants, laundry, dishwashing, automotive, industrial, agriculture, food_beverage, pet_care, adhesives, coatings, specialty, oral_care, lip_care, paint_coating, glass_ceramics, hair_removal, home_fragrance, household, pool_water_treatment, water_treatment, boiler_cooling, metal_treatment, body_treatment, topical_analgesic, face_makeup, face_mask, massage, pest_control, skincare_anti_aging, skincare_brightening, stationery",
  "form_type": "liquid|gel|cream|powder|paste|aerosol|tablet|other",
  "components": [
    {"name_en":"Sodium Laureth Sulfate","cas_number":"68585-34-2","percentage":12.0,"function":"surfactant"},
    ...
  ],
  "process_conditions": {"order_of_addition":"1. Heat water to 70C... 2. Add SLES..."},
  "properties": {"ph":"5.5-6.5","viscosity":"3000 cP"}
}
Rules:
- Only include formulas where percentages sum approximately to 100% (±5%).
- Skip mentions/discussions that aren't actual recipes.
- Return [] if nothing found.
- Cap at 30 formulas per response.`;

  let extracted = [];
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 8000,
        system: extractPrompt,
        messages: [{ role: 'user', content: `BOOK TITLE: ${title}\nAUTHOR: ${author || 'unknown'}\n\n--- BOOK TEXT ---\n${text}` }],
      }),
    });
    if (r.ok) {
      const cd = await r.json();
      const raw = (cd.content?.[0]?.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      try { extracted = JSON.parse(raw); } catch { extracted = []; }
      if (!Array.isArray(extracted)) extracted = [];
    }
  } catch (err) {
    if (bookId) await markBookFailed(bookId, err.message, env);
    return json({ error: 'claude_failed', detail: err.message }, 500);
  }

  // Step 3: insert each formula into public.formulas with attribution
  let inserted = 0;
  const skipped = [];
  for (const f of extracted) {
    if (!f.name || !Array.isArray(f.components) || !f.components.length) {
      skipped.push({ name: f.name || '?', reason: 'missing_fields' });
      continue;
    }
    const total = f.components.reduce((s, c) => s + (parseFloat(c.percentage) || 0), 0);
    if (total < 95 || total > 105) {
      skipped.push({ name: f.name, reason: `unbalanced_${total.toFixed(1)}%` });
      continue;
    }
    try {
      const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/formulas`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          name: f.name,
          name_en: f.name,
          category: f.category || 'specialty',
          sub_category: f.sub_category || null,
          form_type: f.form_type || 'liquid',
          components: f.components,
          process_conditions: f.process_conditions || {},
          properties: f.properties || {},
          trust_score: 78,
          source_title: title,
          source_author: author,
          source_year: year,
          uploaded_book_id: bookId,
          added_by_user_id: auth.userId,
        }),
      });
      if (ins.ok) inserted++;
      else skipped.push({ name: f.name, reason: 'db_insert_failed' });
    } catch (err) {
      skipped.push({ name: f.name, reason: err.message });
    }
  }

  // Step 4: mark book done
  if (bookId) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/uploaded_books?id=eq.${bookId}`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status: 'done', formulas_extracted: inserted }),
    });
  }

  return json({
    book_id: bookId,
    found: extracted.length,
    inserted,
    skipped,
    preview: extracted.slice(0, 3),
  });
}

async function markBookFailed(bookId, errorMessage, env) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/uploaded_books?id=eq.${bookId}`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status: 'failed', error_message: String(errorMessage).slice(0, 500) }),
    });
  } catch {}
}

/* ─── /discover (Phase 12 — academic + patent harvester) ───────── */

const DISCOVER_PROVIDERS = ['semantic_scholar', 'pubmed', 'lens', 'arxiv'];

async function handleDiscover(request, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  let query = String(body.query || '').trim();
  if (!query) return json({ error: 'empty_query' }, 400);

  // Cap query length — providers reject huge queries silently
  if (query.length > 200) {
    query = query.slice(0, 200);
  }
  // If user pasted multiple example queries (we detect by lots of words), focus on the first 6
  const words = query.split(/\s+/);
  if (words.length > 8) {
    query = words.slice(0, 8).join(' ');
  }

  const sources = Array.isArray(body.sources) && body.sources.length
    ? body.sources.filter(s => DISCOVER_PROVIDERS.includes(s))
    : DISCOVER_PROVIDERS;
  const maxPerSource = Math.min(Math.max(parseInt(body.max_per_source) || 8, 1), 20);

  // Register the job
  let jobId = null;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/discovery_jobs`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: auth.userId,
        query,
        sources,
        status: 'running',
      }),
    });
    if (r.ok) jobId = (await r.json())[0]?.id || null;
  } catch {}

  // Fan out to all sources in parallel
  const searches = await Promise.allSettled(sources.map(src => searchProvider(src, query, maxPerSource)));
  const allResults = [];
  searches.forEach((s, i) => {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) {
      for (const item of s.value) allResults.push({ ...item, provider: sources[i] });
    }
  });

  // Dedupe by external_id (DOI / patent number / arxiv id)
  const seen = new Set();
  const dedup = allResults.filter(r => {
    const key = `${r.provider}:${r.external_id || r.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Persist each source we found
  const sourceRows = [];
  for (const r of dedup) {
    try {
      const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/discovered_sources?on_conflict=provider,external_id`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify({
          job_id: jobId,
          source_type: r.source_type,
          provider: r.provider,
          external_id: r.external_id || null,
          title: r.title,
          authors: r.authors || null,
          abstract: r.abstract || null,
          year: r.year || null,
          journal_or_office: r.journal_or_office || null,
          url: r.url || null,
        }),
      });
      if (ins.ok) {
        const arr = await ins.json();
        if (arr[0]) sourceRows.push(arr[0]);
      }
    } catch {}
  }

  // For each source with a non-empty abstract, ask Claude to extract formulas
  let totalExtracted = 0;
  const extractionDetails = [];
  for (const src of sourceRows) {
    if (!src.abstract || src.abstract.length < 200) continue;
    try {
      const formulas = await extractFromAbstract(src, env);
      if (Array.isArray(formulas) && formulas.length) {
        let inserted = 0;
        for (const f of formulas) {
          if (!f.name || !Array.isArray(f.components) || !f.components.length) continue;
          // Skip if no component has a numeric percentage at all
          const hasPct = f.components.some(c => Number.isFinite(parseFloat(c.percentage)) && parseFloat(c.percentage) > 0);
          if (!hasPct) continue;

          // Auto-balance: if components don't sum to ~100, add water as remainder
          let total = f.components.reduce((s, c) => s + (parseFloat(c.percentage) || 0), 0);
          let comps = [...f.components];
          if (total < 95) {
            const remainder = 100 - total;
            comps.push({
              name_en: 'Water (Aqua)',
              cas_number: '7732-18-5',
              percentage: parseFloat(remainder.toFixed(2)),
              function: 'solvent',
            });
            total = 100;
          } else if (total > 105) {
            // Skip if oversaturated
            continue;
          }

          const completeness = f.completeness === 'complete' ? 'complete'
                             : f.completeness === 'partial' ? 'partial'
                             : (Math.abs(100 - total) < 1 ? 'complete' : 'partial');
          const trustScore = completeness === 'complete' ? 75 : 60;

          try {
            const ok = await fetch(`${env.SUPABASE_URL}/rest/v1/formulas`, {
              method: 'POST',
              headers: {
                apikey: env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              },
              body: JSON.stringify({
                name: f.name,
                name_en: f.name,
                category: f.category || 'specialty',
                form_type: f.form_type || 'liquid',
                components: comps,
                process_conditions: { ...(f.process_conditions || {}), completeness },
                trust_score: trustScore,
                source_title: src.title,
                source_author: src.authors,
                source_year: src.year,
                source_url: src.url,
                discovered_source_id: src.id,
                added_by_user_id: auth.userId,
              }),
            });
            if (ok.ok) inserted++;
          } catch {}
        }
        totalExtracted += inserted;
        extractionDetails.push({ source_id: src.id, title: src.title, found: formulas.length, inserted });
        // Mark the source as having formulas
        if (inserted > 0) {
          try {
            await fetch(`${env.SUPABASE_URL}/rest/v1/discovered_sources?id=eq.${src.id}`, {
              method: 'PATCH',
              headers: {
                apikey: env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              },
              body: JSON.stringify({ has_formula: true, formulas_found: inserted }),
            });
          } catch {}
        }
      }
    } catch {}
  }

  // Mark job done
  if (jobId) {
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/discovery_jobs?id=eq.${jobId}`, {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status: 'done',
          results_found: dedup.length,
          formulas_extracted: totalExtracted,
        }),
      });
    } catch {}
  }

  return json({
    job_id: jobId,
    sources_searched: sources,
    results_found: dedup.length,
    formulas_extracted: totalExtracted,
    by_source: countBy(dedup.map(r => r.provider)),
    details: extractionDetails.slice(0, 10),
  });
}

function countBy(arr) {
  const m = {};
  for (const k of arr) m[k] = (m[k] || 0) + 1;
  return m;
}

async function handleListDiscoveryJobs(auth, env) {
  if (auth.kind !== 'user') return json({ jobs: [] });
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/discovery_jobs?user_id=eq.${auth.userId}&select=id,query,sources,status,results_found,formulas_extracted,created_at&order=created_at.desc&limit=50`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  if (!r.ok) return json({ jobs: [] });
  return json({ jobs: await r.json() });
}

// Diagnostic endpoint — runs ONE Europe PMC search + ONE Claude extraction,
// returns every intermediate result so we can see exactly where things drop.
async function handleDiscoverDebug(url, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);
  const query = (url.searchParams.get('q') || 'WHO alcohol-based handrub formulation').trim();

  const out = { query, steps: [] };

  // 1. Europe PMC search
  const epmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=3&resultType=core`;
  let papers = [];
  try {
    const r = await fetch(epmcUrl, { headers: { Accept: 'application/json' } });
    out.steps.push({ step: '1_search', status: r.status, ok: r.ok });
    if (r.ok) {
      const data = await r.json();
      papers = data.resultList?.result || [];
      out.steps.push({ step: '2_results', count: papers.length, sample: papers.slice(0, 2).map(p => ({
        title: p.title,
        pmcid: p.pmcid,
        isOpenAccess: p.isOpenAccess,
        has_abstract: !!p.abstractText,
      })) });
    }
  } catch (e) {
    out.steps.push({ step: '1_search_failed', error: e.message });
  }

  if (!papers.length) {
    out.steps.push({ step: '3_no_papers', note: 'Europe PMC returned 0 results for this query' });
    return json(out);
  }

  // 2. Try to fetch full text from first Open Access paper
  const openAccess = papers.find(p => p.pmcid && p.isOpenAccess === 'Y');
  let textForClaude = '';
  if (openAccess) {
    out.steps.push({ step: '4_fulltext_target', pmcid: openAccess.pmcid });
    try {
      // Try multiple URL formats since Europe PMC's spec varies.
      const idWithPrefix = String(openAccess.pmcid);
      const idNoPrefix = idWithPrefix.replace(/^PMC/i, '');
      const tries = [
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${idWithPrefix}/fullTextXML`,
        `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/${idNoPrefix}/fullTextXML`,
        `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/${idWithPrefix}/fullTextXML`,
      ];
      let ftRes = null;
      let ftUrl = '';
      for (const u of tries) {
        const r = await fetch(u);
        out.steps.push({ step: '5_fulltext_try', url: u, status: r.status });
        if (r.ok) { ftRes = r; ftUrl = u; break; }
      }
      if (!ftRes) {
        out.steps.push({ step: '5_fulltext_status', status: 'all_failed' });
        textForClaude = `${openAccess.title}\n\n${openAccess.abstractText || ''}`;
        throw new Error('all_failed');
      }
      out.steps.push({ step: '5_fulltext_status', status: ftRes.status, ok: ftRes.ok, url: ftUrl });
      if (ftRes.ok) {
        const xml = await ftRes.text();
        const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        textForClaude = `${openAccess.title}\n\n${openAccess.abstractText || ''}\n\n--- FULL TEXT EXCERPT ---\n${text.slice(0, 5000)}`;
        out.steps.push({ step: '6_fulltext_length', chars: text.length });
      } else {
        textForClaude = `${openAccess.title}\n\n${openAccess.abstractText || ''}`;
      }
    } catch (e) {
      out.steps.push({ step: '5_fulltext_failed', error: e.message });
      textForClaude = `${openAccess.title}\n\n${openAccess.abstractText || ''}`;
    }
  } else {
    out.steps.push({ step: '4_no_open_access', note: 'No Open Access paper in results' });
    const first = papers[0];
    textForClaude = `${first.title}\n\n${first.abstractText || ''}`;
  }

  // 3. Send to Claude
  try {
    const cr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2500,
        system: `Extract chemical formulations from the text. Output ONLY a JSON array. Each item must have "name", "category", "form_type", "components" (array with name_en + percentage), "completeness" ("complete" or "partial"). If no formulation, return []. Be generous — partial recipes count.`,
        messages: [{ role: 'user', content: textForClaude.slice(0, 8000) }],
      }),
    });
    out.steps.push({ step: '7_claude_status', status: cr.status, ok: cr.ok });
    if (cr.ok) {
      const cd = await cr.json();
      const raw = cd.content?.[0]?.text || '';
      out.steps.push({ step: '8_claude_raw', text: raw.slice(0, 2000) });
      try {
        const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim());
        out.steps.push({ step: '9_parsed', count: Array.isArray(parsed) ? parsed.length : 0, sample: Array.isArray(parsed) ? parsed.slice(0, 2) : null });
      } catch (e) {
        out.steps.push({ step: '9_parse_failed', error: e.message });
      }
    }
  } catch (e) {
    out.steps.push({ step: '7_claude_failed', error: e.message });
  }

  return json(out);
}

/* ─── Provider clients ──────────────────────────────────────────── */

async function searchProvider(provider, query, max) {
  try {
    if (provider === 'semantic_scholar') return await searchSemanticScholar(query, max);
    if (provider === 'pubmed')           return await searchPubMed(query, max);
    if (provider === 'arxiv')            return await searchArxiv(query, max);
    if (provider === 'lens')             return await searchLens(query, max);
  } catch (_) {}
  return [];
}

// Semantic Scholar — papers (free, no auth needed)
async function searchSemanticScholar(query, max) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${max}&fields=title,authors,abstract,year,venue,externalIds,url`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return [];
  const data = await r.json();
  return (data.data || []).filter(p => p.abstract).map(p => ({
    source_type: 'paper',
    external_id: p.externalIds?.DOI || p.externalIds?.CorpusId || p.paperId,
    title: p.title || 'Untitled',
    authors: (p.authors || []).map(a => a.name).filter(Boolean).join(', ').slice(0, 400),
    abstract: p.abstract,
    year: p.year || null,
    journal_or_office: p.venue || null,
    url: p.url || (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : null),
  }));
}

// PubMed — medical/chemistry papers via Europe PMC unified API
// Europe PMC indexes PubMed + PMC + Agricola + patents, and returns full-text URLs directly
async function searchPubMed(query, max) {
  // Filter for papers that actually have full text available + exclude case reports / reviews
  // (those rarely contain actual formulations with percentages).
  // PUB_TYPE excludes letters, comments, case reports, etc.
  const filteredQuery = `(${query}) AND HAS_FT:Y AND IN_EPMC:Y NOT (PUB_TYPE:"case-reports" OR PUB_TYPE:"editorial" OR PUB_TYPE:"comment" OR PUB_TYPE:"letter")`;
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(filteredQuery)}&format=json&pageSize=${max * 2}&resultType=core`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return [];
  const data = await r.json();
  let results = data.resultList?.result || [];

  // Fallback: if no full-text papers found, try without filter
  if (!results.length) {
    const fallback = await fetch(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=${max}&resultType=core`,
      { headers: { Accept: 'application/json' } }
    );
    if (fallback.ok) {
      const fd = await fallback.json();
      results = fd.resultList?.result || [];
    }
  }
  if (!results.length) return [];

  // Dedupe by title (Europe PMC often returns the same paper twice: once from PubMed, once from PMC)
  const seenTitles = new Set();
  const dedupResults = results.filter(res => {
    const titleKey = (res.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 100);
    if (seenTitles.has(titleKey)) return false;
    seenTitles.add(titleKey);
    return true;
  }).slice(0, max);

  const items = dedupResults.map(res => ({
    source_type: 'paper',
    external_id: res.doi ? `DOI:${res.doi}` : (res.pmid ? `PMID:${res.pmid}` : (res.pmcid || res.id)),
    title: (res.title || 'Untitled').replace(/\s+/g, ' ').trim().slice(0, 400),
    authors: (res.authorString || '').slice(0, 400),
    abstract: res.abstractText || null,
    year: res.pubYear ? parseInt(res.pubYear) : null,
    journal_or_office: res.journalTitle || res.bookOrReportDetails?.publisher || null,
    url: res.doi ? `https://doi.org/${res.doi}` : (res.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${res.pmid}/` : null),
    _source_kind: res.source,
    _pmcid: res.pmcid || null,
    _is_oa: res.isOpenAccess === 'Y',
    _has_ft: res.hasFullText === 'Y' || res.hasPDF === 'Y',
    _in_epmc: res.inEPMC === 'Y',
  })).filter(p => p.abstract || p._pmcid);

  // For up to 5 papers with PMC id IN Europe PMC, fetch full text
  // Try MULTIPLE URL formats since Europe PMC's API spec is inconsistent.
  const withPmc = items.filter(it => it._pmcid && it._in_epmc).slice(0, 5);
  await Promise.allSettled(withPmc.map(async it => {
    const idWithPrefix = String(it._pmcid);
    const idNoPrefix = idWithPrefix.replace(/^PMC/i, '');
    // CONFIRMED WORKING FORMAT: /{pmcid_with_PMC_prefix}/fullTextXML — no /PMC/ source path needed.
    const candidates = [
      `https://www.ebi.ac.uk/europepmc/webservices/rest/${idWithPrefix}/fullTextXML`,
      `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/${idNoPrefix}/fullTextXML`,
    ];
    let ftRes = null;
    let okUrl = null;
    for (const url of candidates) {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/xml' } });
        if (r.ok) { ftRes = r; okUrl = url; break; }
      } catch (_) {}
    }
    if (!ftRes) return;
    try {
      const xml = await ftRes.text();
      const text = xml
        .replace(/<\?xml[^>]*\?>/g, '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      // Take 10K-char slice rich in formulation keywords
      const slice = sliceAroundKeywords(text, [
        'formulation', 'composition', 'preparation', 'ingredients',
        'materials and methods', 'recipe', 'excipients',
        '%', 'w/w', 'w/v', 'percentage', 'mg/ml', 'mass fraction',
      ], 10000);
      if (slice && slice.length > 600) {
        it.abstract = (it.abstract || it.title) + '\n\n--- FULL TEXT EXCERPT ---\n' + slice;
      }
    } catch {}
  }));

  return items.filter(it => it.abstract);
}

// Helper: pick the most useful 8K slice from full text by finding keyword density
function sliceAroundKeywords(text, keywords, maxLen) {
  if (!text || text.length <= maxLen) return text;
  const lower = text.toLowerCase();
  let bestPos = 0;
  let bestScore = 0;
  for (let i = 0; i < text.length; i += 1000) {
    const window = lower.slice(i, i + 4000);
    let score = 0;
    for (const k of keywords) {
      const m = window.match(new RegExp(k, 'g'));
      if (m) score += m.length;
    }
    if (score > bestScore) { bestScore = score; bestPos = i; }
  }
  return text.slice(Math.max(0, bestPos - 500), bestPos + maxLen);
}

// arXiv — preprints (free)
async function searchArxiv(query, max) {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=${max}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const xml = await r.text();
  const entries = xml.split('<entry>').slice(1);
  return entries.map(e => {
    const t = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/\s+/g, ' ').trim();
    const ab = (e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/\s+/g, ' ').trim();
    const id = (e.match(/<id>([^<]+)<\/id>/) || [])[1];
    const pub = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    const auths = [...e.matchAll(/<name>([^<]+)<\/name>/g)].map(m => m[1]);
    return {
      source_type: 'preprint',
      external_id: id ? id.split('/').pop() : null,
      title: t || 'Untitled',
      authors: auths.join(', ').slice(0, 400),
      abstract: ab || null,
      year: pub ? parseInt(pub.slice(0, 4)) : null,
      journal_or_office: 'arXiv',
      url: id || null,
    };
  }).filter(p => p.abstract);
}

// The Lens — patents (free public endpoint, very limited; fall back gracefully)
async function searchLens(query, max) {
  // Note: Lens.org's public scholarly API requires a token. We use Google Patents Public Datasets via a
  // best-effort proxy. If neither works, return [] silently.
  try {
    // Try patents.google.com via DuckDuckGo HTML (rate-limited; intentionally lightweight)
    const url = `https://api.crossref.org/works?query=${encodeURIComponent('patent ' + query)}&rows=${max}&filter=type:patent`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.message?.items || []).map(it => ({
      source_type: 'patent',
      external_id: it.DOI || (it.URL || '').split('/').pop(),
      title: (it.title?.[0] || 'Untitled patent').slice(0, 400),
      authors: ((it.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean).join(', ')).slice(0, 400),
      abstract: it.abstract || null,
      year: it.created?.['date-parts']?.[0]?.[0] || null,
      journal_or_office: it.publisher || 'Patent',
      url: it.URL || null,
    })).filter(p => p.abstract);
  } catch {
    return [];
  }
}

/* ─── Claude extraction from abstract ──────────────────────────── */

async function extractFromAbstract(src, env) {
  const prompt = `You are a chemistry-formula extraction system. You aggressively extract every chemical formulation hinted at in scientific text — papers, patents, methods sections.

YOUR JOB: For every formulation in the text, output one JSON object. Be GENEROUS — partial recipes are valuable. Only return [] if the text is purely theoretical with no ingredients mentioned at all.

Output ONLY a JSON array (no prose, no markdown fence). Each item:
{
  "name": "english product name from the text (e.g. 'WHO alcohol-based handrub formulation I')",
  "category": "one of: hair_care, skin_care, body_care, personal_hygiene, color_cosmetics, cleaning, disinfectants, laundry, dishwashing, automotive, industrial, agriculture, food_beverage, pet_care, adhesives, coatings, specialty, oral_care, water_treatment, pharmaceutical",
  "form_type": "liquid|gel|cream|powder|paste|aerosol|tablet|emulsion|other",
  "components": [
    {"name_en":"Ethanol","cas_number":"64-17-5","percentage":80.0,"function":"active"}
  ],
  "completeness": "complete|partial",
  "process_conditions": {"order_of_addition":"..."}
}

When to extract (be generous):
1. **Concrete recipe with %s**: extract as "complete" if sums to 95-105%, else "partial".
2. **Some ingredients with %s, others named without %**: extract as "partial". For each ingredient WITHOUT a %, estimate using typical industry values (e.g. surfactants 5-15%, preservatives 0.3-0.8%, fragrance 0.1-0.5%, water as remainder).
3. **Only ingredients named (no %s at all)**: STILL extract as "partial" — use typical % for each. The user is a chemist who can refine later.
4. **Multiple variants in one paper**: extract each as a separate formula.

Always:
- Use the actual product name from the text. Never invent brand names.
- Components must have name_en and percentage (estimate if not explicit). cas_number and function are optional but include when known.
- Cap at 5 formulas per response.
- Aim for components that sum to roughly 100%. If they're under, add water as remainder.

ONLY return [] if:
- The text is pure theory/review/policy with zero ingredients named
- The text discusses unrelated chemistry (e.g. theoretical kinetics, microbiology only)

Examples:

Text: "We tested the WHO formulation I containing ethanol 80% v/v, glycerol 1.45% v/v, hydrogen peroxide 0.125% v/v, water to 100%"
→ ONE formula: complete, 4 components (Ethanol 80, Glycerol 1.45, H2O2 0.125, Water 18.425)

Text: "Carbopol-based antiseptic gel containing chlorhexidine digluconate and triethanolamine was prepared..."
→ ONE formula: partial. Estimate: Carbopol 0.7%, Chlorhexidine 2%, Triethanolamine 0.7%, Water 96.6%

Text: "We studied antibiotic resistance in hospital staff."
→ [] (no formulation)

Be helpful — better to extract a partial formula a chemist can refine than to reject everything.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2500,
        system: prompt,
        messages: [{ role: 'user', content: `TITLE: ${src.title}\n\nABSTRACT:\n${src.abstract.slice(0, 6000)}` }],
      }),
    });
    if (!r.ok) return [];
    const cd = await r.json();
    const txt = (cd.content?.[0]?.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/* ─── /library (Phase 13) ───────────────────────────────────────── */

async function handleLibraryList(auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_formulas?user_id=eq.${auth.userId}&select=id,name,name_en,category,sub_category,form_type,trust_score,parent_id,notes,created_at,updated_at&order=updated_at.desc&limit=200`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  if (!r.ok) return json({ formulas: [] });
  return json({ formulas: await r.json() });
}

async function handleLibraryGet(id, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);
  if (!id) return json({ error: 'missing_id' }, 400);
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_formulas?id=eq.${id}&user_id=eq.${auth.userId}&select=*`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  if (!r.ok) return json({ error: 'db_error' }, 500);
  const arr = await r.json();
  if (!arr.length) return json({ error: 'not_found' }, 404);
  return json({ formula: arr[0] });
}

async function handleLibraryUpdate(id, request, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  const allowed = {};
  for (const k of ['name', 'name_en', 'category', 'sub_category', 'form_type', 'description', 'components', 'process_conditions', 'properties', 'trust_score', 'notes']) {
    if (k in body) allowed[k] = body[k];
  }
  if (!Object.keys(allowed).length) return json({ error: 'no_fields' }, 400);

  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_formulas?id=eq.${id}&user_id=eq.${auth.userId}`,
    {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(allowed),
    }
  );
  if (!r.ok) return json({ error: 'update_failed' }, 500);
  const arr = await r.json();
  return json({ updated: arr[0] });
}

async function handleLibraryDelete(id, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_formulas?id=eq.${id}&user_id=eq.${auth.userId}`,
    {
      method: 'DELETE',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    }
  );
  if (!r.ok) return json({ error: 'delete_failed' }, 500);
  return json({ deleted: true });
}

/* ─── /prices + /cost (Phase 14) ────────────────────────────────── */

async function handlePricesList(auth, env) {
  if (auth.kind !== 'user') return json({ prices: [] });
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/ingredient_prices?user_id=eq.${auth.userId}&select=*&order=ingredient_name.asc&limit=500`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  if (!r.ok) return json({ prices: [] });
  return json({ prices: await r.json() });
}

async function handlePriceUpsert(request, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body.ingredient_name || !body.price_per_kg) {
    return json({ error: 'missing_fields' }, 400);
  }
  const payload = {
    user_id: auth.userId,
    ingredient_name: String(body.ingredient_name).slice(0, 200),
    cas_number: body.cas_number || null,
    price_per_kg: parseFloat(body.price_per_kg),
    currency: body.currency || 'USD',
    supplier: body.supplier || null,
    notes: body.notes || null,
  };
  // Upsert on (user_id, lower(ingredient_name))
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/ingredient_prices?on_conflict=user_id,ingredient_name`,
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(payload),
    }
  );
  if (!r.ok) return json({ error: 'save_failed', detail: (await r.text()).slice(0, 300) }, 500);
  const arr = await r.json();
  return json({ saved: arr[0] });
}

async function handlePriceDelete(id, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/ingredient_prices?id=eq.${id}&user_id=eq.${auth.userId}`,
    {
      method: 'DELETE',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    }
  );
  if (!r.ok) return json({ error: 'delete_failed' }, 500);
  return json({ deleted: true });
}

// POST /cost — body: { formula_id?, components?, batch_kg?, currency? }
// Returns: { batch_kg, currency, total_cost, cost_per_kg, breakdown[], missing[] }
async function handleCost(request, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  let components = Array.isArray(body.components) ? body.components : null;
  if (!components && body.formula_id) {
    // Try both formulas (public) and user_formulas
    const pub = await fetch(
      `${env.SUPABASE_URL}/rest/v1/formulas?id=eq.${body.formula_id}&select=components`,
      { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } }
    );
    if (pub.ok) {
      const arr = await pub.json();
      if (arr[0]) components = arr[0].components;
    }
    if (!components) {
      const own = await fetch(
        `${env.SUPABASE_URL}/rest/v1/user_formulas?id=eq.${body.formula_id}&user_id=eq.${auth.userId}&select=components`,
        { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
      );
      if (own.ok) {
        const arr = await own.json();
        if (arr[0]) components = arr[0].components;
      }
    }
  }
  if (!Array.isArray(components) || !components.length) {
    return json({ error: 'no_components' }, 400);
  }

  const batchKg = parseFloat(body.batch_kg) || 1;
  const currency = String(body.currency || 'USD').slice(0, 5);

  // Load user prices keyed by lowercased name
  const pr = await fetch(
    `${env.SUPABASE_URL}/rest/v1/ingredient_prices?user_id=eq.${auth.userId}&select=ingredient_name,cas_number,price_per_kg,currency&limit=2000`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  const priceList = pr.ok ? await pr.json() : [];
  const byName = new Map();
  const byCas  = new Map();
  for (const p of priceList) {
    byName.set(String(p.ingredient_name).toLowerCase(), p);
    if (p.cas_number) byCas.set(p.cas_number, p);
  }

  const breakdown = [];
  const missing = [];
  let total = 0;
  for (const c of components) {
    const name = String(c.name_en || c.name || '').trim();
    const pct  = parseFloat(c.percentage) || 0;
    if (!name || pct <= 0) continue;

    const massKg = (pct / 100) * batchKg;
    const price  = (c.cas_number && byCas.get(c.cas_number)) || byName.get(name.toLowerCase());
    if (price) {
      const cost = massKg * parseFloat(price.price_per_kg);
      total += cost;
      breakdown.push({
        name,
        percentage: pct,
        mass_kg: parseFloat(massKg.toFixed(4)),
        price_per_kg: parseFloat(price.price_per_kg),
        cost: parseFloat(cost.toFixed(4)),
        currency: price.currency,
      });
    } else {
      missing.push({ name, percentage: pct, mass_kg: parseFloat(massKg.toFixed(4)) });
    }
  }

  return json({
    batch_kg: batchKg,
    currency,
    total_cost: parseFloat(total.toFixed(4)),
    cost_per_kg: parseFloat((total / batchKg).toFixed(4)),
    breakdown,
    missing,
    coverage_pct: components.length ? Math.round((breakdown.length / (breakdown.length + missing.length)) * 100) : 0,
  });
}

/* ─── /scale (Phase 15) ─────────────────────────────────────────── */

// POST /scale — body: { formula_id?, components?, target_kg, unit? ('kg'|'g'|'L'|'mL') }
async function handleScale(request, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  let components = Array.isArray(body.components) ? body.components : null;
  if (!components && body.formula_id) {
    const pub = await fetch(
      `${env.SUPABASE_URL}/rest/v1/formulas?id=eq.${body.formula_id}&select=components,name,form_type`,
      { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } }
    );
    if (pub.ok) {
      const arr = await pub.json();
      if (arr[0]) components = arr[0].components;
    }
    if (!components && auth.kind === 'user') {
      const own = await fetch(
        `${env.SUPABASE_URL}/rest/v1/user_formulas?id=eq.${body.formula_id}&user_id=eq.${auth.userId}&select=components,name,form_type`,
        { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
      );
      if (own.ok) {
        const arr = await own.json();
        if (arr[0]) components = arr[0].components;
      }
    }
  }
  if (!Array.isArray(components) || !components.length) {
    return json({ error: 'no_components' }, 400);
  }

  const targetKg = parseFloat(body.target_kg);
  if (!Number.isFinite(targetKg) || targetKg <= 0) {
    return json({ error: 'invalid_target_kg' }, 400);
  }
  const unit = String(body.unit || 'kg').toLowerCase();
  const conversion = unit === 'g' ? 1000 : unit === 'mg' ? 1000000 : unit === 'l' ? 1 : unit === 'ml' ? 1000 : 1;

  const scaled = components.map(c => {
    const pct = parseFloat(c.percentage) || 0;
    const massKg = (pct / 100) * targetKg;
    return {
      name_en: c.name_en || c.name || '',
      cas_number: c.cas_number || null,
      function: c.function || null,
      percentage: pct,
      mass_kg: parseFloat(massKg.toFixed(4)),
      [`mass_${unit}`]: parseFloat((massKg * conversion).toFixed(4)),
    };
  });

  const totalPct = components.reduce((s, c) => s + (parseFloat(c.percentage) || 0), 0);

  return json({
    target_kg: targetKg,
    unit,
    total_percentage: parseFloat(totalPct.toFixed(2)),
    balance_check: Math.abs(totalPct - 100) < 1 ? 'balanced' : `off by ${(totalPct - 100).toFixed(2)}%`,
    components: scaled,
  });
}

/* ─── /paystack/checkout (global payments, Ghana-friendly) ───────── */

async function handlePaystackCheckout(request, auth, env) {
  if (auth.kind !== 'user') return json({ error: 'auth_required' }, 401);
  if (!env.PAYSTACK_SECRET_KEY) {
    return json({ error: 'paystack_not_configured', detail: 'Set PAYSTACK_SECRET_KEY in Worker secrets.' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  // Plan codes from Paystack dashboard + amount in pesewas (1 GHS = 100 pesewas).
  // Paystack requires `amount` even when a `plan` is provided. If both are sent
  // and the plan is valid, Paystack uses the plan's price and the amount becomes
  // a sanity-check fallback.
  //
  // CURRENCY NOTE: This merchant account only supports GHS. Pricing is displayed
  // in USD on the site (≈ 1 USD = 12 GHS, May 2026) with a GHS disclosure shown
  // to customers. To switch to true USD billing later, contact Paystack support
  // to enable USD on the merchant account, then change `currency` to 'USD' and
  // amount to cents (e.g. 2500 = $25).
  const planMap = {
    professional: { code: env.PAYSTACK_PLAN_PRO, amount: 30000,  currency: 'GHS' },  // $25 ≈ GHS 300
    business:     { code: env.PAYSTACK_PLAN_BIZ, amount: 60000,  currency: 'GHS' },  // $50 ≈ GHS 600
    enterprise:   { code: env.PAYSTACK_PLAN_ENT, amount: 150000, currency: 'GHS' },  // $125 ≈ GHS 1,500
  };
  const plan = planMap[body.plan];
  if (!plan) return json({ error: 'unknown_plan' }, 400);

  const origin = request.headers.get('Origin') || 'https://jamilformula.com';

  const payload = {
    email:        auth.email,
    amount:       plan.amount,    // required by Paystack, in pesewas
    currency:     plan.currency,
    callback_url: `${origin}/dashboard.html?paystack=success`,
    metadata: {
      user_id:  auth.userId,
      plan:     body.plan,
      origin:   origin,
    },
  };
  if (plan.code) payload.plan = plan.code;  // attach subscription plan if configured

  const r = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    return json({ error: 'paystack_error', detail: (await r.text()).slice(0, 300) }, 500);
  }
  const data = await r.json();
  if (!data.status) {
    return json({ error: 'paystack_failed', detail: data.message || 'Unknown error' }, 500);
  }

  return json({
    url:         data.data.authorization_url,
    reference:   data.data.reference,
    access_code: data.data.access_code,
  });
}

// Verify a transaction (useful after user lands on callback_url)
async function handlePaystackVerify(url, env) {
  const reference = url.searchParams.get('reference');
  if (!reference) return json({ error: 'missing_reference' }, 400);
  if (!env.PAYSTACK_SECRET_KEY) return json({ error: 'paystack_not_configured' }, 503);

  const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
  });
  if (!r.ok) return json({ error: 'verify_failed' }, 500);
  const data = await r.json();
  return json({
    success: !!data.status && data.data?.status === 'success',
    status:  data.data?.status,
    amount:  data.data?.amount,
    currency: data.data?.currency,
    customer_email: data.data?.customer?.email,
    paid_at: data.data?.paid_at,
  });
}

/* ─── /paystack/webhook ─────────────────────────────────────────── */

async function handlePaystackWebhook(request, env) {
  const rawBody = await request.text();

  // Paystack signs webhooks with HMAC SHA-512 (entire raw body) using the
  // secret key. We MUST verify; otherwise an attacker can forge any event
  // and upgrade themselves to enterprise without paying.
  if (!env.PAYSTACK_SECRET_KEY) {
    return new Response('webhook not configured', { status: 503 });
  }
  const signature = request.headers.get('x-paystack-signature') || '';
  const sigOk = await verifyPaystackSignature(rawBody, signature, env.PAYSTACK_SECRET_KEY);
  if (!sigOk) return new Response('invalid signature', { status: 401 });

  let event;
  try { event = JSON.parse(rawBody); } catch { return new Response('invalid', { status: 400 }); }

  const eventType = event?.event || '';
  const data      = event?.data  || {};

  const planNameToKey = (name) => {
    if (!name) return null;
    const n = String(name).toLowerCase();
    if (n.includes('pro'))  return 'professional';
    if (n.includes('biz') || n.includes('business')) return 'business';
    if (n.includes('ent'))  return 'enterprise';
    return null;
  };

  // Successful charge → upgrade plan
  if (eventType === 'charge.success' || eventType === 'subscription.create' || eventType === 'invoice.payment_succeeded') {
    const userId = data.metadata?.user_id
                || data.customer?.metadata?.user_id
                || null;
    const plan   = data.metadata?.plan
                || planNameToKey(data.plan?.name)
                || planNameToKey(data.plan_object?.name)
                || 'professional';
    if (userId) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          plan,
          paystack_customer_code:     data.customer?.customer_code || null,
          paystack_subscription_code: data.subscription_code || null,
          paystack_authorization_code: data.authorization?.authorization_code || null,
          plan_renews_at: data.next_payment_date || null,
        }),
      });
    }
  }

  // Subscription cancelled / not renewed → downgrade
  if (eventType === 'subscription.disable' || eventType === 'subscription.not_renew') {
    const userId = data.metadata?.user_id || null;
    if (userId) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ plan: 'starter' }),
      });
    }
  }

  return new Response('ok', { status: 200 });
}

/* ─── helpers ───────────────────────────────────────────────────── */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/* ─── Webhook signature verification ────────────────────────────── */

/** Constant-time comparison of two same-length hex strings. */
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compute hex HMAC of message using the given secret + hash algorithm. */
async function hmacHex(secret, message, hash) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a Stripe webhook signature.
 * Header format: `t=<timestamp>,v1=<hex_sha256>`
 * Signed payload = `${timestamp}.${rawBody}`
 * Optional: reject events older than tolerance (default 5 min) to limit replay.
 */
async function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const idx = p.indexOf('=');
      return idx === -1 ? [p, ''] : [p.slice(0, idx), p.slice(idx + 1)];
    })
  );
  if (!parts.t || !parts.v1) return false;
  const timestamp = parseInt(parts.t, 10);
  if (!Number.isFinite(timestamp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const expected = await hmacHex(secret, `${parts.t}.${rawBody}`, 'SHA-256');
  return constantTimeEqual(expected, parts.v1);
}

/**
 * Verify a Paystack webhook signature.
 * Header: `x-paystack-signature` = hex HMAC-SHA512 of the raw body using the
 * secret key.
 */
async function verifyPaystackSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = await hmacHex(secret, rawBody, 'SHA-512');
  return constantTimeEqual(expected, signatureHeader);
}
