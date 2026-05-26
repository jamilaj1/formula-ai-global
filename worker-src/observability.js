/**
 * observability.js — Better Stack (logs) + Sentry (exceptions) integration
 * for the Cloudflare Worker.
 *
 * Phase 1.3 of BUILD_ROADMAP.md adds Sentry on top of the existing
 * Better Stack pipeline:
 *
 *   • Better Stack receives every NON-2xx and every slow (>3s) request as
 *     a structured log line. Good for the "what happened to user X's
 *     request 5 minutes ago" question.
 *   • Sentry receives unhandled exceptions WITH stack traces, grouped by
 *     fingerprint. Good for "this NullPointer happened 47 times today,
 *     here's the latest occurrence, here are the affected users."
 *
 * Both pipelines are best-effort: if either token/DSN is unset or the
 * 3rd party is unreachable, the user response is never affected.
 *
 * Public API
 * ----------
 *   shipLog(env, record, ctx)              — Better Stack
 *   shipError(env, err, ctx, extra)        — Better Stack + Sentry
 *   shipSentry(env, err, ctx, extra)       — Sentry only (rarely called direct)
 *   withObservability(handler)             — wraps the Worker fetch handler
 *
 * Configuration (Cloudflare → Worker → Settings → Variables and Secrets)
 * ----------------------------------------------------------------------
 *   BETTER_STACK_TOKEN  (secret) — Logtail source token
 *   BETTER_STACK_HOST   (text)   — default https://in.logs.betterstack.com
 *   SENTRY_DSN          (secret) — full DSN, e.g. https://abc@o12345.ingest.sentry.io/67890
 *   SERVICE_NAME        (text)   — default "formula-ai-worker"
 *   SERVICE_ENV         (text)   — default "production"
 *
 * Either secret can be empty; the corresponding pipeline silently no-ops.
 */

/* ─── IP anonymisation ─────────────────────────────────────────── */

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

/* ─── Config ───────────────────────────────────────────────────── */

/**
 * Strip a leading BOM (U+FEFF) and surrounding whitespace from a secret.
 *
 * Why: PowerShell on Windows pipes strings through UTF-16 LE encoding
 * and prepends a BOM. When a user runs
 *   "https://..." | npx wrangler secret put SENTRY_DSN
 * the stored secret silently starts with U+FEFF, which makes `new URL()`
 * throw and our DSN parse fail. Stripping it here is a no-op for cleanly-
 * uploaded secrets and a save for PowerShell-pipe users.
 */
function cleanSecret(s) {
  if (typeof s !== 'string') return '';
  // Strip leading BOM (U+FEFF) and zero-width-space (U+200B) plus any
  // whitespace, then trim trailing whitespace. PowerShell pipes (`| wrangler
  // secret put`) prepend a BOM on Windows, which makes new URL() throw and
  // any header value look subtly wrong; this is a one-time hardening so a
  // re-upload from a clean shell isn't required.
  return s
    .replace(/^[\u{FEFF}\u{200B}\s]+/u, '')
    .replace(/\s+$/, '');
}

function getConfig(env) {
  return {
    bsToken: cleanSecret(env.BETTER_STACK_TOKEN),
    bsHost:  cleanSecret(env.BETTER_STACK_HOST || 'https://in.logs.betterstack.com').replace(/\/+$/, ''),
    sentryDsn: cleanSecret(env.SENTRY_DSN),
    name:    env.SERVICE_NAME || 'formula-ai-worker',
    envName: env.SERVICE_ENV  || 'production',
  };
}

/**
 * Parse a Sentry DSN into the bits we need to hit the envelope endpoint.
 * Returns null on a malformed/empty DSN so callers can skip silently.
 *
 * DSN shape:
 *   https://<publicKey>@<host>/<projectId>
 * Envelope endpoint:
 *   https://<host>/api/<projectId>/envelope/
 */
function parseSentryDsn(dsn) {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, '');
    if (!u.username || !projectId) return null;
    return {
      publicKey: u.username,
      host: u.host,
      projectId,
      envelopeUrl: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

/* ─── Better Stack: shipLog / shipError ────────────────────────── */

/**
 * Fire-and-forget log shipment to Better Stack.
 * Errors swallowed so observability never breaks the user response.
 */
export async function shipLog(env, record, ctx) {
  const cfg = getConfig(env);
  if (!cfg.bsToken) return;

  const payload = {
    dt: new Date().toISOString(),
    service: cfg.name,
    env: cfg.envName,
    ...record,
  };

  const p = fetch(cfg.bsHost, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.bsToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }).catch(() => null);

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(p);
  } else {
    await p;
  }
}

/**
 * Ship an exception to BOTH Better Stack (for context/timeline) and
 * Sentry (for grouping + alerting). Safe to call on cold start.
 */
export async function shipError(env, err, ctx, extra = {}) {
  await Promise.all([
    shipLog(env, {
      level: 'error',
      message: err?.message || String(err),
      stack: err?.stack || null,
      ...extra,
    }, ctx),
    shipSentry(env, err, ctx, extra),
  ]);
}

/* ─── Sentry: envelope POST ────────────────────────────────────── */

/**
 * Build a Sentry "exception" event using the envelope protocol.
 *
 * Why envelope, not the older /store/ endpoint?
 *   Sentry has been migrating to envelopes since 2021; new SDKs use them
 *   exclusively and Sentry's docs recommend them for all new integrations.
 *   The format is one JSON header + N item blocks separated by newlines.
 *
 * We synthesise a minimal-but-valid event payload by hand instead of
 * pulling in the @sentry/* npm packages — those add ~80 KB to the
 * Worker bundle and they pull in Node.js globals that Workers don't
 * expose. The hand-rolled envelope is ~30 lines and good enough for
 * basic exception reporting; we can upgrade to the official SDK
 * later if/when we need spans, performance, or session replay.
 */
export async function shipSentry(env, err, ctx, extra = {}) {
  const cfg = getConfig(env);
  const dsn = parseSentryDsn(cfg.sentryDsn);
  if (!dsn) return;

  const eventId = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();

  const event = {
    event_id: eventId,
    timestamp: now,
    platform: 'javascript',
    level: 'error',
    server_name: cfg.name,
    environment: cfg.envName,
    release: env.WORKER_VERSION_ID || undefined,
    message: err?.message || String(err),
    exception: {
      values: [
        {
          type: err?.name || 'Error',
          value: err?.message || String(err),
          stacktrace: err?.stack
            ? { frames: parseStackTrace(err.stack) }
            : undefined,
        },
      ],
    },
    tags: {
      service: cfg.name,
      env: cfg.envName,
      ...(extra.path ? { path: extra.path } : {}),
      ...(extra.method ? { method: extra.method } : {}),
    },
    extra,
  };

  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    sent_at: now,
    dsn: cfg.sentryDsn,
  });
  const itemHeader = JSON.stringify({ type: 'event' });
  const itemPayload = JSON.stringify(event);
  const body = `${envelopeHeader}\n${itemHeader}\n${itemPayload}\n`;

  // POST the envelope. Failures are logged to console.error so they show
  // up in `wrangler tail` / Cloudflare Observability — successful deliveries
  // are silent (no need to spam logs on the happy path).
  const p = fetch(dsn.envelopeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      // Sentry expects either an X-Sentry-Auth header or the DSN in the
      // envelope header; we use the DSN form above. The header form is
      // here for redundancy with older relays.
      'X-Sentry-Auth':
        `Sentry sentry_version=7,` +
        `sentry_client=formula-ai-worker/1.0,` +
        `sentry_timestamp=${Math.floor(Date.now() / 1000)},` +
        `sentry_key=${dsn.publicKey}`,
    },
    body,
  }).then(async (r) => {
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 300);
      console.error('[sentry] POST failed', r.status, txt);
    }
    return r;
  }).catch((err) => {
    console.error('[sentry] fetch threw', err?.message);
    return null;
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(p);
  } else {
    await p;
  }
}

/**
 * Naive Error.stack parser. Sentry expects an array of frame objects
 * with `function`, `filename`, `lineno`, `colno`. Our minified Worker
 * bundle won't have great filenames but the function/line info is still
 * useful for grouping. Frames are listed OLDEST-FIRST per Sentry spec.
 *
 * Accepts both V8 ("at func (file:line:col)") and SpiderMonkey style.
 * Falls back to a single "raw" frame if no line matches.
 */
function parseStackTrace(stack) {
  const out = [];
  const lines = String(stack).split('\n');
  // V8 / Node / Workers: "    at funcName (file:line:col)"
  const reAt = /\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
  for (const raw of lines) {
    const m = raw.match(reAt);
    if (m) {
      out.push({
        function: m[1] || '<anonymous>',
        filename: m[2] || '',
        lineno: parseInt(m[3], 10),
        colno: parseInt(m[4], 10),
        in_app: !/node_modules|cloudflareworkers/.test(m[2] || ''),
      });
    }
  }
  if (!out.length) {
    out.push({ function: '<raw>', filename: '', lineno: 0, colno: 0, in_app: true });
  }
  return out.reverse(); // Sentry wants oldest first
}

/* ─── Worker wrapper ───────────────────────────────────────────── */

/**
 * Wrap the default Worker fetch handler so every request is:
 *   • timed
 *   • logged to Better Stack (non-2xx, slow, or unhealthy)
 *   • exceptions are caught and shipped to BOTH Better Stack + Sentry
 *
 * Usage in index.js:
 *
 *   import { withObservability } from './observability.js';
 *   export default {
 *     fetch:     withObservability(async (req, env, ctx) => { ... }),
 *     scheduled: handleScheduled,
 *   };
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
          ip_prefix: anonymizeIp(request.headers.get('cf-connecting-ip')),
          user_agent: request.headers.get('user-agent') || '',
        }, ctx);
      }
    }
  };
}
