/* ──────────────────────────────────────────────────────────────────────────
   search-live.js — wires the search UI to the AI Worker
     • Renders results with category, ingredient counts, top components
     • Shows daily usage indicator (e.g. "3 / 10 searches today")
     • Handles rate-limit (429) with an upgrade CTA
     • Click row → /formulas.html?id=…
   Loaded from search.html with: <script src="./assets/search-live.js"></script>
   Depends on FAI_DB (assets/supabase-client.js).
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  function whenReady(fn) {
    if (window.FAI_DB) return fn();
    const id = setInterval(() => { if (window.FAI_DB) { clearInterval(id); fn(); } }, 50);
  }

  whenReady(() => {
    const input    = document.getElementById("search-input");
    const button   = document.getElementById("search-btn");
    const results  = document.getElementById("search-results");
    const sugg     = document.getElementById("search-suggestions");
    if (!input || !button || !results) return;

    /* Inject usage badge near the search button (idempotent) */
    let usageBadge = document.getElementById("fai-usage-badge");
    if (!usageBadge) {
      usageBadge = document.createElement("div");
      usageBadge.id = "fai-usage-badge";
      usageBadge.style.cssText = "margin-top:10px;text-align:center;font-size:0.82rem;color:var(--text-3);";
      button.parentElement?.parentElement?.appendChild(usageBadge);
    }
    refreshUsageBadge();
    async function refreshUsageBadge() {
      try {
        const u = await window.FAI_DB.getUsage();
        if (u && typeof u.used === 'number') {
          const planLabel = u.plan === 'guest'        ? 'Guest'
                          : u.plan === 'starter'      ? 'Free'
                          : u.plan === 'professional' ? 'Pro'
                          : u.plan === 'business'     ? 'Business'
                          : u.plan === 'enterprise'   ? 'Enterprise'
                          : u.plan;
          usageBadge.innerHTML = `<span style="opacity:0.75;">${planLabel}:</span> ${u.used} / ${u.limit} <span data-i18n-ar="بحث اليوم">searches today</span>`;
        }
      } catch (_) {}
    }

    const escape = s => String(s ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");

    function renderRow(f) {
      const compCount = Array.isArray(f.components) ? f.components.length : 0;
      const top = (Array.isArray(f.components) ? f.components.slice(0, 3) : [])
        .map(c => `<span style="color:var(--text-2);font-size:0.85rem;">${escape(c.name_en||"")}<span style="color:var(--text-3);"> ${(c.percentage??0).toFixed(1)}%</span></span>`)
        .join('<span style="color:var(--text-3);margin:0 8px;">·</span>');
      const cat = escape(f.category || "specialty");
      const form = f.form_type ? `<span style="color:var(--text-3);font-size:0.78rem;">${escape(f.form_type)}</span>` : "";
      return `<article class="card" style="padding:22px;margin-bottom:12px;cursor:pointer;" data-id="${escape(f.id)}">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
              <span style="background:rgba(0,255,136,0.12);color:var(--primary);padding:4px 10px;border-radius:999px;font-size:0.78rem;font-weight:600;">🧪 ${cat}</span>
              ${form}
            </div>
            <h3 style="margin:0 0 8px;font-size:1.15rem;line-height:1.4;">${escape(f.name_en||f.name||"—")}</h3>
            <div style="color:var(--text-3);font-size:0.85rem;margin-bottom:6px;">${compCount} ingredients</div>
            ${top ? `<div style="margin-top:6px;">${top}</div>` : ""}
          </div>
          <div style="text-align:right;flex-shrink:0;color:var(--primary);font-weight:700;font-size:0.85rem;">${f.trust_score||0}%</div>
        </div>
      </article>`;
    }

    function renderState(state, body = "") {
      const head = {
        loading: `<div style="text-align:center;padding:32px;color:var(--text-3);"><div style="display:inline-block;width:24px;height:24px;border:2px solid rgba(0,255,136,0.2);border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;"></div><div style="margin-top:12px;font-size:0.9rem;" data-i18n-ar="جاري البحث في 3,381 فورمولا...">Searching 3,381 formulas...</div></div>`,
        empty: `<div style="text-align:center;padding:32px;color:var(--text-3);" data-i18n-ar="لا توجد نتائج. جرّب كلمات أخرى.">No results. Try different keywords.</div>`,
        error: `<div style="text-align:center;padding:32px;color:#ff6b6b;">Error: ${escape(body)}</div>`,
        limit: `<div class="card" style="padding:32px;text-align:center;">
          <div style="font-size:2.4rem;margin-bottom:12px;">⏳</div>
          <h3 style="margin-bottom:8px;" data-i18n-ar="وصلت للحد اليومي">Daily limit reached</h3>
          <p style="color:var(--text-2);margin-bottom:18px;">${escape(body)}</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <a href="./register.html" class="btn btn-primary" data-i18n-ar="إنشاء حساب مجاني">Sign up — free 20/day</a>
            <a href="./pricing.html" class="btn btn-ghost" data-i18n-ar="ترقية الخطة">Upgrade</a>
          </div>
        </div>`,
        results: body,
      }[state] || "";
      results.innerHTML = head;
    }

    let inFlight = 0;
    async function runSearch(q) {
      const myCall = ++inFlight;
      if (sugg) sugg.style.display = "none";
      renderState("loading");
      const data = await window.FAI_DB.search(q, { limit: 24 });
      if (myCall !== inFlight) return;

      if (data.error === 'rate_limit') {
        renderState('limit', data.message || 'Daily limit reached. Sign up or upgrade for more.');
        refreshUsageBadge();
        return;
      }
      if (data.error) { renderState("error", data.error); return; }
      if (!data.rows.length) { renderState("empty"); return; }

      const header = `<div style="margin:18px 0 14px;color:var(--text-2);font-size:0.95rem;">${data.count} <span data-i18n-ar="نتيجة لـ">results for</span> <strong>${escape(q)}</strong></div>`;
      renderState("results", header + data.rows.map(renderRow).join(""));
      results.querySelectorAll("[data-id]").forEach(el => {
        el.addEventListener("click", () => {
          window.location.href = `./formulas.html?id=${encodeURIComponent(el.dataset.id)}`;
        });
      });
      refreshUsageBadge();
    }

    button.addEventListener("click", () => { const q = (input.value||"").trim(); if (q) runSearch(q); });
    input.addEventListener("keydown", e => { if (e.key === "Enter") { const q = (input.value||"").trim(); if (q) runSearch(q); } });
    document.querySelectorAll(".chip[data-query]").forEach(chip => {
      chip.addEventListener("click", () => { input.value = chip.dataset.query; runSearch(chip.dataset.query); });
    });

    if (!document.getElementById("fai-spin-style")) {
      const s = document.createElement("style");
      s.id = "fai-spin-style";
      s.textContent = "@keyframes spin{to{transform:rotate(360deg);}}";
      document.head.appendChild(s);
    }

    const params = new URLSearchParams(location.search);
    const initial = params.get("q");
    if (initial) { input.value = initial; runSearch(initial); }
  });
})();
