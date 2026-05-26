/**
 * ratelimit.js — fixed-window per-key rate limiter backed by Cloudflare KV.
 *
 * Why
 * ----
 * Phase 1.1 of BUILD_ROADMAP.md — without this, a competitor can hammer
 * /search 1,000 times in a minute from one IP and walk away with the
 * full ranking signal. Anon abuse can also detonate the Anthropic bill.
 *
 * How
 * ---
 * Each call increments a counter in KV under a key that includes the
 * caller identity and a 60-second time-bucket. The bucket boundary is
 * computed as floor(now / windowSeconds) — no sliding window, just
 * fixed; that is enough to stop scraping and abuse and is cheap in KV
 * operations (1 read + 1 write per request).
 *
 * Required Worker binding
 * ------------------------
 *   [[kv_namespaces]]
 *   binding = "RATELIMIT_KV"
 *   id      = "<your KV namespace id>"
 *
 * Usage
 * -----
 *   import { rateLimit, rateLimitResponse } from '../lib/ratelimit.js';
 *
 *   const rl = await rateLimit(env, {
 *     bucket: 'search:anon:' + clientIP(request),
 *     limit:  30,           // 30 calls per window
 *     window: 60,           // 60 seconds
 *   });
 *   if (!rl.ok) return rateLimitResponse(rl);
 *
 * If RATELIMIT_KV is not bound (e.g. local dev), the limiter fails OPEN
 * (allows the request) and logs a warning. We do not want a missing KV
 * binding to take the site offline.
 */

/** Compute the current fixed bucket id (seconds-since-epoch / window). */
function currentBucket(windowSeconds) {
  return Math.floor(Date.now() / 1000 / windowSeconds);
}

/** Read the visitor's IP, with proxy headers respected (Cloudflare). */
export function clientIP(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    request.headers.get('X-Real-IP') ||
    'unknown'
  );
}

/**
 * Increment + check.
 *
 * @param {object} env       Worker env (must contain RATELIMIT_KV).
 * @param {object} opts
 * @param {string} opts.bucket  Identity key, e.g. 'search:anon:1.2.3.4'.
 * @param {number} opts.limit   Max calls per window.
 * @param {number} opts.window  Window length in seconds.
 * @returns {Promise<{ok: boolean, used: number, limit: number, resetIn: number, retryAfter: number}>}
 */
export async function rateLimit(env, { bucket, limit, window }) {
  if (!env || !env.RATELIMIT_KV) {
    console.warn('[ratelimit] RATELIMIT_KV not bound — failing open');
    return { ok: true, used: 0, limit, resetIn: 0, retryAfter: 0 };
  }
  const win = Math.max(1, Number(window) || 60);
  const max = Math.max(1, Number(limit) || 30);
  const b = currentBucket(win);
  const key = `${bucket}:${b}`;
  // Read previous count (may be null on first hit).
  const prev = await env.RATELIMIT_KV.get(key);
  const used = (prev ? parseInt(prev, 10) : 0) + 1;
  // Write back. expirationTtl = window + 5 s to be safe across the boundary.
  await env.RATELIMIT_KV.put(key, String(used), { expirationTtl: win + 5 });
  const resetIn = win - (Math.floor(Date.now() / 1000) % win);
  if (used > max) {
    return { ok: false, used, limit: max, resetIn, retryAfter: resetIn };
  }
  return { ok: true, used, limit: max, resetIn, retryAfter: 0 };
}

/** Build a 429 Response with the right headers. */
export function rateLimitResponse(rl, message = 'rate_limit_exceeded') {
  return new Response(
    JSON.stringify({
      error: message,
      detail: `You have made ${rl.used} requests; the limit is ${rl.limit} per window. Try again in ${rl.resetIn}s.`,
      limit: rl.limit,
      used: rl.used,
      retry_after: rl.retryAfter,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(rl.retryAfter),
        'X-RateLimit-Limit': String(rl.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(rl.resetIn),
      },
    }
  );
}
