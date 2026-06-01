/**
 * client_error.js — capture real-user (browser) errors (E5 of ROADMAP_TO_10).
 *
 *   POST /be/client-error   (PUBLIC)  body: { message, stack?, source?,
 *                                            line?, col?, page?, ua? }
 *
 * The frontend hooks window.onerror + unhandledrejection (in app.js) and
 * POSTs here. We forward to Sentry + Better Stack via the existing
 * shipError() path, tagged `client_error` so they're filterable apart
 * from server errors. Until now we only saw SERVER breakage; this closes
 * the blind spot on what actually breaks in users' browsers.
 *
 * Abuse control: per-IP rate limit (a buggy/malicious page could loop).
 * Always returns 204 (the browser shouldn't retry or care about the body).
 */
import { shipError } from '../observability.js';
import { rateLimit, clientIP } from '../lib/ratelimit.js';

function cap(s, n) {
  return String(s ?? '').slice(0, n);
}

const NO_CONTENT = () =>
  new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });

export async function handleClientError(request, env) {
  // Cap at 30 reports/min/IP — enough for a genuinely broken session,
  // tight enough that an error loop can't flood Sentry or our bill.
  const ip = clientIP(request);
  const rl = await rateLimit(env, { bucket: `clienterr:${ip}`, limit: 30, window: 60 });
  if (!rl.ok) return NO_CONTENT();   // silently drop excess; don't 429 the browser

  let body;
  try {
    body = await request.json();
  } catch {
    return NO_CONTENT();             // malformed → ignore quietly
  }

  const message = cap(body.message, 500).trim();
  if (!message) return NO_CONTENT();

  // Skip noise we can't act on + common cross-origin script masking.
  if (message === 'Script error.' || message === 'ResizeObserver loop limit exceeded') {
    return NO_CONTENT();
  }

  const syntheticErr = {
    name: 'ClientError',
    message,
    stack: cap(body.stack, 4000) || null,
  };

  // Fire-and-forget ship; never block the response on it.
  try {
    await shipError(
      env,
      syntheticErr,
      { source: 'client' },
      {
        kind: 'client_error',
        page: cap(body.page || body.source, 300),
        line: body.line || null,
        col: body.col || null,
        ua: cap(body.ua, 300),
        ip_prefix: ip.split('.').slice(0, 2).join('.') + '.x.x', // GDPR-light
      }
    );
  } catch {
    /* observability must never break the endpoint */
  }
  return NO_CONTENT();
}
