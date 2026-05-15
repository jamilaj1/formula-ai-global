/**
 * observability.js — Better Stack (Logtail) integration for the
 * Cloudflare Worker.
 *
 * Provides:
 *   • shipLog(env, record)       — fire-and-forget log shipment
 *   • shipError(env, err, ctx)   — capture an exception with stack
 *   • withObservability(handler) — wrap the Worker fetch handler so every
 *                                  request gets timed + auto-shipped
 *
 * Configuration (Cloudflare → Worker → Settings → Variables and Secrets):
 *   BETTER_STACK_TOKEN     (secret) — Logtail source token
 *   BETTER_STACK_HOST      (text)   — default https://in.logs.betterstack.com
 *   SERVICE_NAME           (text)   — default "formula-ai-worker"
 *   SERVICE_ENV            (text)   — default "production"
 *
 * The Worker runtime allows up to 50 simultaneous subrequests per
 * invocation, so we use ctx.waitUntil() (or `event.waitUntil` if available)
 * to make sure the log POST doesn't get terminated when the response
 * returns to the user.
 */

/**
 * GDPR-friendly IP truncation before shipping to a 3rd-party logger.
 *   IPv4 → zero the last octet     (203.0.113.42 → 203.0.113.0)
 *   IPv6 → keep only the /48 prefix
 * Anything unparseable / missing returns "" so a raw address is never shipped.
 */
function anonymizeIp(ip) {
  if (!ip) return '';
  try {
    if (ip.includes(':')) {
      // IPv6 — keep first 3 hextets (~/48), drop the rest
      const head = ip.split(':').slice(0, 3).join(':');
      return `${head}::`;
    }
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    return '';
  } catch {
    return '';
  }
}

function getConfig(env) {
  return {
    token: env.BETTER_STACK_TOKEN || '',
    host:  (env.BETTER_STACK_HOST || 'https://in.logs.betterstack.com').replace(/\/+$/, ''),
    name:  env.SERVICE_NAME || 'formula-ai-worker',
    envName: env.SERVICE_ENV || 'production',
  };
}

/**
 * Fire-and-forget log shipment. Errors swallowed so observability
 * never breaks the user response. Pass `ctx` if you want the runtime
 * to keep the request alive until the POST completes.
 */
export async function shipLog(env, record, ctx) {
  const cfg = getConfig(env);
  if (!cfg.token) return;

  const payload = {
    dt: new Date().toISOString(),
    service: cfg.name,
    env: cfg.envName,
    ...record,
  };

  const p = fetch(cfg.host, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }).catch(() => null);

  // If a context is available, let it linger past the response
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(p);
  } else {
    // Without a context the runtime may cancel the POST — best effort
    await p;
  }
}

export async function shipError(env, err, ctx, extra = {}) {
  await shipLog(env, {
    level: 'error',
    message: err?.message || String(err),
    stack: err?.stack || null,
    ...extra,
  }, ctx);
}

/**
 * Wrap the default Worker fetch handler so every request is:
 *   • timed
 *   • logged (non-2xx and slow requests get shipped)
 *   • exceptions are caught + shipped with stack
 *
 * Usage in index.js:
 *
 *   import { withObservability } from './observability.js';
 *   export default { fetch: withObservability(async (req, env, ctx) => { ... }) };
 */
export function withObservability(handler) {
  return async function wrapped(request, env, ctx) {
    const url = new URL(request.url);
    const start = Date.now();
    let status = 500;
    let errored = false;

    try {
      const response = await handler(request, env, ctx);
      status = response.status;
      errored = status >= 500;
      return response;
    } catch (err) {
      errored = true;
      await shipError(env, err, ctx, {
        method: request.method,
        path: url.pathname,
        cf_ray: request.headers.get('cf-ray') || null,
      });
      return new Response(
        JSON.stringify({ error: 'unhandled', detail: err.message }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    } finally {
      const elapsed = Date.now() - start;
      const path = url.pathname;
      const slow = elapsed > 3000;
      const noisy = path === '/' || path === '/health';
      const shouldShip = errored || status >= 400 || slow || !noisy;
      if (shouldShip) {
        await shipLog(env, {
          level: errored ? 'error' : (status >= 400 ? 'warning' : 'info'),
          message: `${request.method} ${path} → ${status} (${elapsed}ms)`,
          method: request.method,
          path,
          status,
          duration_ms: elapsed,
          slow,
          cf_country: request.cf?.country || null,
          cf_colo: request.cf?.colo || null,
          // GDPR: never ship a raw client IP to the 3rd-party logger.
          ip_prefix: anonymizeIp(request.headers.get('cf-connecting-ip')),
          user_agent: request.headers.get('user-agent') || '',
        }, ctx);
      }
    }
  };
}
