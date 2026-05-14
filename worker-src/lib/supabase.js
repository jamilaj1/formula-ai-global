/**
 * supabase.js — thin REST wrapper for Supabase PostgREST.
 *
 * Two flavours:
 *  - `sb()`         uses the anon key (subject to RLS, for public reads).
 *  - `sbService()`  uses the service-role key (bypasses RLS, for trusted writes).
 *
 * Never expose the service-role key to clients.
 */

/** GET / fetch via REST with the anon key. */
export async function sb(env, path, opts = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      ...(opts.headers || {}),
    },
  });
}

/** Same as sb() but with the service-role key (bypasses RLS). */
export async function sbService(env, path, opts = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      ...(opts.headers || {}),
    },
  });
}

/** Resolve a Supabase Auth user from a JWT, or null if invalid. */
export async function sbUserFromToken(env, token) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}
