/**
 * claude.js — Anthropic Messages API wrapper with cost guards.
 *
 * Phase 1.2 of BUILD_ROADMAP.md adds:
 *   • Per-plan model selection (paid → Sonnet, free → Haiku).
 *   • Usage-token extraction so callers can persist to api_usage.
 *   • Token-based USD cost estimation.
 *   • One-shot Sonnet→Haiku fallback when Sonnet 429/overloaded.
 *
 * Backward compatibility
 * ----------------------
 * The existing `claudeMessages(env, body)` signature is preserved.
 * Old callers that only check `res.ok && res.data` keep working.
 * New callers get `res.data.usage`, `res.model_used`, `res.fellback`.
 */
import { dailyLimitFor } from '../config.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

// ── Model identifiers (keep in sync with Anthropic console) ─────────
export const CLAUDE_SONNET = 'claude-sonnet-4-5';
export const CLAUDE_HAIKU  = 'claude-haiku-4-5';

/**
 * Default model — kept for any legacy import. New code should call
 * `modelForPlan(plan)` instead so the choice respects the user's tier.
 */
export const CLAUDE_MODEL = CLAUDE_HAIKU;

/**
 * USD pricing per 1 million tokens (Anthropic public list, May 2026).
 * Source of truth for the daily cost-report email. If Anthropic raises
 * prices, update here and redeploy — historical rows keep their
 * already-stored est_cost_usd, so the report stays consistent.
 */
export const PRICING_USD = {
  [CLAUDE_SONNET]: { input: 3.00,  output: 15.00 },
  [CLAUDE_HAIKU]:  { input: 0.80,  output: 4.00  },
};

/**
 * Paid plans get Sonnet (smarter, ~4x output cost). Free/guest get Haiku
 * (still excellent, cheap enough that abuse is non-fatal).
 *
 * The split is deliberately wide so a chemist on the $25/month plan feels
 * a real model upgrade vs an anonymous visitor.
 */
const PAID_PLANS = new Set(['professional', 'business', 'enterprise']);

/**
 * Pick the model to use for a given plan name.
 * @param {string|null|undefined} plan  e.g. 'starter', 'professional', 'enterprise'
 * @returns {string}  Anthropic model id
 */
export function modelForPlan(plan) {
  return PAID_PLANS.has(String(plan || '').toLowerCase()) ? CLAUDE_SONNET : CLAUDE_HAIKU;
}

/**
 * Compute USD cost from a usage object returned by Anthropic.
 * Returns 0 (not NaN) for unknown models so the cron report never breaks.
 *
 * @param {string} model
 * @param {{input_tokens?: number, output_tokens?: number}|null|undefined} usage
 * @returns {number}  USD, rounded to 6 decimals
 */
export function estimateCostUsd(model, usage) {
  const p = PRICING_USD[model];
  if (!p || !usage) return 0;
  const inTok  = Number(usage.input_tokens)  || 0;
  const outTok = Number(usage.output_tokens) || 0;
  const cost = (inTok * p.input + outTok * p.output) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Low-level POST to /v1/messages. Public API preserved from Phase 2.
 * Adds nothing the caller has to think about — the response shape is
 * unchanged: `{ ok, status?, data?, detail? }`.
 *
 * Use `claudeCall()` below if you want cost tracking + auto-fallback.
 *
 * @param {object} env  must contain ANTHROPIC_API_KEY
 * @param {object} body  per Anthropic API
 * @returns {Promise<{ok: boolean, status?: number, data?: object, detail?: string}>}
 */
export async function claudeMessages(env, body) {
  try {
    const r = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_API_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
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

/**
 * High-level Claude call with cost tracking and fallback.
 *
 * Behavior
 * --------
 *   1. Use the plan-appropriate model (Sonnet for paid, Haiku for free).
 *   2. On 429 or 529 (overloaded), retry ONCE with Haiku.
 *   3. Surface `usage`, `model_used`, `fellback`, and `cost_usd` on the
 *      returned object so the caller can record an accurate api_usage row.
 *
 * The body's `model` field is set by this function — callers should NOT
 * pass `model` in the body (it would be overwritten). All other body
 * fields (system, messages, max_tokens, tools, temperature, etc.) pass
 * through verbatim.
 *
 * @param {object} env
 * @param {object} body  Anthropic body WITHOUT the `model` field
 * @param {object} opts
 * @param {string} [opts.plan]    user plan name (default: 'guest')
 * @param {string} [opts.model]   explicit model override (bypasses plan logic)
 * @param {boolean} [opts.allowFallback]  default true; set false to disable retry
 * @returns {Promise<{
 *   ok: boolean,
 *   status?: number,
 *   data?: object,
 *   detail?: string,
 *   model_used?: string,
 *   fellback?: boolean,
 *   usage?: {input_tokens: number, output_tokens: number},
 *   cost_usd?: number
 * }>}
 */
export async function claudeCall(env, body, opts = {}) {
  const wantModel = opts.model || modelForPlan(opts.plan);
  const allowFallback = opts.allowFallback !== false;

  const firstBody = { ...body, model: wantModel };
  let r = await claudeMessages(env, firstBody);

  let fellback = false;
  // Retry on rate-limit / overloaded only when starting from Sonnet.
  if (
    !r.ok &&
    allowFallback &&
    wantModel === CLAUDE_SONNET &&
    (r.status === 429 || r.status === 529 || r.status === 503)
  ) {
    const fallbackBody = { ...body, model: CLAUDE_HAIKU };
    const r2 = await claudeMessages(env, fallbackBody);
    if (r2.ok) {
      fellback = true;
      r = r2;
    }
    // If the fallback also fails, return the ORIGINAL error so the caller
    // sees the real cause (Sonnet 429) rather than a chained failure.
  }

  if (!r.ok) {
    return { ...r, model_used: wantModel, fellback: false };
  }

  const modelUsed = fellback ? CLAUDE_HAIKU : wantModel;
  const usage = r.data?.usage || { input_tokens: 0, output_tokens: 0 };
  const cost_usd = estimateCostUsd(modelUsed, usage);

  return {
    ok: true,
    data: r.data,
    model_used: modelUsed,
    fellback,
    usage,
    cost_usd,
  };
}

/**
 * Extract a JSON object from Claude's first text content block.
 * Strips ```json ... ``` fences if present. Returns null on parse failure.
 *
 * Unchanged from Phase 2 — kept here so existing imports don't break.
 */
export function extractClaudeJson(claudeResponse) {
  const text = (claudeResponse?.content?.[0]?.text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/```$/, '')
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

// dailyLimitFor is re-imported above only so this file doesn't become a
// dead-code dependency target during the next refactor — kept as a touch
// point that the cost-guard layer and the rate-limit layer share config.js.
void dailyLimitFor;
