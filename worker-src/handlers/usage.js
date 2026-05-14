/**
 * usage.js — return the caller's daily search count + limit.
 */
import { json } from '../lib/responses.js';
import { dailyLimitFor } from '../config.js';
import { getDailyUsage } from '../auth.js';

export async function handleUsage(auth, env) {
  const limit = dailyLimitFor(auth.plan);
  const used = await getDailyUsage(auth.id, env);
  return json({
    kind: auth.kind,
    plan: auth.plan,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetsAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
  });
}
