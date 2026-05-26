/**
 * insights.js — Claude-powered formula analysis: safety + virtual lab.
 *
 * Both endpoints accept a formula JSON with `components[]` and return
 * structured JSON from Claude.
 *
 * Phase 1.2 added
 * ---------------
 *   • Plan-aware model (Sonnet for paid, Haiku for free) via claudeCall().
 *   • 24-hour KV cache: identical formula → cached analysis, no API call.
 *     Safety / lab predictions are deterministic per ingredient list, so
 *     repeated lookups are pure waste without a cache.
 *   • Usage rows recorded to api_usage so these endpoints finally count
 *     against the per-user daily quota AND show up in the cost report.
 *     (Previously /safety and /lab were unmetered — a real revenue leak
 *      if anyone scripted them.)
 */
import { json, badRequest } from '../lib/responses.js';
import { claudeCall, extractClaudeJson } from '../lib/claude.js';
import { buildCacheKey, cacheGet, cachePut } from '../lib/cache.js';
import { recordUsage } from '../auth.js';

/**
 * Shared call+cache+record pipeline for both safety and lab endpoints.
 *
 * @param {object} env
 * @param {object} auth
 * @param {string} endpoint  '/safety' | '/lab'
 * @param {string} system    Claude system prompt
 * @param {string} userText  Claude user-turn content (the formula summary)
 * @param {number} maxTokens
 * @returns {Promise<Response>}
 */
async function runJsonCall(env, auth, endpoint, system, userText, maxTokens) {
  const messages = [{ role: 'user', content: userText }];

  // Cache key is plan-INDEPENDENT (don't include model) so that when a free
  // user asks the same question a paid user already asked, both reuse the
  // same cached answer. The answer is a property prediction, not a tier
  // benefit — gating it would be pure cost without product value.
  const cacheKey = await buildCacheKey({
    model: endpoint, // namespace per endpoint to avoid cross-collision
    system,
    messages,
  });

  const cached = await cacheGet(env, cacheKey);
  if (cached) {
    const analysis = extractClaudeJson(cached);
    // Even a cache hit consumes a quota slot (cheap, fair, prevents abuse).
    await recordUsage(auth.id, endpoint, env, {
      model: cached._model || null,
      input_tokens: 0,
      output_tokens: 0,
      est_cost_usd: 0,
      cache_hit: true,
    });
    if (!analysis) return json({ error: 'parse_failed' }, 500);
    return json(analysis);
  }

  const cr = await claudeCall(
    env,
    { max_tokens: maxTokens, system, messages },
    { plan: auth.plan }
  );
  if (!cr.ok) {
    await recordUsage(auth.id, endpoint, env, {
      model: cr.model_used || null,
      status_code: cr.status || 500,
    });
    return json({ error: 'claude_error', detail: cr.detail || '' }, cr.status || 500);
  }

  // Tag the cached response with the model used so cache-hit usage rows
  // can record which model originally produced the answer (telemetry only).
  const toCache = { ...cr.data, _model: cr.model_used };
  await cachePut(env, cacheKey, toCache);

  await recordUsage(auth.id, endpoint, env, {
    model: cr.model_used,
    input_tokens:  cr.usage?.input_tokens  || 0,
    output_tokens: cr.usage?.output_tokens || 0,
    est_cost_usd:  cr.cost_usd             || 0,
    cache_hit:     false,
  });

  const analysis = extractClaudeJson(cr.data);
  if (!analysis) return json({ error: 'parse_failed' }, 500);
  return json(analysis);
}

/* ─── /safety ─────────────────────────────────────────────────── */

const SAFETY_SYSTEM = `You are a chemical safety expert. Analyze the given formula and output JSON:
{
  "overall_risk": "safe|caution|warning|dangerous",
  "ghs_classes": ["H315", ...],
  "regulatory_flags": [{"region":"EU","note":"..."},{"region":"US-FDA","note":"..."}],
  "warnings": [{"ingredient":"...","level":"caution","note":"..."}],
  "ppe_required": ["nitrile gloves","safety goggles", ...],
  "storage": "...",
  "summary_ar": "ملخص بالعربية..."
}
Output ONLY JSON, no prose.`;

export async function handleSafety(request, auth, env) {
  let formula;
  try {
    formula = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  if (!formula?.components?.length) return badRequest('missing_components');

  const ingredients = formula.components
    .map((c) => `${c.name_en} (${c.cas_number || 'no-CAS'}) ${c.percentage}%`)
    .join('; ');

  const userText =
    `Formula: ${formula.name_en || formula.name || 'unnamed'}\n` +
    `Ingredients: ${ingredients}\n` +
    `Form type: ${formula.form_type || 'unknown'}`;

  return runJsonCall(env, auth, '/safety', SAFETY_SYSTEM, userText, 800);
}

/* ─── /lab ────────────────────────────────────────────────────── */

const LAB_SYSTEM = `You are a virtual chemistry lab. Predict the physical properties of the given formula. Output ONLY JSON:
{
  "ph_estimate": "5.5-6.5",
  "viscosity_cp": "2000-3000",
  "density_g_ml": "1.02",
  "appearance": "clear viscous liquid",
  "stability": "stable",
  "shelf_life_months": 24,
  "compatibility_notes": ["..."],
  "predicted_issues": []
}`;

export async function handleLab(request, auth, env) {
  let formula;
  try {
    formula = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  if (!formula?.components?.length) return badRequest('missing_components');

  const ingredients = formula.components
    .map((c) => `${c.name_en} (${c.percentage}%)`)
    .join('; ');

  const userText =
    `Formula: ${formula.name_en || formula.name}\n` +
    `Ingredients: ${ingredients}\n` +
    `Form type: ${formula.form_type || 'liquid'}`;

  return runJsonCall(env, auth, '/lab', LAB_SYSTEM, userText, 600);
}
