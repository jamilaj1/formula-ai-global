/**
 * responses.js — CORS headers + JSON response helper.
 *
 * Note on CORS '*': we use a permissive Allow-Origin because the Worker is
 * a public API. Auth is enforced via Bearer token, not credentials/cookies,
 * so '*' is safe in this architecture (browsers reject `*` with `credentials:
 * 'include'` anyway). If you later switch to cookie-based auth, restrict
 * Allow-Origin to your domain explicitly.
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

/**
 * Build a JSON Response with CORS headers attached.
 * @param {unknown} data
 * @param {number} [status]
 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Build a plain-text Response with CORS headers. */
export function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
  });
}

/** Build a 401 with a short reason. */
export function unauthorized(reason = 'auth_required') {
  return json({ error: reason }, 401);
}

/** Build a 400 with a short reason + optional detail. */
export function badRequest(reason, detail) {
  return json(detail ? { error: reason, detail } : { error: reason }, 400);
}
