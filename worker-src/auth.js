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

/** Record a usage event. Best-effort; silent failure. */
export async function recordUsage(callerId, endpoint, env) {
  try {
    await sbService(env, '/api_usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ caller_id: callerId, endpoint }),
    });
  } catch (_) {
    /* ignore */
  }
}

export { dailyLimitFor };
