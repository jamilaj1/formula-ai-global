/**
 * supabase-client.js v8 — frontend data + checkout helpers.
 *
 * CRITICAL: shares the SAME Supabase client as assets/auth.js — creating
 * a second GoTrueClient on the same page (which we did before v8) makes
 * the two clients race for the auth-token storage key and randomly drops
 * the user's session ("Multiple GoTrueClient instances detected" in the
 * console). One client end-to-end fixes it.
 *
 *   • search()                → Cloudflare AI Worker (with JWT)
 *   • getById / getProfile    → direct Supabase via the shared client
 *   • getUsage / startCheckout → Worker passthroughs (Paystack/Stripe)
 */
const WORKER_URL = "https://formula-ai-brain.jamilaj1.workers.dev";

if (!window.FAI_AUTH || !window.FAI_AUTH.client) {
  // auth.js MUST be loaded before this script (both are type="module" so
  // we control order via the order of <script> tags in every HTML head).
  throw new Error(
    "[FAI_DB] assets/auth.js must be loaded before assets/supabase-client.js — " +
    "add <script type=\"module\" src=\"./assets/auth.js\"></script> before this file."
  );
}
const sb = window.FAI_AUTH.client;

async function authHeaders() {
  const { data: { session } } = await sb.auth.getSession();
  const h = { 'Accept': 'application/json' };
  if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
  return h;
}

const FAI_DB = {
  async search(query, opts = {}) {
    if (!query || !query.trim()) return { rows: [], count: 0, plan: null, usage: null, error: null };
    try {
      const url = `${WORKER_URL}/search?q=${encodeURIComponent(query.trim())}`;
      const r = await fetch(url, { headers: await authHeaders() });
      return await r.json();
    } catch (err) { return { error: err.message, rows: [], count: 0 }; }
  },

  async getById(id) {
    // Server-side gate (Phase 1.1, BUILD_ROADMAP.md). The `get_formula`
    // SECURITY DEFINER RPC enforces the paid/credits check on the
    // server and strips source_* unconditionally. Direct SELECT on the
    // `formulas` table is now denied for anon + authenticated by RLS,
    // so the only way to read a single formula is through this RPC.
    //
    // Response shape:
    //   { id, name, ..., trust_score, _gated: true|false,
    //     components, process_conditions, quality_control,
    //     safety_warnings, scientific_basis }   ← gated fields only
    //                                              present when _gated=false.
    const { data, error } = await sb.rpc('get_formula', { formula_id: id });
    if (error) return { error: error.message };
    if (!data) return { error: 'not_found' };
    return data;
  },

  async getUsage() {
    try {
      const r = await fetch(`${WORKER_URL}/usage`, { headers: await authHeaders() });
      return await r.json();
    } catch { return null; }
  },

  async getSafety(formula) {
    try {
      const r = await fetch(`${WORKER_URL}/safety`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ formula }),
      });
      return await r.json();
    } catch (err) { return { error: err.message }; }
  },

  async getLab(formula) {
    try {
      const r = await fetch(`${WORKER_URL}/lab`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ formula }),
      });
      return await r.json();
    } catch (err) { return { error: err.message }; }
  },

  /** Start a checkout — Paystack first (Ghana+global), Stripe fallback. */
  async startCheckout(plan) {
    try {
      const r = await fetch(`${WORKER_URL}/paystack/checkout`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const j = await r.json();
      if (j.url) { window.location.href = j.url; return j; }
      if (j.error === 'paystack_not_configured') return this.startStripeCheckout(plan);
      return j;
    } catch (err) { return { error: err.message }; }
  },

  async startStripeCheckout(plan) {
    try {
      const r = await fetch(`${WORKER_URL}/stripe/checkout`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const j = await r.json();
      if (j.url) window.location.href = j.url;
      return j;
    } catch (err) { return { error: err.message }; }
  },

  async verifyPaystack(reference) {
    try {
      const r = await fetch(`${WORKER_URL}/paystack/verify?reference=${encodeURIComponent(reference)}`, {
        headers: await authHeaders(),
      });
      return await r.json();
    } catch (err) { return { error: err.message }; }
  },

  /** Auth helpers (sign-in / sign-out, etc.) */
  async signInWithPassword(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { user: data.user, session: data.session };
  },

  async signUp(email, password, metadata = {}) {
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: metadata } });
    if (error) return { error: error.message };
    return { user: data.user, session: data.session };
  },

  async signInWithGoogle() {
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/account.html` },
    });
    if (error) return { error: error.message };
    return data;
  },

  async signOut() {
    const { error } = await sb.auth.signOut();
    return error ? { error: error.message } : { success: true };
  },

  async getUser() {
    const { data: { user } } = await sb.auth.getUser();
    return user;
  },

  async getProfile() {
    const user = await this.getUser();
    if (!user) return null;
    const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
    if (error) return null;
    return data;
  },

  /** Public contributor info (display_name, badge, count) — safe to read
   *  anonymously via the public_profiles view (no email/credits exposed). */
  async getContributor(id) {
    if (!id) return null;
    const { data, error } = await sb.from('public_profiles')
      .select('*').eq('id', id).maybeSingle();
    if (error) return null;
    return data;
  },
};

window.FAI_DB = FAI_DB;