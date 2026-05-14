/**
 * insights.js — Claude-powered formula analysis: safety + virtual lab.
 *
 * Both endpoints accept a formula JSON with `components[]` and return
 * structured JSON from Claude. No auth required; rate-limited only at
 * the request level by Cloudflare.
 */
import { json, badRequest } from '../lib/responses.js';
import { claudeMessages, extractClaudeJson, CLAUDE_MODEL } from '../lib/claude.js';

/* ─── /safety ─────────────────────────────────────────────────── */

export async function handleSafety(request, env) {
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
  "summary_ar": "ملخص بالعربية..."
}
Output ONLY JSON, no prose.`,
    messages: [
      {
        role: 'user',
        content: `Formula: ${formula.name_en || formula.name || 'unnamed'}\nIngredients: ${ingredients}\nForm type: ${formula.form_type || 'unknown'}`,
      },
    ],
  });

  if (!res.ok) {
    return json({ error: 'claude_error', detail: res.detail }, 500);
  }
  const analysis = extractClaudeJson(res.data);
  if (!analysis) return json({ error: 'parse_failed' }, 500);
  return json(analysis);
}

/* ─── /lab ────────────────────────────────────────────────────── */

export async function handleLab(request, env) {
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
        role: 'user',
        content: `Formula: ${formula.name_en || formula.name}\nIngredients: ${ingredients}\nForm type: ${formula.form_type || 'liquid'}`,
      },
    ],
  });

  if (!res.ok) return json({ error: 'claude_error' }, 500);
  const prediction = extractClaudeJson(res.data);
  if (!prediction) return json({ error: 'parse_failed' }, 500);
  return json(prediction);
}
