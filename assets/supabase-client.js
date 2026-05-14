/**
 * supabase-client.js v6 — frontend client
 *   • search() → routes through Cloudflare AI Worker (with auth header if signed in)
 *   • getById / browse → direct Supabase
 *   • getUsage / startCheckout → Worker passthroughs
 *   • Surfaces rate-limit info to callers
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = "https://ivabcssceeaqgqjzgmdx.supabase.co";
const SUPABASE_ANON = "PASTE_ANON_PUBLIC_KEY_HERE";
const WORKER_URL    = "https://formula-ai-brain.jamilaj1.workers.dev";

// Fail loudly during deploy if someone forgot to fill in the anon key.
// Without this, every auth + DB call silently 401s and the user sees a
// blank page they can't debug.
if (!SUPABASE_ANON || SUPABASE_ANON.startsWith('PASTE_') || SUPABASE_ANON.length < 40) {
  const msg = '[FAI] SUPABASE_ANON key is missing or still a placeholder. ' +
    'Fill it in assets/supabase-client.js before deploy.';
  console.error(msg);
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      const banner = document.createElement('div');
      banner.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:99999;padding:12px;' +
        'background:#b91c1c;color:#fff;font-family:system-ui;text-align:center;';
      banner.textContent = msg;
      document.body.prepend(banner);
    });
  }
  throw new Error(msg);
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage },
});

async function authHeaders() {
  const { data: { session } } = await sb.auth.getSession();
  const h = { 'Accept': 'application/json' };
  if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
  return h;
}

const FAI_DB = {
  async search(query, opts = {}) {
    if (!query || !query.trim()) {
      return { rows: [], count: 0, plan: null, usage: null, error: null };
    }
    try {
      const url  = `${WORKER_URL}/search?q=${encodeURIComponent(query.trim())}`;
      const res  = await fetch(url, { headers: await authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        return {
          rows: [], count: 0, plan: data.plan || null,
          usage: { used: data.used, limit: data.limit, plan: data.plan },
          error: 'rate_limit',
          message: data.detail || 'Daily search limit reached',
        };
      }
      if (!res.ok) {
        return { rows: [], count: 0, plan: null, usage: null, error: data.error || `HTTP ${res.status}` };
      }
      return {
        rows: Array.isArray(data.rows) ? data.rows : [],
        count: data.count || 0,
        plan: data.plan || null,
        usage: data.usage || null,
        error: data.error || null,
      };
    } catch (err) {
      return { rows: [], count: 0, plan: null, usage: null, error: err.message };
    }
  },

  async getUsage() {
    try {
      const r = await fetch(`${WORKER_URL}/usage`, { headers: await authHeaders() });
      return await r.json();
    } catch (err) {
      return { error: err.message };
    }
  },

  async getById(id) {
    const { data, error } = await sb.from("formulas").select("*").eq("id", id).single();
    return { row: data, error };
  },

  async browse({ limit = 24, offset = 0, category = null } = {}) {
    let q = sb.from("formulas")
      .select("id,name,name_en,category,sub_category,form_type,components,trust_score", { count: "exact" })
      .order("trust_score", { ascending: false })
      .range(offset, offset + limit - 1);
    if (category) q = q.eq("category", category);
    const { data, error, count } = await q;
    return { rows: data || [], count: count || 0, error };
  },

  /** Analyze formula safety via Claude (worker /safety route). */
  async analyzeSafety(formula) {
    try {
      const r = await fetch(`${WORKER_URL}/safety`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(formula),
      });
      return await r.json();
    } catch (err) {
      return { error: err.message };
    }
  },

  /** Predict lab properties via Claude (worker /lab route). */
  async predictLab(formula) {
    try {
      const r = await fetch(`${WORKER_URL}/lab`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(formula),
      });
      return await r.json();
    } catch (err) {
      return { error: err.message };
    }
  },

  /** Start a checkout (Paystack first for global+Ghana, falls back to Stripe). */
  async startCheckout(plan) {
    // Try Paystack first — Ghana-friendly, supports global cards
    try {
      const r = await fetch(`${WORKER_URL}/paystack/checkout`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const j = await r.json();
      if (j.url) { window.location.href = j.url; return j; }
      // If Paystack isn't configured, fall back to Stripe
      if (j.error === 'paystack_not_configured') {
        return this.startStripeCheckout(plan);
      }
      return j;
    } catch (err) {
      return { error: err.message };
    }
  },

  /** Stripe checkout (legacy fallback). */
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
    } catch (err) {
      return { error: err.message };
    }
  },

  /** Verify a Paystack transaction by reference (used on the callback page). */
  async verifyPaystack(reference) {
    try {
      const r = await fetch(`${WORKER_URL}/paystack/verify?reference=${encodeURIComponent(reference)}`, {
        headers: await authHeaders(),
      });
      return await r.json();
    } catch (err) {
      return { error: err.message };
    }
  },
};

window.FAI_DB = FAI_DB;
console.info("[FAI_DB v6] connected to AI Worker with auth + rate limiting");
