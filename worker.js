// worker-src/lib/responses.js
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
function unauthorized(reason = "auth_required") {
  return json({ error: reason }, 401);
}
function badRequest(reason, detail) {
  return json(detail ? { error: reason, detail } : { error: reason }, 400);
}

// worker-src/lib/supabase.js
async function sb(env, path, opts = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      ...opts.headers || {}
    }
  });
}
async function sbService(env, path, opts = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      ...opts.headers || {}
    }
  });
}
async function sbUserFromToken(env, token) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY
      }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

// worker-src/config.js
var FREE_DAILY_LIMIT = 10;
var PAID_DAILY_LIMIT = 100;
var PLAN_DAILY_LIMITS = {
  guest: FREE_DAILY_LIMIT,
  // 10
  starter: FREE_DAILY_LIMIT * 2,
  // 20 (free signed-in)
  professional: PAID_DAILY_LIMIT,
  // 100
  business: PAID_DAILY_LIMIT * 5,
  // 500
  enterprise: 1e5
  // effectively unlimited
};
function paystackPlanMap(env) {
  return {
    professional: { code: env.PAYSTACK_PLAN_PRO, amount: 3e4, currency: "GHS" },
    // $25 ≈ GHS 300
    business: { code: env.PAYSTACK_PLAN_BIZ, amount: 6e4, currency: "GHS" },
    // $50 ≈ GHS 600
    enterprise: { code: env.PAYSTACK_PLAN_ENT, amount: 15e4, currency: "GHS" }
    // $125 ≈ GHS 1,500
  };
}
function stripePriceMap(env) {
  return {
    professional: env.STRIPE_PRICE_PRO,
    business: env.STRIPE_PRICE_BIZ,
    enterprise: env.STRIPE_PRICE_ENT
  };
}
function dailyLimitFor(plan) {
  return PLAN_DAILY_LIMITS[plan] ?? FREE_DAILY_LIMIT;
}

// worker-src/auth.js
async function resolveCaller(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  if (!token) return { kind: "guest", id: `ip:${ip}`, plan: "guest" };
  const user = await sbUserFromToken(env, token);
  if (!user || !user.id) return { kind: "guest", id: `ip:${ip}`, plan: "guest" };
  let plan = "starter";
  try {
    const pr = await sbService(env, `/profiles?id=eq.${user.id}&select=plan`);
    if (pr.ok) {
      const arr = await pr.json();
      if (arr[0]?.plan) plan = arr[0].plan;
    }
  } catch (_) {
  }
  return {
    kind: "user",
    id: `user:${user.id}`,
    userId: user.id,
    email: user.email,
    plan
  };
}
async function getDailyUsage(callerId, env) {
  const todayStart = /* @__PURE__ */ new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const since = todayStart.toISOString();
  const path = `/api_usage?select=id&caller_id=eq.${encodeURIComponent(callerId)}&created_at=gte.${since}`;
  try {
    const r = await sbService(env, path, { headers: { Prefer: "count=exact" } });
    if (!r.ok) return 0;
    const range = r.headers.get("content-range") || "";
    const m = range.match(/\/(\d+|\*)$/);
    return m && m[1] !== "*" ? parseInt(m[1], 10) : 0;
  } catch (_) {
    return 0;
  }
}
async function recordUsage(callerId, endpoint, env) {
  try {
    await sbService(env, "/api_usage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ caller_id: callerId, endpoint })
    });
  } catch (_) {
  }
}

// worker-src/lib/claude.js
var ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
var ANTHROPIC_API_VERSION = "2023-06-01";
var CLAUDE_MODEL = "claude-haiku-4-5";
async function claudeMessages(env, body) {
  try {
    const r = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      return { ok: false, status: r.status, detail: (await r.text()).slice(0, 300) };
    }
    const data = await r.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, status: 0, detail: err.message };
  }
}
function extractClaudeJson(claudeResponse) {
  const text = (claudeResponse?.content?.[0]?.text || "").trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

// worker-src/handlers/search.js
var SEARCH_PLAN_SYSTEM = `You are a chemical-formula search planner. Output ONLY valid JSON with this exact shape:
{"must":["..."],"categories":["..."],"boost":["..."]}

- "must": ONE primary product noun in English that MUST appear in name (soap, shampoo, cream, disinfectant, detergent, polish, paint, fertilizer, toothpaste, lotion, gel, etc.). Most specific one. Never multiple alternatives.
- "categories": 1-3 best-fit from: hair_care, skin_care, body_care, personal_hygiene, color_cosmetics, cleaning, disinfectants, laundry, dishwashing, automotive, industrial, agriculture, food_beverage, pet_care, adhesives, coatings, specialty, oral_care, lip_care, paint_coating, glass_ceramics, hair_removal, home_fragrance, household, pool_water_treatment, water_treatment, boiler_cooling, metal_treatment, body_treatment, topical_analgesic, face_makeup, face_mask, massage, pest_control, skincare_anti_aging, skincare_brightening, stationery
- "boost": 2-5 modifier words that signal exact intent

EXAMPLES:
"\u0634\u0627\u0645\u0628\u0648 \u0637\u0628\u064A\u0639\u064A \u0644\u0644\u0634\u0639\u0631 \u0627\u0644\u062C\u0627\u0641" -> {"must":["shampoo"],"categories":["hair_care"],"boost":["natural","dry","herbal"]}
"\u0635\u0627\u0628\u0648\u0646 \u0645\u0639\u0642\u0645" -> {"must":["soap"],"categories":["personal_hygiene","disinfectants"],"boost":["antibacterial","antiseptic","sanitizer","disinfectant"]}
"\u0645\u0639\u062C\u0648\u0646 \u0623\u0633\u0646\u0627\u0646 \u0644\u0644\u0623\u0637\u0641\u0627\u0644" -> {"must":["toothpaste"],"categories":["oral_care"],"boost":["children","kids","baby"]}`;
async function claudePlan(query, env) {
  const res = await claudeMessages(env, {
    model: CLAUDE_MODEL,
    max_tokens: 250,
    system: SEARCH_PLAN_SYSTEM,
    messages: [{ role: "user", content: query }]
  });
  if (!res.ok) return null;
  return extractClaudeJson(res.data);
}
async function handleSearch(url, auth, env) {
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) return json({ rows: [], error: "empty" });
  const limit = dailyLimitFor(auth.plan);
  const used = await getDailyUsage(auth.id, env);
  if (used >= limit) {
    return json(
      {
        rows: [],
        count: 0,
        error: "rate_limit_exceeded",
        detail: `Daily limit reached (${used}/${limit}). Upgrade or sign in for more.`,
        limit,
        used,
        plan: auth.plan
      },
      429
    );
  }
  const plan = await claudePlan(query, env);
  if (!plan) return json({ rows: [], plan: null, error: "claude_failed" }, 500);
  if (!plan.must?.length) return json({ rows: [], plan, error: "no_must_term" });
  const must = String(plan.must[0] || "").replace(/[%_,()*\s]/g, "").trim();
  if (!must) return json({ rows: [], plan, error: "empty_must" });
  const select = "id,name,name_en,category,sub_category,form_type,components,trust_score";
  let path = `/formulas?select=${select}&order=trust_score.desc&limit=80&or=(name.ilike.*${must}*,name_en.ilike.*${must}*)`;
  if (Array.isArray(plan.categories) && plan.categories.length) {
    const cats = plan.categories.map((c) => `"${String(c).replace(/"/g, "")}"`).join(",");
    path += `&category=in.(${cats})`;
  }
  const sbRes = await sb(env, path);
  if (!sbRes.ok) {
    return json(
      { error: "supabase_error", plan, detail: (await sbRes.text()).slice(0, 300) },
      500
    );
  }
  let rows = await sbRes.json();
  if (!Array.isArray(rows)) rows = [];
  if (rows.length === 0 && plan.categories?.length) {
    const fbPath = `/formulas?select=${select}&order=trust_score.desc&limit=80&or=(name.ilike.*${must}*,name_en.ilike.*${must}*)`;
    const fb = await sb(env, fbPath);
    if (fb.ok) {
      const j = await fb.json();
      if (Array.isArray(j)) rows = j;
    }
  }
  const boost = (plan.boost || []).map((b) => String(b).toLowerCase()).filter(Boolean);
  const ranked = rows.map((r) => {
    const hay = `${r.name || ""} ${r.name_en || ""} ${r.sub_category || ""}`.toLowerCase();
    let score = 0;
    for (const b of boost) if (hay.includes(b)) score += 10;
    score += (r.trust_score || 0) / 10;
    return { ...r, _score: score };
  }).sort((a, b) => b._score - a._score);
  await recordUsage(auth.id, "/search", env);
  return json({
    query,
    plan,
    count: ranked.length,
    rows: ranked.slice(0, 24),
    usage: { used: used + 1, limit, plan: auth.plan }
  });
}

// worker-src/handlers/usage.js
async function handleUsage(auth, env) {
  const limit = dailyLimitFor(auth.plan);
  const used = await getDailyUsage(auth.id, env);
  return json({
    kind: auth.kind,
    plan: auth.plan,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetsAt: new Date((/* @__PURE__ */ new Date()).setUTCHours(24, 0, 0, 0)).toISOString()
  });
}

// worker-src/handlers/insights.js
async function handleSafety(request, env) {
  let formula;
  try {
    formula = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  if (!formula?.components?.length) return badRequest("missing_components");
  const ingredients = formula.components.map((c) => `${c.name_en} (${c.cas_number || "no-CAS"}) ${c.percentage}%`).join("; ");
  const res = await claudeMessages(env, {
    model: CLAUDE_MODEL,
    max_tokens: 800,
    system: `You are a chemical safety expert. Analyze the given formula and output JSON:
{
  "overall_risk": "safe|caution|warning|dangerous",
  "ghs_classes": ["H315", ...],
  "regulatory_flags": [{"region":"EU","note":"..."},{"region":"US-FDA","note":"..."}],
  "warnings": [{"ingredient":"...","level":"caution","note":"..."}],
  "ppe_required": ["nitrile gloves","safety goggles", ...],
  "storage": "...",
  "summary_ar": "\u0645\u0644\u062E\u0635 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629..."
}
Output ONLY JSON, no prose.`,
    messages: [
      {
        role: "user",
        content: `Formula: ${formula.name_en || formula.name || "unnamed"}
Ingredients: ${ingredients}
Form type: ${formula.form_type || "unknown"}`
      }
    ]
  });
  if (!res.ok) {
    return json({ error: "claude_error", detail: res.detail }, 500);
  }
  const analysis = extractClaudeJson(res.data);
  if (!analysis) return json({ error: "parse_failed" }, 500);
  return json(analysis);
}
async function handleLab(request, env) {
  let formula;
  try {
    formula = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  if (!formula?.components?.length) return badRequest("missing_components");
  const ingredients = formula.components.map((c) => `${c.name_en} (${c.percentage}%)`).join("; ");
  const res = await claudeMessages(env, {
    model: CLAUDE_MODEL,
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
    messages: [
      {
        role: "user",
        content: `Formula: ${formula.name_en || formula.name}
Ingredients: ${ingredients}
Form type: ${formula.form_type || "liquid"}`
      }
    ]
  });
  if (!res.ok) return json({ error: "claude_error" }, 500);
  const prediction = extractClaudeJson(res.data);
  if (!prediction) return json({ error: "parse_failed" }, 500);
  return json(prediction);
}

// worker-src/handlers/chat.js
var CHAT_SYSTEM_PROMPT = `You are Formula AI, an expert chemical formulator. You have access to a database of 3,381 verified chemical formulas across 40 industries (cosmetics, cleaning, disinfectants, pharmaceuticals, automotive, agriculture, industrial, etc.).

CRITICAL RULES (NEVER violate):
1. **You MUST search the database before presenting any formula.** Do NOT invent ingredient lists, percentages, or CAS numbers from your own knowledge.
2. **NEVER embellish or change formula NAMES.** When you mention a formula to the user, you MUST use the EXACT name returned by search_formulas (the "name_en" field). Do not add adjectives, brand names, or descriptive prefixes that weren't in the result. Example:
   - search returned: "Hand Soap (Clear, Quality)" \u2192 present it as "Hand Soap (Clear, Quality)" \u2014 NOT "Herbal Essences Liquid Hand Soap" or "Premium Clear Hand Soap"
   - search returned: "Calcium Mineral Based Protection Complete Toothpaste" \u2192 present it exactly as is, do NOT shorten or rename
3. **All formula NAMES in the database are in English.** When the user asks in Arabic or any other language, you MUST translate the product type to its English equivalent before calling search_formulas.
   Examples:
   - "\u0633\u0627\u0626\u0644 \u062A\u0646\u0638\u064A\u0641 \u0627\u0644\u063A\u0633\u064A\u0644" \u2192 search "laundry detergent" or "liquid detergent"
   - "\u0634\u0627\u0645\u0628\u0648 \u0637\u0628\u064A\u0639\u064A" \u2192 search "shampoo"
   - "\u0643\u0631\u064A\u0645 \u0645\u0631\u0637\u0628" \u2192 search "moisturizing cream" or "cream"
   - "\u0645\u0639\u062C\u0648\u0646 \u0623\u0633\u0646\u0627\u0646" \u2192 search "toothpaste"
   - "\u0645\u0637\u0647\u0631 \u0645\u0633\u062A\u0634\u0641\u064A\u0627\u062A" \u2192 search "disinfectant" or "hospital disinfectant"
   - "\u0635\u0627\u0628\u0648\u0646 \u0633\u0627\u0626\u0644" \u2192 search "liquid soap" or "soap"
   - "\u063A\u0633\u0648\u0644 \u064A\u062F\u064A\u0646" \u2192 search "hand soap" or "hand wash"
   - "\u0645\u0632\u064A\u0644 \u0628\u0642\u0639" \u2192 search "stain remover"
   - "\u0645\u0644\u0645\u0639 \u0632\u062C\u0627\u062C" \u2192 search "glass cleaner"
4. **Try multiple search variants if the first attempt returns 0 rows.** Try synonyms, single words, broader terms. Use category filters when helpful.
5. **If after 2-3 search attempts you still find nothing, tell the user honestly: "I couldn't find this exact type in the database (3,381 formulas). Would you like me to search a related category?"** Do NOT fabricate a formula.
6. **You may answer general chemistry questions** (what is X, how does Y work, why is Z used) from your expertise WITHOUT calling search_formulas \u2014 those are not "formula requests".
7. **When presenting search results, list them by their EXACT name. You may add a 1-line description in parentheses or after a dash, but the primary name must match the database exactly.** Translate the description to the user's language but keep the name in English.

Conversational flow:
- Talk like a senior chemist colleague \u2014 concise, professional, friendly.
- When user asks for a product type, ASK 1-2 clarifying questions FIRST (purpose, audience, budget, etc.). Don't dump lists.
- After clarification, ALWAYS call search_formulas with the English product noun. Present the top 2-3 matches conversationally with their trust scores. ASK which one to expand.
- When user picks one, call get_formula_details and present full ingredients (%, CAS, function), preparation steps, source.
- When user asks to MODIFY a formula, propose a chemically-sound substitute with clear reasoning. Show before/after.
- Respond in the SAME language the user wrote in (Arabic \u2194 English). If mixed, follow the dominant language.
- Refuse politely if user asks for harmful/illegal formulations (drugs, explosives, weapons).

Tools:
- search_formulas(query, category?, limit?): query MUST be English. Tries name + name_en. Returns top matches by trust score.
- get_formula_details(formula_id): full row for one formula by UUID.
- save_modified_formula({parent_id?, name, category, components[], process_conditions?, notes?}): Save a modified formula to the user's library. Use ONLY after the user explicitly says they want to save the modified version (e.g. "save it", "\u0627\u062D\u0641\u0638\u0647\u0627", "save this version"). After saving, confirm with a short message including a tip on how to find it later.

Modification flow:
- When user asks to modify (replace ingredient, make it natural, scale up, etc.), propose the change in chat with full reasoning and the new ingredient table.
- ASK: "Do you want me to save this version to your library?"
- If yes, call save_modified_formula with the FULL new component list (every ingredient, balanced to ~100%) and the parent_id of the original formula.

Available categories (use these in the category parameter when filtering): hair_care, skin_care, body_care, personal_hygiene, color_cosmetics, cleaning, disinfectants, laundry, dishwashing, automotive, industrial, agriculture, food_beverage, pet_care, adhesives, coatings, specialty, oral_care, lip_care, paint_coating, glass_ceramics, hair_removal, home_fragrance, household, pool_water_treatment, water_treatment, boiler_cooling, metal_treatment, body_treatment, topical_analgesic, face_makeup, face_mask, massage, pest_control, skincare_anti_aging, skincare_brightening, stationery.

Trust the user \u2014 they're a working chemist or formulator. Be accurate and never bluff.`;
var CHAT_TOOLS = [
  {
    name: "search_formulas",
    description: "Search the chemical formulas database for matches. Returns top results sorted by trust score. Use this whenever the user asks about a product type or wants to find a formula. Query can be in English or Arabic.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Primary noun or product type (e.g. "shampoo", "hand sanitizer", "shampoo dry hair")'
        },
        category: {
          type: "string",
          description: "Optional category filter (hair_care, skin_care, disinfectants, cleaning, etc.)"
        },
        limit: { type: "number", description: "Max results (1-12, default 8)" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_formula_details",
    description: "Fetch the full ingredient list, percentages, CAS numbers, preparation steps and source for a single formula. Use AFTER the user has picked which formula they want to see.",
    input_schema: {
      type: "object",
      properties: {
        formula_id: { type: "string", description: "UUID returned by search_formulas" }
      },
      required: ["formula_id"]
    }
  },
  {
    name: "save_modified_formula",
    description: "Save a modified formula to the user's personal library. Use this AFTER the user has explicitly approved a modification you proposed. The new formula keeps a reference to the parent (original) so we can show its origin.",
    input_schema: {
      type: "object",
      properties: {
        parent_id: {
          type: "string",
          description: "UUID of the original formula it was modified from (optional if creating a brand-new formula)"
        },
        name: {
          type: "string",
          description: 'Descriptive name including the modification, e.g. "Hand Sanitizer Gel \u2014 Triclosan replaced with Tea Tree Oil"'
        },
        category: { type: "string" },
        sub_category: { type: "string" },
        form_type: { type: "string" },
        components: {
          type: "array",
          description: "Full ingredient list with percentages summing to ~100%",
          items: {
            type: "object",
            properties: {
              name_en: { type: "string" },
              cas_number: { type: "string" },
              percentage: { type: "number" },
              function: { type: "string" }
            },
            required: ["name_en", "percentage"]
          }
        },
        process_conditions: {
          type: "object",
          description: 'Optional: { order_of_addition: "..." }'
        },
        notes: {
          type: "string",
          description: "Why this version was created (the user's original requirement)"
        }
      },
      required: ["name", "components"]
    }
  }
];
async function executeChatTool(toolName, toolInput, env, auth) {
  if (toolName === "save_modified_formula") {
    if (!auth || auth.kind !== "user") {
      return {
        error: "auth_required",
        detail: "User must be signed in to save modified formulas."
      };
    }
    if (!toolInput.name || !Array.isArray(toolInput.components) || !toolInput.components.length) {
      return { error: "missing_fields" };
    }
    const payload = {
      user_id: auth.userId,
      parent_id: toolInput.parent_id || null,
      name: String(toolInput.name).slice(0, 200),
      name_en: String(toolInput.name).slice(0, 200),
      category: toolInput.category || null,
      sub_category: toolInput.sub_category || null,
      form_type: toolInput.form_type || null,
      components: toolInput.components,
      process_conditions: toolInput.process_conditions || {},
      properties: toolInput.properties || {},
      trust_score: 80,
      notes: toolInput.notes || null
    };
    const r = await sbService(env, "/user_formulas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    });
    if (!r.ok) return { error: "db_error", detail: (await r.text()).slice(0, 200) };
    const arr = await r.json();
    return { saved: { id: arr[0].id, name: arr[0].name }, message: "Formula saved to your library." };
  }
  if (toolName === "search_formulas") {
    const rawQuery = String(toolInput.query || "").trim();
    if (!rawQuery) return { error: "empty_query", rows: [] };
    const limit = Math.min(Math.max(parseInt(toolInput.limit) || 8, 1), 12);
    const select = "id,name,name_en,category,sub_category,form_type,trust_score,source_title,source_year";
    const stop = /* @__PURE__ */ new Set([
      "the",
      "a",
      "an",
      "for",
      "with",
      "of",
      "in",
      "to",
      "and",
      "or",
      "on",
      "from",
      "high",
      "low",
      "quality",
      "economical",
      "natural",
      "herbal",
      "pure",
      "best",
      "good"
    ]);
    const words = rawQuery.toLowerCase().replace(/[%_,()*-]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !stop.has(w));
    const variants = [];
    if (rawQuery.length >= 3) variants.push(rawQuery);
    for (const w of words) if (!variants.includes(w)) variants.push(w);
    const seen = /* @__PURE__ */ new Set();
    const all = [];
    let attemptedCategoryFallback = false;
    for (const v of variants) {
      const safe = v.replace(/[%_,()*]/g, "").trim();
      if (!safe) continue;
      let path = `/formulas?select=${select}&order=trust_score.desc&limit=${limit}&or=(name.ilike.*${encodeURIComponent(safe)}*,name_en.ilike.*${encodeURIComponent(safe)}*)`;
      if (toolInput.category)
        path += `&category=eq.${encodeURIComponent(toolInput.category)}`;
      const r = await sb(env, path);
      if (!r.ok) continue;
      const rows = await r.json();
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          all.push(row);
        }
      }
      if (all.length >= Math.max(3, limit / 2)) break;
    }
    if (all.length === 0 && toolInput.category) {
      attemptedCategoryFallback = true;
      for (const v of variants.slice(0, 3)) {
        const safe = v.replace(/[%_,()*]/g, "").trim();
        if (!safe) continue;
        const path = `/formulas?select=${select}&order=trust_score.desc&limit=${limit}&or=(name.ilike.*${encodeURIComponent(safe)}*,name_en.ilike.*${encodeURIComponent(safe)}*)`;
        const r = await sb(env, path);
        if (!r.ok) continue;
        const rows = await r.json();
        if (Array.isArray(rows))
          for (const row of rows) {
            if (!seen.has(row.id)) {
              seen.add(row.id);
              all.push(row);
            }
          }
        if (all.length >= 2) break;
      }
    }
    return {
      rows: all.slice(0, limit),
      count: all.length,
      tried_variants: variants,
      category_fallback_used: attemptedCategoryFallback
    };
  }
  if (toolName === "get_formula_details") {
    const id = String(toolInput.formula_id || "").trim();
    if (!id) return { error: "missing_id" };
    const r = await sb(env, `/formulas?id=eq.${id}&select=*`);
    if (!r.ok) return { error: "db_error" };
    const arr = await r.json();
    if (!arr.length) return { error: "not_found" };
    return { formula: arr[0] };
  }
  return { error: "unknown_tool" };
}
async function createChatSession(auth, title, env) {
  try {
    const payload = { title: (title || "New chat").slice(0, 80) };
    if (auth.kind === "user") payload.user_id = auth.userId;
    else payload.guest_id = auth.id;
    const r = await sbService(env, "/chat_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    });
    if (!r.ok) return null;
    const arr = await r.json();
    return arr[0]?.id || null;
  } catch {
    return null;
  }
}
async function loadChatHistory(sessionId, env) {
  try {
    const path = `/chat_messages?session_id=eq.${sessionId}&role=in.(user,assistant)&select=role,content,created_at&order=created_at.asc&limit=40`;
    const r = await sbService(env, path);
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}
async function saveChatMessage(sessionId, role, content, env) {
  try {
    await sbService(env, "/chat_messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ session_id: sessionId, role, content })
    });
  } catch {
  }
}
function claudeMessageFromRow(row) {
  if (row.role === "user") return { role: "user", content: row.content?.text || "" };
  if (row.role === "assistant")
    return { role: "assistant", content: row.content?.text || "" };
  return null;
}
async function handleChat(request, auth, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  const userMessage = String(body.message || "").trim();
  if (!userMessage) return badRequest("empty_message");
  const limit = dailyLimitFor(auth.plan);
  const used = await getDailyUsage(auth.id, env);
  if (used >= limit) {
    return json(
      {
        error: "rate_limit_exceeded",
        detail: `Daily limit reached (${used}/${limit}). Upgrade or sign in for more.`,
        limit,
        used,
        plan: auth.plan
      },
      429
    );
  }
  let sessionId = body.session_id || null;
  if (!sessionId) {
    sessionId = await createChatSession(auth, userMessage.slice(0, 60), env);
    if (!sessionId) return json({ error: "session_create_failed" }, 500);
  }
  const history = await loadChatHistory(sessionId, env);
  await saveChatMessage(sessionId, "user", { text: userMessage }, env);
  const messages = [
    ...history.map((m) => claudeMessageFromRow(m)),
    { role: "user", content: userMessage }
  ];
  const formulaRefs = [];
  let finalText = "";
  let stopReason = null;
  for (let round = 0; round < 5; round++) {
    const cr = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        system: CHAT_SYSTEM_PROMPT,
        tools: CHAT_TOOLS,
        messages
      })
    });
    if (!cr.ok) {
      const errText = (await cr.text()).slice(0, 400);
      return json({ error: "claude_error", detail: errText }, 500);
    }
    const cd = await cr.json();
    stopReason = cd.stop_reason;
    const blocks = cd.content || [];
    const textBlocks = blocks.filter((b) => b.type === "text");
    const toolUseBlocks = blocks.filter((b) => b.type === "tool_use");
    if (textBlocks.length) {
      finalText = textBlocks.map((b) => b.text).join("\n").trim();
    }
    if (stopReason !== "tool_use" || !toolUseBlocks.length) {
      messages.push({ role: "assistant", content: blocks });
      break;
    }
    messages.push({ role: "assistant", content: blocks });
    const toolResults = [];
    for (const tu of toolUseBlocks) {
      const result = await executeChatTool(tu.name, tu.input, env, auth);
      if (tu.name === "search_formulas" && Array.isArray(result.rows)) {
        formulaRefs.push(
          ...result.rows.map((r) => ({
            id: r.id,
            name: r.name_en || r.name,
            trust: r.trust_score
          }))
        );
      }
      if (tu.name === "get_formula_details" && result.formula) {
        formulaRefs.push({
          id: result.formula.id,
          name: result.formula.name_en || result.formula.name,
          trust: result.formula.trust_score,
          full: true
        });
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result)
      });
    }
    messages.push({ role: "user", content: toolResults });
  }
  await saveChatMessage(
    sessionId,
    "assistant",
    { text: finalText, formula_refs: formulaRefs },
    env
  );
  await recordUsage(auth.id, "/chat", env);
  return json({
    session_id: sessionId,
    reply: finalText,
    formula_refs: formulaRefs,
    usage: { used: used + 1, limit, plan: auth.plan }
  });
}
async function handleListSessions(auth, env) {
  if (auth.kind !== "user") return json({ sessions: [] });
  try {
    const path = `/chat_sessions?user_id=eq.${auth.userId}&select=id,title,created_at,updated_at&order=updated_at.desc&limit=50`;
    const r = await sbService(env, path);
    if (!r.ok) return json({ sessions: [] });
    return json({ sessions: await r.json() });
  } catch {
    return json({ sessions: [] });
  }
}
async function handleLoadMessages(url, auth, env) {
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return badRequest("missing_session_id");
  if (auth.kind === "user") {
    const own = await sbService(
      env,
      `/chat_sessions?id=eq.${sessionId}&user_id=eq.${auth.userId}&select=id`
    );
    if (!own.ok) return json({ error: "forbidden" }, 403);
    const arr = await own.json();
    if (!arr.length) return json({ error: "not_found" }, 404);
  }
  const r = await sbService(
    env,
    `/chat_messages?session_id=eq.${sessionId}&select=role,content,created_at&order=created_at.asc&limit=200`
  );
  if (!r.ok) return json({ messages: [] });
  return json({ session_id: sessionId, messages: await r.json() });
}

// worker-src/handlers/library.js
async function handleSaveFormula(request, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  if (!body.name || !Array.isArray(body.components) || !body.components.length) {
    return badRequest("missing_fields", "name and components[] are required");
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
    notes: body.notes || null
  };
  const r = await sbService(env, "/user_formulas", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    return json({ error: "save_failed", detail: (await r.text()).slice(0, 300) }, 500);
  }
  const arr = await r.json();
  return json({ saved: arr[0] });
}
async function handleMyFormulas(auth, env) {
  if (auth.kind !== "user") return json({ formulas: [] });
  const path = `/user_formulas?user_id=eq.${auth.userId}&select=id,name,name_en,category,trust_score,parent_id,created_at,updated_at&order=updated_at.desc&limit=100`;
  const r = await sbService(env, path);
  if (!r.ok) return json({ formulas: [] });
  return json({ formulas: await r.json() });
}
async function handleLibraryList(auth, env) {
  if (auth.kind !== "user") return unauthorized();
  const path = `/user_formulas?user_id=eq.${auth.userId}&select=id,name,name_en,category,sub_category,form_type,trust_score,parent_id,notes,created_at,updated_at&order=updated_at.desc&limit=200`;
  const r = await sbService(env, path);
  if (!r.ok) return json({ formulas: [] });
  return json({ formulas: await r.json() });
}
async function handleLibraryGet(id, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  if (!id) return badRequest("missing_id");
  const r = await sbService(
    env,
    `/user_formulas?id=eq.${id}&user_id=eq.${auth.userId}&select=*`
  );
  if (!r.ok) return json({ error: "db_error" }, 500);
  const arr = await r.json();
  if (!arr.length) return json({ error: "not_found" }, 404);
  return json({ formula: arr[0] });
}
var UPDATABLE_FIELDS = [
  "name",
  "name_en",
  "category",
  "sub_category",
  "form_type",
  "description",
  "components",
  "process_conditions",
  "properties",
  "trust_score",
  "notes"
];
async function handleLibraryUpdate(id, request, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  const allowed = {};
  for (const k of UPDATABLE_FIELDS) {
    if (k in body) allowed[k] = body[k];
  }
  if (!Object.keys(allowed).length) return badRequest("no_fields");
  const r = await sbService(env, `/user_formulas?id=eq.${id}&user_id=eq.${auth.userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(allowed)
  });
  if (!r.ok) return json({ error: "update_failed" }, 500);
  const arr = await r.json();
  return json({ updated: arr[0] });
}
async function handleLibraryDelete(id, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  const r = await sbService(env, `/user_formulas?id=eq.${id}&user_id=eq.${auth.userId}`, {
    method: "DELETE"
  });
  if (!r.ok) return json({ error: "delete_failed" }, 500);
  return json({ deleted: true });
}

// worker-src/handlers/extract.js
var EXTRACT_SYSTEM = `You are a chemistry-formula extraction system.
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
- Only include formulas where percentages sum approximately to 100% (\xB15%).
- Skip mentions/discussions that aren't actual recipes.
- Return [] if nothing found.
- Cap at 30 formulas per response.`;
async function markBookFailed(bookId, errorMessage, env) {
  try {
    await sbService(env, `/uploaded_books?id=eq.${bookId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        status: "failed",
        error_message: String(errorMessage).slice(0, 500)
      })
    });
  } catch {
  }
}
async function handleExtract(request, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  const text = String(body.text || "").trim();
  const title = String(body.title || "Untitled book").slice(0, 200);
  const author = body.author ? String(body.author).slice(0, 120) : null;
  const year = parseInt(body.year) || null;
  if (text.length < 200)
    return badRequest("text_too_short", "Need at least 200 characters of book content");
  if (text.length > 6e4)
    return badRequest(
      "text_too_long",
      "Max 60,000 chars per extract call. Split larger books into chunks."
    );
  let bookId = null;
  try {
    const r = await sbService(env, "/uploaded_books", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        user_id: auth.userId,
        title,
        author,
        year,
        file_size_bytes: text.length,
        status: "processing"
      })
    });
    if (r.ok) {
      const arr = await r.json();
      bookId = arr[0]?.id || null;
    }
  } catch {
  }
  let extracted = [];
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 8e3,
        system: EXTRACT_SYSTEM,
        messages: [
          {
            role: "user",
            content: `BOOK TITLE: ${title}
AUTHOR: ${author || "unknown"}

--- BOOK TEXT ---
${text}`
          }
        ]
      })
    });
    if (r.ok) {
      const cd = await r.json();
      const raw = (cd.content?.[0]?.text || "").trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      try {
        extracted = JSON.parse(raw);
      } catch {
        extracted = [];
      }
      if (!Array.isArray(extracted)) extracted = [];
    }
  } catch (err) {
    if (bookId) await markBookFailed(bookId, err.message, env);
    return json({ error: "claude_failed", detail: err.message }, 500);
  }
  let inserted = 0;
  const skipped = [];
  for (const f of extracted) {
    if (!f.name || !Array.isArray(f.components) || !f.components.length) {
      skipped.push({ name: f.name || "?", reason: "missing_fields" });
      continue;
    }
    const total = f.components.reduce((s, c) => s + (parseFloat(c.percentage) || 0), 0);
    if (total < 95 || total > 105) {
      skipped.push({ name: f.name, reason: `unbalanced_${total.toFixed(1)}%` });
      continue;
    }
    try {
      const ins = await sbService(env, "/formulas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          name: f.name,
          name_en: f.name,
          category: f.category || "specialty",
          sub_category: f.sub_category || null,
          form_type: f.form_type || "liquid",
          components: f.components,
          process_conditions: f.process_conditions || {},
          properties: f.properties || {},
          trust_score: 78,
          source_title: title,
          source_author: author,
          source_year: year,
          uploaded_book_id: bookId,
          added_by_user_id: auth.userId
        })
      });
      if (ins.ok) inserted++;
      else skipped.push({ name: f.name, reason: "db_insert_failed" });
    } catch (err) {
      skipped.push({ name: f.name, reason: err.message });
    }
  }
  if (bookId) {
    await sbService(env, `/uploaded_books?id=eq.${bookId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ status: "done", formulas_extracted: inserted })
    });
  }
  return json({
    book_id: bookId,
    found: extracted.length,
    inserted,
    skipped,
    preview: extracted.slice(0, 3)
  });
}

// worker-src/handlers/discover.js
var DISCOVER_PROVIDERS = ["semantic_scholar", "pubmed", "lens", "arxiv"];
async function handleDiscover(request, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  let query = String(body.query || "").trim();
  if (!query) return badRequest("empty_query");
  if (query.length > 200) query = query.slice(0, 200);
  const words = query.split(/\s+/);
  if (words.length > 8) query = words.slice(0, 8).join(" ");
  const sources = Array.isArray(body.sources) && body.sources.length ? body.sources.filter((s) => DISCOVER_PROVIDERS.includes(s)) : DISCOVER_PROVIDERS;
  const maxPerSource = Math.min(Math.max(parseInt(body.max_per_source) || 8, 1), 20);
  let jobId = null;
  try {
    const r = await sbService(env, "/discovery_jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        user_id: auth.userId,
        query,
        sources,
        status: "running"
      })
    });
    if (r.ok) jobId = (await r.json())[0]?.id || null;
  } catch {
  }
  const searches = await Promise.allSettled(
    sources.map((src) => searchProvider(src, query, maxPerSource))
  );
  const allResults = [];
  searches.forEach((s, i) => {
    if (s.status === "fulfilled" && Array.isArray(s.value)) {
      for (const item of s.value) allResults.push({ ...item, provider: sources[i] });
    }
  });
  const seen = /* @__PURE__ */ new Set();
  const dedup = allResults.filter((r) => {
    const key = `${r.provider}:${r.external_id || r.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sourceRows = [];
  for (const r of dedup) {
    try {
      const ins = await sbService(env, "/discovered_sources?on_conflict=provider,external_id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
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
          url: r.url || null
        })
      });
      if (ins.ok) {
        const arr = await ins.json();
        if (arr[0]) sourceRows.push(arr[0]);
      }
    } catch {
    }
  }
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
          const hasPct = f.components.some(
            (c) => Number.isFinite(parseFloat(c.percentage)) && parseFloat(c.percentage) > 0
          );
          if (!hasPct) continue;
          let total = f.components.reduce(
            (s, c) => s + (parseFloat(c.percentage) || 0),
            0
          );
          const comps = [...f.components];
          if (total < 95) {
            const remainder = 100 - total;
            comps.push({
              name_en: "Water (Aqua)",
              cas_number: "7732-18-5",
              percentage: parseFloat(remainder.toFixed(2)),
              function: "solvent"
            });
            total = 100;
          } else if (total > 105) {
            continue;
          }
          const completeness = f.completeness === "complete" ? "complete" : f.completeness === "partial" ? "partial" : Math.abs(100 - total) < 1 ? "complete" : "partial";
          const trustScore = completeness === "complete" ? 75 : 60;
          try {
            const ok = await sbService(env, "/formulas", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Prefer: "return=minimal"
              },
              body: JSON.stringify({
                name: f.name,
                name_en: f.name,
                category: f.category || "specialty",
                form_type: f.form_type || "liquid",
                components: comps,
                process_conditions: { ...f.process_conditions || {}, completeness },
                trust_score: trustScore,
                source_title: src.title,
                source_author: src.authors,
                source_year: src.year,
                source_url: src.url,
                discovered_source_id: src.id,
                added_by_user_id: auth.userId
              })
            });
            if (ok.ok) inserted++;
          } catch {
          }
        }
        totalExtracted += inserted;
        extractionDetails.push({
          source_id: src.id,
          title: src.title,
          found: formulas.length,
          inserted
        });
        if (inserted > 0) {
          try {
            await sbService(env, `/discovered_sources?id=eq.${src.id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Prefer: "return=minimal"
              },
              body: JSON.stringify({ has_formula: true, formulas_found: inserted })
            });
          } catch {
          }
        }
      }
    } catch {
    }
  }
  if (jobId) {
    try {
      await sbService(env, `/discovery_jobs?id=eq.${jobId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          status: "done",
          results_found: dedup.length,
          formulas_extracted: totalExtracted
        })
      });
    } catch {
    }
  }
  return json({
    job_id: jobId,
    sources_searched: sources,
    results_found: dedup.length,
    formulas_extracted: totalExtracted,
    by_source: countBy(dedup.map((r) => r.provider)),
    details: extractionDetails.slice(0, 10)
  });
}
async function handleListDiscoveryJobs(auth, env) {
  if (auth.kind !== "user") return json({ jobs: [] });
  const path = `/discovery_jobs?user_id=eq.${auth.userId}&select=id,query,sources,status,results_found,formulas_extracted,created_at&order=created_at.desc&limit=50`;
  const r = await sbService(env, path);
  if (!r.ok) return json({ jobs: [] });
  return json({ jobs: await r.json() });
}
async function handleDiscoverDebug(url, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  const query = (url.searchParams.get("q") || "WHO alcohol-based handrub formulation").trim();
  const out = { query, steps: [] };
  const epmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=3&resultType=core`;
  let papers = [];
  try {
    const r = await fetch(epmcUrl, { headers: { Accept: "application/json" } });
    out.steps.push({ step: "1_search", status: r.status, ok: r.ok });
    if (r.ok) {
      const data = await r.json();
      papers = data.resultList?.result || [];
      out.steps.push({
        step: "2_results",
        count: papers.length,
        sample: papers.slice(0, 2).map((p) => ({
          title: p.title,
          pmcid: p.pmcid,
          isOpenAccess: p.isOpenAccess,
          has_abstract: !!p.abstractText
        }))
      });
    }
  } catch (e) {
    out.steps.push({ step: "1_search_failed", error: e.message });
  }
  if (!papers.length) {
    out.steps.push({
      step: "3_no_papers",
      note: "Europe PMC returned 0 results for this query"
    });
    return json(out);
  }
  const openAccess = papers.find((p) => p.pmcid && p.isOpenAccess === "Y");
  let textForClaude = "";
  if (openAccess) {
    out.steps.push({ step: "4_fulltext_target", pmcid: openAccess.pmcid });
    try {
      const idWithPrefix = String(openAccess.pmcid);
      const idNoPrefix = idWithPrefix.replace(/^PMC/i, "");
      const tries = [
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${idWithPrefix}/fullTextXML`,
        `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/${idNoPrefix}/fullTextXML`,
        `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/${idWithPrefix}/fullTextXML`
      ];
      let ftRes = null;
      let ftUrl = "";
      for (const u of tries) {
        const r = await fetch(u);
        out.steps.push({ step: "5_fulltext_try", url: u, status: r.status });
        if (r.ok) {
          ftRes = r;
          ftUrl = u;
          break;
        }
      }
      if (!ftRes) {
        out.steps.push({ step: "5_fulltext_status", status: "all_failed" });
        textForClaude = `${openAccess.title}

${openAccess.abstractText || ""}`;
        throw new Error("all_failed");
      }
      out.steps.push({
        step: "5_fulltext_status",
        status: ftRes.status,
        ok: ftRes.ok,
        url: ftUrl
      });
      if (ftRes.ok) {
        const xml = await ftRes.text();
        const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        textForClaude = `${openAccess.title}

${openAccess.abstractText || ""}

--- FULL TEXT EXCERPT ---
${text.slice(0, 5e3)}`;
        out.steps.push({ step: "6_fulltext_length", chars: text.length });
      } else {
        textForClaude = `${openAccess.title}

${openAccess.abstractText || ""}`;
      }
    } catch (e) {
      out.steps.push({ step: "5_fulltext_failed", error: e.message });
      textForClaude = `${openAccess.title}

${openAccess.abstractText || ""}`;
    }
  } else {
    out.steps.push({
      step: "4_no_open_access",
      note: "No Open Access paper in results"
    });
    const first = papers[0];
    textForClaude = `${first.title}

${first.abstractText || ""}`;
  }
  try {
    const cr = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2500,
        system: `Extract chemical formulations from the text. Output ONLY a JSON array. Each item must have "name", "category", "form_type", "components" (array with name_en + percentage), "completeness" ("complete" or "partial"). If no formulation, return []. Be generous \u2014 partial recipes count.`,
        messages: [{ role: "user", content: textForClaude.slice(0, 8e3) }]
      })
    });
    out.steps.push({ step: "7_claude_status", status: cr.status, ok: cr.ok });
    if (cr.ok) {
      const cd = await cr.json();
      const raw = cd.content?.[0]?.text || "";
      out.steps.push({ step: "8_claude_raw", text: raw.slice(0, 2e3) });
      try {
        const parsed = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim());
        out.steps.push({
          step: "9_parsed",
          count: Array.isArray(parsed) ? parsed.length : 0,
          sample: Array.isArray(parsed) ? parsed.slice(0, 2) : null
        });
      } catch (e) {
        out.steps.push({ step: "9_parse_failed", error: e.message });
      }
    }
  } catch (e) {
    out.steps.push({ step: "7_claude_failed", error: e.message });
  }
  return json(out);
}
async function searchProvider(provider, query, max) {
  try {
    if (provider === "semantic_scholar") return await searchSemanticScholar(query, max);
    if (provider === "pubmed") return await searchPubMed(query, max);
    if (provider === "arxiv") return await searchArxiv(query, max);
    if (provider === "lens") return await searchLens(query, max);
  } catch (_) {
  }
  return [];
}
async function searchSemanticScholar(query, max) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${max}&fields=title,authors,abstract,year,venue,externalIds,url`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) return [];
  const data = await r.json();
  return (data.data || []).filter((p) => p.abstract).map((p) => ({
    source_type: "paper",
    external_id: p.externalIds?.DOI || p.externalIds?.CorpusId || p.paperId,
    title: p.title || "Untitled",
    authors: (p.authors || []).map((a) => a.name).filter(Boolean).join(", ").slice(0, 400),
    abstract: p.abstract,
    year: p.year || null,
    journal_or_office: p.venue || null,
    url: p.url || (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : null)
  }));
}
async function searchPubMed(query, max) {
  const filteredQuery = `(${query}) AND HAS_FT:Y AND IN_EPMC:Y NOT (PUB_TYPE:"case-reports" OR PUB_TYPE:"editorial" OR PUB_TYPE:"comment" OR PUB_TYPE:"letter")`;
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(filteredQuery)}&format=json&pageSize=${max * 2}&resultType=core`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) return [];
  const data = await r.json();
  let results = data.resultList?.result || [];
  if (!results.length) {
    const fallback = await fetch(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=${max}&resultType=core`,
      { headers: { Accept: "application/json" } }
    );
    if (fallback.ok) {
      const fd = await fallback.json();
      results = fd.resultList?.result || [];
    }
  }
  if (!results.length) return [];
  const seenTitles = /* @__PURE__ */ new Set();
  const dedupResults = results.filter((res) => {
    const titleKey = (res.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 100);
    if (seenTitles.has(titleKey)) return false;
    seenTitles.add(titleKey);
    return true;
  }).slice(0, max);
  const items = dedupResults.map((res) => ({
    source_type: "paper",
    external_id: res.doi ? `DOI:${res.doi}` : res.pmid ? `PMID:${res.pmid}` : res.pmcid || res.id,
    title: (res.title || "Untitled").replace(/\s+/g, " ").trim().slice(0, 400),
    authors: (res.authorString || "").slice(0, 400),
    abstract: res.abstractText || null,
    year: res.pubYear ? parseInt(res.pubYear) : null,
    journal_or_office: res.journalTitle || res.bookOrReportDetails?.publisher || null,
    url: res.doi ? `https://doi.org/${res.doi}` : res.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${res.pmid}/` : null,
    _source_kind: res.source,
    _pmcid: res.pmcid || null,
    _is_oa: res.isOpenAccess === "Y",
    _has_ft: res.hasFullText === "Y" || res.hasPDF === "Y",
    _in_epmc: res.inEPMC === "Y"
  })).filter((p) => p.abstract || p._pmcid);
  const withPmc = items.filter((it) => it._pmcid && it._in_epmc).slice(0, 5);
  await Promise.allSettled(
    withPmc.map(async (it) => {
      const idWithPrefix = String(it._pmcid);
      const idNoPrefix = idWithPrefix.replace(/^PMC/i, "");
      const candidates = [
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${idWithPrefix}/fullTextXML`,
        `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/${idNoPrefix}/fullTextXML`
      ];
      let ftRes = null;
      for (const u of candidates) {
        try {
          const r2 = await fetch(u, { headers: { Accept: "application/xml" } });
          if (r2.ok) {
            ftRes = r2;
            break;
          }
        } catch (_) {
        }
      }
      if (!ftRes) return;
      try {
        const xml = await ftRes.text();
        const text = xml.replace(/<\?xml[^>]*\?>/g, "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const slice = sliceAroundKeywords(
          text,
          [
            "formulation",
            "composition",
            "preparation",
            "ingredients",
            "materials and methods",
            "recipe",
            "excipients",
            "%",
            "w/w",
            "w/v",
            "percentage",
            "mg/ml",
            "mass fraction"
          ],
          1e4
        );
        if (slice && slice.length > 600) {
          it.abstract = (it.abstract || it.title) + "\n\n--- FULL TEXT EXCERPT ---\n" + slice;
        }
      } catch {
      }
    })
  );
  return items.filter((it) => it.abstract);
}
function sliceAroundKeywords(text, keywords, maxLen) {
  if (!text || text.length <= maxLen) return text;
  const lower = text.toLowerCase();
  let bestPos = 0;
  let bestScore = 0;
  for (let i = 0; i < text.length; i += 1e3) {
    const window = lower.slice(i, i + 4e3);
    let score = 0;
    for (const k of keywords) {
      const m = window.match(new RegExp(k, "g"));
      if (m) score += m.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPos = i;
    }
  }
  return text.slice(Math.max(0, bestPos - 500), bestPos + maxLen);
}
async function searchArxiv(query, max) {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=${max}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const xml = await r.text();
  const entries = xml.split("<entry>").slice(1);
  return entries.map((e) => {
    const t = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/\s+/g, " ").trim();
    const ab = (e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/\s+/g, " ").trim();
    const id = (e.match(/<id>([^<]+)<\/id>/) || [])[1];
    const pub = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    const auths = [...e.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
    return {
      source_type: "preprint",
      external_id: id ? id.split("/").pop() : null,
      title: t || "Untitled",
      authors: auths.join(", ").slice(0, 400),
      abstract: ab || null,
      year: pub ? parseInt(pub.slice(0, 4)) : null,
      journal_or_office: "arXiv",
      url: id || null
    };
  }).filter((p) => p.abstract);
}
async function searchLens(query, max) {
  try {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent("patent " + query)}&rows=${max}&filter=type:patent`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.message?.items || []).map((it) => ({
      source_type: "patent",
      external_id: it.DOI || (it.URL || "").split("/").pop(),
      title: (it.title?.[0] || "Untitled patent").slice(0, 400),
      authors: (it.author || []).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).filter(Boolean).join(", ").slice(0, 400),
      abstract: it.abstract || null,
      year: it.created?.["date-parts"]?.[0]?.[0] || null,
      journal_or_office: it.publisher || "Patent",
      url: it.URL || null
    })).filter((p) => p.abstract);
  } catch {
    return [];
  }
}
var EXTRACT_FROM_ABSTRACT_SYSTEM = `You are a chemistry-formula extraction system. You aggressively extract every chemical formulation hinted at in scientific text \u2014 papers, patents, methods sections.

YOUR JOB: For every formulation in the text, output one JSON object. Be GENEROUS \u2014 partial recipes are valuable. Only return [] if the text is purely theoretical with no ingredients mentioned at all.

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
3. **Only ingredients named (no %s at all)**: STILL extract as "partial" \u2014 use typical % for each. The user is a chemist who can refine later.
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
\u2192 ONE formula: complete, 4 components (Ethanol 80, Glycerol 1.45, H2O2 0.125, Water 18.425)

Text: "Carbopol-based antiseptic gel containing chlorhexidine digluconate and triethanolamine was prepared..."
\u2192 ONE formula: partial. Estimate: Carbopol 0.7%, Chlorhexidine 2%, Triethanolamine 0.7%, Water 96.6%

Text: "We studied antibiotic resistance in hospital staff."
\u2192 [] (no formulation)

Be helpful \u2014 better to extract a partial formula a chemist can refine than to reject everything.`;
async function extractFromAbstract(src, env) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2500,
        system: EXTRACT_FROM_ABSTRACT_SYSTEM,
        messages: [
          {
            role: "user",
            content: `TITLE: ${src.title}

ABSTRACT:
${src.abstract.slice(0, 6e3)}`
          }
        ]
      })
    });
    if (!r.ok) return [];
    const cd = await r.json();
    const txt = (cd.content?.[0]?.text || "").trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function countBy(arr) {
  const m = {};
  for (const k of arr) m[k] = (m[k] || 0) + 1;
  return m;
}

// worker-src/handlers/prices.js
async function handlePricesList(auth, env) {
  if (auth.kind !== "user") return json({ prices: [] });
  const path = `/ingredient_prices?user_id=eq.${auth.userId}&select=*&order=ingredient_name.asc&limit=500`;
  const r = await sbService(env, path);
  if (!r.ok) return json({ prices: [] });
  return json({ prices: await r.json() });
}
async function handlePriceUpsert(request, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  if (!body.ingredient_name || !body.price_per_kg) {
    return badRequest("missing_fields");
  }
  const payload = {
    user_id: auth.userId,
    ingredient_name: String(body.ingredient_name).slice(0, 200),
    cas_number: body.cas_number || null,
    price_per_kg: parseFloat(body.price_per_kg),
    currency: body.currency || "USD",
    supplier: body.supplier || null,
    notes: body.notes || null
  };
  const r = await sbService(env, `/ingredient_prices?on_conflict=user_id,ingredient_name`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    return json({ error: "save_failed", detail: (await r.text()).slice(0, 300) }, 500);
  }
  const arr = await r.json();
  return json({ saved: arr[0] });
}
async function handlePriceDelete(id, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  const r = await sbService(
    env,
    `/ingredient_prices?id=eq.${id}&user_id=eq.${auth.userId}`,
    { method: "DELETE" }
  );
  if (!r.ok) return json({ error: "delete_failed" }, 500);
  return json({ deleted: true });
}
async function handleCost(request, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  const components = await resolveComponents(body, auth, env);
  if (!components) return badRequest("no_components");
  const batchKg = parseFloat(body.batch_kg) || 1;
  const currency = String(body.currency || "USD").slice(0, 5);
  const pr = await sbService(
    env,
    `/ingredient_prices?user_id=eq.${auth.userId}&select=ingredient_name,cas_number,price_per_kg,currency&limit=2000`
  );
  const priceList = pr.ok ? await pr.json() : [];
  const byName = /* @__PURE__ */ new Map();
  const byCas = /* @__PURE__ */ new Map();
  for (const p of priceList) {
    byName.set(String(p.ingredient_name).toLowerCase(), p);
    if (p.cas_number) byCas.set(p.cas_number, p);
  }
  const breakdown = [];
  const missing = [];
  let total = 0;
  for (const c of components) {
    const name = String(c.name_en || c.name || "").trim();
    const pct = parseFloat(c.percentage) || 0;
    if (!name || pct <= 0) continue;
    const massKg = pct / 100 * batchKg;
    const price = c.cas_number && byCas.get(c.cas_number) || byName.get(name.toLowerCase());
    if (price) {
      const cost = massKg * parseFloat(price.price_per_kg);
      total += cost;
      breakdown.push({
        name,
        percentage: pct,
        mass_kg: parseFloat(massKg.toFixed(4)),
        price_per_kg: parseFloat(price.price_per_kg),
        cost: parseFloat(cost.toFixed(4)),
        currency: price.currency
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
    coverage_pct: components.length ? Math.round(breakdown.length / (breakdown.length + missing.length) * 100) : 0
  });
}
async function handleScale(request, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  const components = await resolveComponents(body, auth, env);
  if (!components) return badRequest("no_components");
  const targetKg = parseFloat(body.target_kg);
  if (!Number.isFinite(targetKg) || targetKg <= 0) {
    return badRequest("invalid_target_kg");
  }
  const unit = String(body.unit || "kg").toLowerCase();
  const conversion = unit === "g" ? 1e3 : unit === "mg" ? 1e6 : unit === "l" ? 1 : unit === "ml" ? 1e3 : 1;
  const scaled = components.map((c) => {
    const pct = parseFloat(c.percentage) || 0;
    const massKg = pct / 100 * targetKg;
    return {
      name_en: c.name_en || c.name || "",
      cas_number: c.cas_number || null,
      function: c.function || null,
      percentage: pct,
      mass_kg: parseFloat(massKg.toFixed(4)),
      [`mass_${unit}`]: parseFloat((massKg * conversion).toFixed(4))
    };
  });
  const totalPct = components.reduce(
    (s, c) => s + (parseFloat(c.percentage) || 0),
    0
  );
  return json({
    target_kg: targetKg,
    unit,
    total_percentage: parseFloat(totalPct.toFixed(2)),
    balance_check: Math.abs(totalPct - 100) < 1 ? "balanced" : `off by ${(totalPct - 100).toFixed(2)}%`,
    components: scaled
  });
}
async function resolveComponents(body, auth, env) {
  if (Array.isArray(body.components) && body.components.length) return body.components;
  if (!body.formula_id) return null;
  const pub = await sb(
    env,
    `/formulas?id=eq.${body.formula_id}&select=components,name,form_type`
  );
  if (pub.ok) {
    const arr = await pub.json();
    if (arr[0]?.components) return arr[0].components;
  }
  if (auth.kind === "user") {
    const own = await sbService(
      env,
      `/user_formulas?id=eq.${body.formula_id}&user_id=eq.${auth.userId}&select=components,name,form_type`
    );
    if (own.ok) {
      const arr = await own.json();
      if (arr[0]?.components) return arr[0].components;
    }
  }
  return null;
}

// worker-src/lib/crypto.js
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmacHex(secret, message, hash) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const idx = p.indexOf("=");
      return idx === -1 ? [p, ""] : [p.slice(0, idx), p.slice(idx + 1)];
    })
  );
  if (!parts.t || !parts.v1) return false;
  const timestamp = parseInt(parts.t, 10);
  if (!Number.isFinite(timestamp)) return false;
  const now = Math.floor(Date.now() / 1e3);
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${parts.t}.${rawBody}`, "SHA-256");
  return constantTimeEqual(expected, parts.v1);
}
async function verifyPaystackSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = await hmacHex(secret, rawBody, "SHA-512");
  return constantTimeEqual(expected, signatureHeader);
}

// worker-src/handlers/payments.js
var PAYSTACK_API = "https://api.paystack.co";
var STRIPE_API = "https://api.stripe.com";
async function handlePaystackCheckout(request, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  if (!env.PAYSTACK_SECRET_KEY) {
    return json(
      {
        error: "paystack_not_configured",
        detail: "Set PAYSTACK_SECRET_KEY in Worker secrets."
      },
      503
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  const planMap = paystackPlanMap(env);
  const plan = planMap[body.plan];
  if (!plan) return badRequest("unknown_plan");
  const origin = request.headers.get("Origin") || "https://jamilformula.com";
  const payload = {
    email: auth.email,
    amount: plan.amount,
    currency: plan.currency,
    callback_url: `${origin}/dashboard.html?paystack=success`,
    metadata: {
      user_id: auth.userId,
      plan: body.plan,
      origin
    }
  };
  if (plan.code) payload.plan = plan.code;
  const r = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    return json({ error: "paystack_error", detail: (await r.text()).slice(0, 300) }, 500);
  }
  const data = await r.json();
  if (!data.status) {
    return json({ error: "paystack_failed", detail: data.message || "Unknown error" }, 500);
  }
  return json({
    url: data.data.authorization_url,
    reference: data.data.reference,
    access_code: data.data.access_code
  });
}
async function handlePaystackVerify(url, env) {
  const reference = url.searchParams.get("reference");
  if (!reference) return badRequest("missing_reference");
  if (!env.PAYSTACK_SECRET_KEY) return json({ error: "paystack_not_configured" }, 503);
  const r = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` }
  });
  if (!r.ok) return json({ error: "verify_failed" }, 500);
  const data = await r.json();
  return json({
    success: !!data.status && data.data?.status === "success",
    status: data.data?.status,
    amount: data.data?.amount,
    currency: data.data?.currency,
    customer_email: data.data?.customer?.email,
    paid_at: data.data?.paid_at
  });
}
async function handlePaystackWebhook(request, env) {
  const rawBody = await request.text();
  if (!env.PAYSTACK_SECRET_KEY) {
    return new Response("webhook not configured", { status: 503, headers: corsHeaders });
  }
  const signature = request.headers.get("x-paystack-signature") || "";
  const sigOk = await verifyPaystackSignature(rawBody, signature, env.PAYSTACK_SECRET_KEY);
  if (!sigOk) {
    return new Response("invalid signature", { status: 401, headers: corsHeaders });
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("invalid", { status: 400, headers: corsHeaders });
  }
  const eventType = event?.event || "";
  const data = event?.data || {};
  const planNameToKey = (name) => {
    if (!name) return null;
    const n = String(name).toLowerCase();
    if (n.includes("pro")) return "professional";
    if (n.includes("biz") || n.includes("business")) return "business";
    if (n.includes("ent")) return "enterprise";
    return null;
  };
  if (eventType === "charge.success" || eventType === "subscription.create" || eventType === "invoice.payment_succeeded") {
    const userId = data.metadata?.user_id || data.customer?.metadata?.user_id || null;
    const plan = data.metadata?.plan || planNameToKey(data.plan?.name) || planNameToKey(data.plan_object?.name) || "professional";
    if (userId) {
      await sbService(env, `/profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          plan,
          paystack_customer_code: data.customer?.customer_code || null,
          paystack_subscription_code: data.subscription_code || null,
          paystack_authorization_code: data.authorization?.authorization_code || null,
          plan_renews_at: data.next_payment_date || null
        })
      });
    }
  }
  if (eventType === "subscription.disable" || eventType === "subscription.not_renew") {
    const userId = data.metadata?.user_id || null;
    if (userId) {
      await sbService(env, `/profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ plan: "starter" })
      });
    }
  }
  return new Response("ok", { status: 200, headers: corsHeaders });
}
async function handleStripeCheckout(request, auth, env) {
  if (auth.kind !== "user") return unauthorized();
  if (!env.STRIPE_SECRET_KEY) return json({ error: "stripe_not_configured" }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_json");
  }
  const priceId = stripePriceMap(env)[body.plan];
  if (!priceId) return badRequest("unknown_plan");
  const origin = request.headers.get("Origin") || "https://jamilformula.com";
  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    customer_email: auth.email,
    "metadata[user_id]": auth.userId,
    "metadata[plan]": body.plan,
    success_url: `${origin}/dashboard.html?checkout=success`,
    cancel_url: `${origin}/pricing.html?checkout=cancel`
  });
  const r = await fetch(`${STRIPE_API}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  if (!r.ok) {
    return json({ error: "stripe_error", detail: (await r.text()).slice(0, 300) }, 500);
  }
  const session = await r.json();
  return json({ url: session.url, id: session.id });
}
async function handleStripeWebhook(request, env) {
  const body = await request.text();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response("webhook not configured", { status: 503, headers: corsHeaders });
  }
  const sigHeader = request.headers.get("stripe-signature") || "";
  const sigOk = await verifyStripeSignature(body, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!sigOk) {
    return new Response("invalid signature", { status: 401, headers: corsHeaders });
  }
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("invalid", { status: 400, headers: corsHeaders });
  }
  const type = event?.type || "";
  const obj = event?.data?.object || {};
  if (type === "checkout.session.completed" || type === "customer.subscription.updated") {
    const userId = obj.metadata?.user_id || obj.subscription?.metadata?.user_id;
    const plan = obj.metadata?.plan || "professional";
    if (userId) {
      await sbService(env, `/profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ plan, stripe_customer_id: obj.customer || null })
      });
    }
  }
  if (type === "customer.subscription.deleted") {
    const userId = obj.metadata?.user_id;
    if (userId) {
      await sbService(env, `/profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ plan: "starter" })
      });
    }
  }
  return new Response("ok", { status: 200, headers: corsHeaders });
}

// worker-src/handlers/chem.js
var TIMEOUT_MS = 3e4;
async function handleChemProxy(path, request, auth, env) {
  if (!env.CHEM_BACKEND_URL) {
    return json(
      {
        error: "chem_backend_not_configured",
        detail: "RDKit-powered chemistry endpoints require CHEM_BACKEND_URL set in Worker secrets. Deploy the FastAPI backend (see backend/Dockerfile + render.yaml) and point this var at it."
      },
      503
    );
  }
  const targetUrl = new URL("/api" + path, env.CHEM_BACKEND_URL);
  const url = new URL(request.url);
  url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));
  const init = {
    method: request.method,
    headers: {
      "Content-Type": request.headers.get("Content-Type") || "application/json",
      Accept: "application/json",
      // Pass auth context — backend can choose to honour or ignore.
      // These are advisory (the Worker has already authenticated the caller).
      "X-Forwarded-User-Id": auth.userId || "",
      "X-Forwarded-User-Plan": auth.plan || "guest",
      "X-Forwarded-User-Kind": auth.kind || "guest"
    }
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  init.signal = controller.signal;
  try {
    const r = await fetch(targetUrl.toString(), init);
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: {
        ...corsHeaders,
        "Content-Type": r.headers.get("Content-Type") || "application/json"
      }
    });
  } catch (err) {
    if (err.name === "AbortError") {
      return json({ error: "chem_backend_timeout", detail: `>${TIMEOUT_MS}ms` }, 504);
    }
    return json({ error: "chem_backend_unreachable", detail: err.message }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

// worker-src/handlers/backend_proxy.js
var TIMEOUT_MS2 = 6e4;
async function handleBackendProxy(path, request, auth, env) {
  if (!env.CHEM_BACKEND_URL) {
    return json(
      {
        error: "backend_not_configured",
        detail: "The Python backend URL is missing. Set CHEM_BACKEND_URL in Worker secrets to enable /chem/*, /agents/*, and /vision/*."
      },
      503
    );
  }
  const targetUrl = new URL("/api" + path, env.CHEM_BACKEND_URL);
  const url = new URL(request.url);
  url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));
  const init = {
    method: request.method,
    headers: {
      "Content-Type": request.headers.get("Content-Type") || "application/json",
      Accept: "application/json",
      "X-Forwarded-User-Id": auth.userId || "",
      "X-Forwarded-User-Plan": auth.plan || "guest",
      "X-Forwarded-User-Kind": auth.kind || "guest"
    }
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS2);
  init.signal = controller.signal;
  try {
    const r = await fetch(targetUrl.toString(), init);
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: {
        ...corsHeaders,
        "Content-Type": r.headers.get("Content-Type") || "application/json"
      }
    });
  } catch (err) {
    if (err.name === "AbortError") {
      return json({ error: "backend_timeout", detail: `>${TIMEOUT_MS2}ms` }, 504);
    }
    return json({ error: "backend_unreachable", detail: err.message }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

// worker-src/index.js
var SERVICE_VERSION = "Formula AI Brain v8";
function healthResponse() {
  return json({
    status: "ok",
    service: SERVICE_VERSION,
    endpoints: [
      "/search",
      "/usage",
      "/chat",
      "/chat/sessions",
      "/chat/messages",
      "/save_formula",
      "/my_formulas",
      "/library",
      "/prices",
      "/cost",
      "/scale",
      "/extract",
      "/discover",
      "/discover/jobs",
      "/safety",
      "/lab",
      "/paystack/checkout",
      "/paystack/verify",
      "/paystack/webhook",
      "/stripe/checkout",
      "/stripe/webhook",
      "/chem/health",
      "/chem/properties",
      "/chem/properties/batch",
      "/chem/canonicalize",
      "/chem/lipinski",
      "/chem/lookup/name",
      "/chem/lookup/cas",
      "/chem/similarity",
      "/chem/find_similar",
      "/chem/find_substitute",
      "/chem/substructure",
      "/chem/conflict_check",
      "/chem/solubility",
      "/chem/solubility/batch",
      "/chem/stability_predict",
      "/chem/toxicity_scan",
      "/chem/toxicity_scan_formula",
      "/agents/evaluate",
      "/agents/formulate",
      "/agents/run/{name}",
      "/vision/label",
      "/vision/structure",
      "/vision/msds"
    ],
    phases: {
      1: "search",
      2: "auth+limits",
      3: "chat",
      4: "library",
      5: "learn",
      12: "discover (papers+patents)",
      13: "library + cost + scale",
      14: "paystack billing (global, Ghana-friendly)"
    }
  });
}
var index_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/" || path === "/health") return healthResponse();
      if (path === "/stripe/webhook" && request.method === "POST") {
        return await handleStripeWebhook(request, env);
      }
      if (path === "/paystack/webhook" && request.method === "POST") {
        return await handlePaystackWebhook(request, env);
      }
      const auth = await resolveCaller(request, env);
      if (path === "/search") return await handleSearch(url, auth, env);
      if (path === "/usage") return await handleUsage(auth, env);
      if (path === "/chat" && request.method === "POST")
        return await handleChat(request, auth, env);
      if (path === "/chat/sessions" && request.method === "GET")
        return await handleListSessions(auth, env);
      if (path === "/chat/messages" && request.method === "GET")
        return await handleLoadMessages(url, auth, env);
      if (path === "/save_formula" && request.method === "POST")
        return await handleSaveFormula(request, auth, env);
      if (path === "/my_formulas" && request.method === "GET")
        return await handleMyFormulas(auth, env);
      if (path === "/library" && request.method === "GET")
        return await handleLibraryList(auth, env);
      if (path.startsWith("/library/") && request.method === "GET")
        return await handleLibraryGet(path.slice("/library/".length), auth, env);
      if (path.startsWith("/library/") && request.method === "PUT")
        return await handleLibraryUpdate(path.slice("/library/".length), request, auth, env);
      if (path.startsWith("/library/") && request.method === "DELETE")
        return await handleLibraryDelete(path.slice("/library/".length), auth, env);
      if (path === "/prices" && request.method === "GET")
        return await handlePricesList(auth, env);
      if (path === "/prices" && request.method === "POST")
        return await handlePriceUpsert(request, auth, env);
      if (path.startsWith("/prices/") && request.method === "DELETE")
        return await handlePriceDelete(path.slice("/prices/".length), auth, env);
      if (path === "/cost" && request.method === "POST")
        return await handleCost(request, auth, env);
      if (path === "/scale" && request.method === "POST")
        return await handleScale(request, auth, env);
      if (path === "/extract" && request.method === "POST")
        return await handleExtract(request, auth, env);
      if (path === "/discover" && request.method === "POST")
        return await handleDiscover(request, auth, env);
      if (path === "/discover/jobs" && request.method === "GET")
        return await handleListDiscoveryJobs(auth, env);
      if (path === "/discover/debug" && request.method === "GET")
        return await handleDiscoverDebug(url, auth, env);
      if (path === "/safety" && request.method === "POST")
        return await handleSafety(request, env);
      if (path === "/lab" && request.method === "POST")
        return await handleLab(request, env);
      if (path === "/paystack/checkout" && request.method === "POST")
        return await handlePaystackCheckout(request, auth, env);
      if (path === "/paystack/verify" && request.method === "GET")
        return await handlePaystackVerify(url, env);
      if (path === "/stripe/checkout" && request.method === "POST")
        return await handleStripeCheckout(request, auth, env);
      if (path.startsWith("/chem/") || path === "/chem")
        return await handleChemProxy(path, request, auth, env);
      if (path.startsWith("/agents/") || path === "/agents")
        return await handleBackendProxy(path, request, auth, env);
      if (path.startsWith("/vision/") || path === "/vision")
        return await handleBackendProxy(path, request, auth, env);
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (err) {
      return json({ error: "unhandled", detail: err.message }, 500);
    }
  }
};
export {
  index_default as default
};
