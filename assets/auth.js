/* ──────────────────────────────────────────────────────────────────────────
   auth.js — Supabase Auth integration for jamilformula.com
     • Google OAuth sign-in
     • Email + password sign-in / sign-up
     • Auto-creates `profiles` row on first signup (handled by DB trigger)
     • Exposes window.FAI_AUTH for any page to use
     • Replaces "Sign in / Get Started Free" buttons with the user's name + menu
     • Persists session in localStorage
   Loaded as a module from any page that needs auth:
     <script type="module" src="./assets/auth.js"></script>
   ────────────────────────────────────────────────────────────────────────── */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = "https://ivabcssceeaqgqjzgmdx.supabase.co";
const SUPABASE_ANON = "PASTE_ANON_PUBLIC_KEY_HERE";

// Fail loudly if the anon key wasn't filled in before deploy.
if (!SUPABASE_ANON || SUPABASE_ANON.startsWith('PASTE_') || SUPABASE_ANON.length < 40) {
  const msg = '[FAI auth] SUPABASE_ANON key is missing or still a placeholder. ' +
    'Fill it in assets/auth.js before deploy.';
  console.error(msg);
  throw new Error(msg);
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});

const FAI_AUTH = {
  client: sb,

  /** Current user (null if guest). */
  user: null,

  /** Current session (null if guest). */
  session: null,

  /** Listeners for auth state changes. */
  _listeners: [],
  onChange(fn) {
    this._listeners.push(fn);
    if (this.user !== undefined) fn(this.user, this.session);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  },
  _notify() {
    for (const l of this._listeners) {
      try { l(this.user, this.session); } catch (e) { console.error(e); }
    }
  },

  /** Sign in with Google OAuth (redirects). */
  async signInWithGoogle() {
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard.html`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) alert("Sign-in error: " + error.message);
    return { data, error };
  },

  /** Sign in with email + password. */
  async signInWithPassword(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    return { data, error };
  },

  /** Sign up new user with email + password. */
  async signUp(email, password, fullName) {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || email.split("@")[0] },
        emailRedirectTo: `${window.location.origin}/dashboard.html`,
      },
    });
    return { data, error };
  },

  /** Send password reset email. */
  async resetPassword(email) {
    const { data, error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login.html?reset=1`,
    });
    return { data, error };
  },

  /** Sign out and redirect home. */
  async signOut() {
    await sb.auth.signOut();
    this.user = null;
    this.session = null;
    this._notify();
    window.location.href = "./index.html";
  },

  /** Fetch current profile (subscription tier, usage, etc.). */
  async getProfile() {
    if (!this.user) return null;
    const { data, error } = await sb.from("profiles").select("*").eq("id", this.user.id).single();
    if (error) console.warn("[auth] profile fetch failed:", error);
    return data;
  },

  /** Get the JWT to attach when calling the AI Worker. */
  getAccessToken() {
    return this.session?.access_token || null;
  },
};

/* ─── Init: load existing session, then watch changes ─────────────── */
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  FAI_AUTH.session = session;
  FAI_AUTH.user    = session?.user || null;
  FAI_AUTH._notify();
  installNavbarUI();

  sb.auth.onAuthStateChange((event, sess) => {
    FAI_AUTH.session = sess;
    FAI_AUTH.user    = sess?.user || null;
    FAI_AUTH._notify();
    installNavbarUI();
  });
})();

/* ─── Navbar UI swap ──────────────────────────────────────────────── */
function installNavbarUI() {
  const cta = document.querySelector(".nav-cta");
  if (!cta) return;

  if (FAI_AUTH.user) {
    const name = FAI_AUTH.user.user_metadata?.full_name
              || FAI_AUTH.user.email?.split("@")[0]
              || "User";
    const avatar = FAI_AUTH.user.user_metadata?.avatar_url;
    cta.innerHTML = `
      <div class="user-menu" style="position:relative;">
        <button class="btn btn-ghost user-trigger" style="display:flex; align-items:center; gap:8px;">
          ${avatar
            ? `<img src="${avatar}" alt="" style="width:24px; height:24px; border-radius:50%;">`
            : `<div style="width:24px; height:24px; border-radius:50%; background:var(--grad-primary); display:flex; align-items:center; justify-content:center; color:var(--bg-1); font-weight:800; font-size:0.78rem;">${escapeHTML(name[0].toUpperCase())}</div>`}
          <span>${escapeHTML(name)}</span>
        </button>
        <div class="user-dropdown" style="position:absolute; top:calc(100% + 8px); right:0; background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:8px; min-width:200px; box-shadow:0 8px 24px rgba(0,0,0,0.4); display:none; z-index:1000;">
          <a href="./dashboard.html" style="display:block; padding:10px 12px; color:var(--text-1); text-decoration:none; border-radius:8px;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='transparent'">📊 <span data-i18n-ar="لوحة التحكم">Dashboard</span></a>
          <a href="./pricing.html" style="display:block; padding:10px 12px; color:var(--text-1); text-decoration:none; border-radius:8px;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='transparent'">💳 <span data-i18n-ar="الاشتراك">Subscription</span></a>
          <div style="height:1px; background:var(--border); margin:4px 0;"></div>
          <button onclick="window.FAI_AUTH.signOut()" style="display:block; width:100%; text-align:right; padding:10px 12px; background:none; border:none; color:#f87171; cursor:pointer; border-radius:8px; font:inherit;" onmouseover="this.style.background='rgba(239,68,68,0.08)'" onmouseout="this.style.background='transparent'">🚪 <span data-i18n-ar="تسجيل خروج">Sign out</span></button>
        </div>
      </div>
    `;
    const trigger = cta.querySelector(".user-trigger");
    const dd      = cta.querySelector(".user-dropdown");
    trigger.addEventListener("click", e => {
      e.stopPropagation();
      dd.style.display = dd.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", () => { dd.style.display = "none"; });
  }
  // Else: leave the existing "Sign in / Get Started Free" buttons alone
}

function escapeHTML(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

window.FAI_AUTH = FAI_AUTH;
console.info("[FAI_AUTH] ready");
