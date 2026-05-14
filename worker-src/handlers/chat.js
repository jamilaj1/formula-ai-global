/**
 * chat.js — conversational AI with Claude tool-use (Phase 3).
 *
 * Flow:
 *  1. Receive a user message + optional session_id.
 *  2. Load (or create) the session and its history.
 *  3. Loop: send to Claude with tools attached, execute any tool_use blocks,
 *     feed results back. Stop when Claude responds without a tool call (or
 *     after 5 rounds to prevent runaway).
 *  4. Persist the user message + assistant reply + recorded usage.
 *
 * Tools available to Claude:
 *  - `search_formulas`        → query Supabase by name across many variants
 *  - `get_formula_details`    → fetch one full formula by id
 *  - `save_modified_formula`  → write to user_formulas (requires signed-in user)
 */
import { json, badRequest } from '../lib/responses.js';
import { sb, sbService } from '../lib/supabase.js';
import { CLAUDE_MODEL } from '../lib/claude.js';
import { dailyLimitFor } from '../config.js';
import { getDailyUsage, recordUsage } from '../auth.js';

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
    description:
      'Search the chemical formulas database for matches. Returns top results sorted by trust score. Use this whenever the user asks about a product type or wants to find a formula. Query can be in English or Arabic.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Primary noun or product type (e.g. "shampoo", "hand sanitizer", "shampoo dry hair")',
        },
        category: {
          type: 'string',
          description:
            'Optional category filter (hair_care, skin_care, disinfectants, cleaning, etc.)',
        },
        limit: { type: 'number', description: 'Max results (1-12, default 8)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_formula_details',
    description:
      'Fetch the full ingredient list, percentages, CAS numbers, preparation steps and source for a single formula. Use AFTER the user has picked which formula they want to see.',
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
    description:
      "Save a modified formula to the user's personal library. Use this AFTER the user has explicitly approved a modification you proposed. The new formula keeps a reference to the parent (original) so we can show its origin.",
    input_schema: {
      type: 'object',
      properties: {
        parent_id: {
          type: 'string',
          description:
            'UUID of the original formula it was modified from (optional if creating a brand-new formula)',
        },
        name: {
          type: 'string',
          description:
            'Descriptive name including the modification, e.g. "Hand Sanitizer Gel — Triclosan replaced with Tea Tree Oil"',
        },
        category: { type: 'string' },
        sub_category: { type: 'string' },
        form_type: { type: 'string' },
        components: {
          type: 'array',
          description: 'Full ingredient list with percentages summing to ~100%',
          items: {
            type: 'object',
            properties: {
              name_en: { type: 'string' },
              cas_number: { type: 'string' },
              percentage: { type: 'number' },
              function: { type: 'string' },
            },
            required: ['name_en', 'percentage'],
          },
        },
        process_conditions: {
          type: 'object',
          description: 'Optional: { order_of_addition: "..." }',
        },
        notes: {
          type: 'string',
          description: "Why this version was created (the user's original requirement)",
        },
      },
      required: ['name', 'components'],
    },
  },
];

/** Execute one tool call from Claude and return a JSON-serialisable result. */
async function executeChatTool(toolName, toolInput, env, auth) {
  if (toolName === 'save_modified_formula') {
    if (!auth || auth.kind !== 'user') {
      return {
        error: 'auth_required',
        detail: 'User must be signed in to save modified formulas.',
      };
    }
    if (
      !toolInput.name ||
      !Array.isArray(toolInput.components) ||
      !toolInput.components.length
    ) {
      return { error: 'missing_fields' };
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
      notes: toolInput.notes || null,
    };
    const r = await sbService(env, '/user_formulas', {
      method: 'POST',
      headers: {
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
    const select =
      'id,name,name_en,category,sub_category,form_type,trust_score,source_title,source_year';

    // Build a list of candidate search terms — every meaningful word, plus the full phrase.
    const stop = new Set([
      'the', 'a', 'an', 'for', 'with', 'of', 'in', 'to', 'and', 'or', 'on', 'from',
      'high', 'low', 'quality', 'economical', 'natural', 'herbal', 'pure', 'best', 'good',
    ]);
    const words = rawQuery
      .toLowerCase()
      .replace(/[%_,()*-]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stop.has(w));
    const variants = [];
    if (rawQuery.length >= 3) variants.push(rawQuery);
    for (const w of words) if (!variants.includes(w)) variants.push(w);

    const seen = new Set();
    const all = [];
    let attemptedCategoryFallback = false;

    for (const v of variants) {
      const safe = v.replace(/[%_,()*]/g, '').trim();
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
        const safe = v.replace(/[%_,()*]/g, '').trim();
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
      category_fallback_used: attemptedCategoryFallback,
    };
  }

  if (toolName === 'get_formula_details') {
    const id = String(toolInput.formula_id || '').trim();
    if (!id) return { error: 'missing_id' };
    const r = await sb(env, `/formulas?id=eq.${id}&select=*`);
    if (!r.ok) return { error: 'db_error' };
    const arr = await r.json();
    if (!arr.length) return { error: 'not_found' };
    return { formula: arr[0] };
  }

  return { error: 'unknown_tool' };
}

/* ─── Session + history persistence ──────────────────────────── */

async function createChatSession(auth, title, env) {
  try {
    const payload = { title: (title || 'New chat').slice(0, 80) };
    if (auth.kind === 'user') payload.user_id = auth.userId;
    else payload.guest_id = auth.id;
    const r = await sbService(env, '/chat_sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
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
    await sbService(env, '/chat_messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ session_id: sessionId, role, content }),
    });
  } catch {
    /* ignore */
  }
}

function claudeMessageFromRow(row) {
  if (row.role === 'user') return { role: 'user', content: row.content?.text || '' };
  if (row.role === 'assistant')
    return { role: 'assistant', content: row.content?.text || '' };
  return null;
}

/* ─── /chat ──────────────────────────────────────────────────── */

export async function handleChat(request, auth, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  const userMessage = String(body.message || '').trim();
  if (!userMessage) return badRequest('empty_message');

  // Daily limit shared with /search
  const limit = dailyLimitFor(auth.plan);
  const used = await getDailyUsage(auth.id, env);
  if (used >= limit) {
    return json(
      {
        error: 'rate_limit_exceeded',
        detail: `Daily limit reached (${used}/${limit}). Upgrade or sign in for more.`,
        limit,
        used,
        plan: auth.plan,
      },
      429
    );
  }

  let sessionId = body.session_id || null;
  if (!sessionId) {
    sessionId = await createChatSession(auth, userMessage.slice(0, 60), env);
    if (!sessionId) return json({ error: 'session_create_failed' }, 500);
  }

  const history = await loadChatHistory(sessionId, env);
  await saveChatMessage(sessionId, 'user', { text: userMessage }, env);

  const messages = [
    ...history.map((m) => claudeMessageFromRow(m)),
    { role: 'user', content: userMessage },
  ];

  const formulaRefs = [];
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
        model: CLAUDE_MODEL,
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

    const blocks = cd.content || [];
    const textBlocks = blocks.filter((b) => b.type === 'text');
    const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use');

    if (textBlocks.length) {
      finalText = textBlocks.map((b) => b.text).join('\n').trim();
    }

    if (stopReason !== 'tool_use' || !toolUseBlocks.length) {
      messages.push({ role: 'assistant', content: blocks });
      break;
    }

    messages.push({ role: 'assistant', content: blocks });

    const toolResults = [];
    for (const tu of toolUseBlocks) {
      const result = await executeChatTool(tu.name, tu.input, env, auth);
      if (tu.name === 'search_formulas' && Array.isArray(result.rows)) {
        formulaRefs.push(
          ...result.rows.map((r) => ({
            id: r.id,
            name: r.name_en || r.name,
            trust: r.trust_score,
          }))
        );
      }
      if (tu.name === 'get_formula_details' && result.formula) {
        formulaRefs.push({
          id: result.formula.id,
          name: result.formula.name_en || result.formula.name,
          trust: result.formula.trust_score,
          full: true,
        });
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  await saveChatMessage(
    sessionId,
    'assistant',
    { text: finalText, formula_refs: formulaRefs },
    env
  );

  await recordUsage(auth.id, '/chat', env);

  return json({
    session_id: sessionId,
    reply: finalText,
    formula_refs: formulaRefs,
    usage: { used: used + 1, limit, plan: auth.plan },
  });
}

/* ─── /chat/sessions ─────────────────────────────────────────── */

export async function handleListSessions(auth, env) {
  if (auth.kind !== 'user') return json({ sessions: [] });
  try {
    const path = `/chat_sessions?user_id=eq.${auth.userId}&select=id,title,created_at,updated_at&order=updated_at.desc&limit=50`;
    const r = await sbService(env, path);
    if (!r.ok) return json({ sessions: [] });
    return json({ sessions: await r.json() });
  } catch {
    return json({ sessions: [] });
  }
}

/* ─── /chat/messages ─────────────────────────────────────────── */

export async function handleLoadMessages(url, auth, env) {
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) return badRequest('missing_session_id');

  if (auth.kind === 'user') {
    const own = await sbService(
      env,
      `/chat_sessions?id=eq.${sessionId}&user_id=eq.${auth.userId}&select=id`
    );
    if (!own.ok) return json({ error: 'forbidden' }, 403);
    const arr = await own.json();
    if (!arr.length) return json({ error: 'not_found' }, 404);
  }
  const r = await sbService(
    env,
    `/chat_messages?session_id=eq.${sessionId}&select=role,content,created_at&order=created_at.asc&limit=200`
  );
  if (!r.ok) return json({ messages: [] });
  return json({ session_id: sessionId, messages: await r.json() });
}
