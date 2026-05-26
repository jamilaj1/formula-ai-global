/**
 * auth.js — caller identity resolution + daily usage tracking.
 *
 * Anonymous callers are keyed by `ip:<ip>`; signed-in users by `user:<uuid>`.
 * Usage rows live in the `api_usage` table; service-role is used to bypass
 * RLS for accurate counting.
 */
import { sbUserFromToken, sbService } from './lib/supabase.js';
import { dailyLimitFor } from './config.js';

/**
 * Resolve the caller from the request.
 * @returns {Promise<{kind:'guest'|'user', id:string, plan:string, userId?:string, email?:string}>}
 */
export async function resolveCaller(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    'unknown';

  if (!token) return { kind: 'guest', id: `ip:${ip}`, plan: 'guest' };

  const user = await sbUserFromToken(env, token);
  if (!user || !user.id) return { kind: 'guest', id: `ip:${ip}`, plan: 'guest' };

  // Fetch profile to get plan. Use SERVICE_KEY so RLS policies that lock
  // profiles to the row's owner can't silently downgrade paid users to
  // 'starter' when an internal lookup happens server-side.
  let plan = 'starter';
  try {
    const pr = await sbService(env, `/profiles?id=eq.${user.id}&select=plan`);
    if (pr.ok) {
      const arr = await pr.json();
      if (arr[0]?.plan) plan = arr[0].plan;
    }
  } catch (_) {
    /* fall through with default 'starter' */
  }

  return {
    kind: 'user',
    id: `user:${user.id}`,
    userId: user.id,
    email: user.email,
    plan,
  };
}

/**
 * Return today's usage count for the caller (UTC day boundary).
 * @returns {Promise<number>}
 */
export async function getDailyUsage(callerId, env) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const since = todayStart.toISOString();
  const path = `/api_usage?select=id&caller_id=eq.${encodeURIComponent(callerId)}&created_at=gte.${since}`;
  try {
    const r = await sbService(env, path, { headers: { Prefer: 'count=exact' } });
    if (!r.ok) return 0;
    const range = r.headers.get('content-range') || '';
    const m = range.match(/\/(\d+|\*)$/);
    return m && m[1] !== '*' ? parseInt(m[1], 10) : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Record a usage event. Best-effort; silent failure (a logging miss must
 * never break the user-facing request).
 *
 * Backward-compatible: existing call sites
 *     recordUsage(auth.id, '/search', env)
 * keep working unchanged. New Claude-aware sites pass an optional `meta`
 * object as the fourth argument:
 *     recordUsage(auth.id, '/chat', env, {
 *       model: 'claude-sonnet-4-5',
 *       input_tokens:  res.usage.input_tokens,
 *       output_tokens: res.usage.output_tokens,
 *       est_cost_usd:  res.cost_usd,
 *       cache_hit:     false,
 *     });
 * Non-Claude callers leave `meta` undefined; the new columns stay NULL
 * for those rows, which is how the daily cost report (Phase 1.2 §1.2.7)
 * filters them out (WHERE model IS NOT NULL).
 *
 * @param {string} callerId  'user:<uuid>' or 'ip:<address>'
 * @param {string} endpoint  e.g. '/search', '/chat', '/safety'
 * @param {object} env       Worker env
 * @param {object} [meta]    optional Claude usage metadata
 * @param {string} [meta.model]
 * @param {number} [meta.input_tokens]
 * @param {number} [meta.output_tokens]
 * @param {number} [meta.est_cost_usd]
 * @param {boolean} [meta.cache_hit]
 * @param {number} [meta.status_code]  override default 200 (e.g. 429)
 */
export async function recordUsage(callerId, endpoint, env, meta) {
  try {
    const row = { caller_id: callerId, endpoint };

    // Promote the user uuid into its own column when the caller is a
    // signed-in user, so the FK index speeds up per-user reports.
    if (typeof callerId === 'string' && callerId.startsWith('user:')) {
      row.user_id = callerId.slice(5);
    }

    if (meta && typeof meta === 'object') {
      if (meta.model)         row.model         = meta.model;
      if (meta.input_tokens  != null) row.input_tokens  = meta.input_tokens  | 0;
      if (meta.output_tokens != null) row.output_tokens = meta.output_tokens | 0;
      if (meta.est_cost_usd  != null) row.est_cost_usd  = Number(meta.est_cost_usd);
      if (meta.cache_hit     != null) row.cache_hit     = !!meta.cache_hit;
      if (meta.status_code   != null) row.status_code   = meta.status_code | 0;
    }

    await sbService(env, '/api_usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
  } catch (_) {
    /* ignore — logging must not break the user request */
  }
}

export { dailyLimitFor };
