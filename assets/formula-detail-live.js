/* ──────────────────────────────────────────────────────────────────────────
   formula-detail-live.js — v2 (full, professional)
   Renders the complete formula detail page when ?id=<uuid> is in the URL.
     • Hero card: name, category, trust score, source, language toggle
     • Components table: CAS, percentage, function, phase
     • Preparation steps (process_conditions)
     • Safety warnings panel (auto-derived from ingredient hazards)
     • Action bar: print/PDF, save (auth), find substitutes, similar search
     • Bilingual headings via the same data-i18n-ar pattern as the rest of the site
     • PDF export: clean printable view with hidden navigation
   Loaded from formulas.html with: <script src="./assets/formula-detail-live.js"></script>
   Depends on FAI_DB (assets/supabase-client.js).
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  function whenReady(fn) {
    if (window.FAI_DB) return fn();
    const id = setInterval(() => {
      if (window.FAI_DB) { clearInterval(id); fn(); }
    }, 50);
  }

  /* ─── Translation hints — picked up by app.js i18n ──────────────── */
  const T = (en, ar) => `<span data-i18n-ar="${escapeAttr(ar)}">${en}</span>`;

  function escapeHTML(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function escapeAttr(s) {
    return String(s ?? "").replace(/"/g, "&quot;");
  }

  /* ─── Component function badge colors (visual cue) ──────────────── */
  const FN_COLORS = {
    surfactant: "#00d4ff", "primary surfactant": "#00d4ff",
    "amphoteric co-surfactant": "#22d3ee",
    preservative: "#a78bfa", antimicrobial: "#f472b6", antiseptic: "#f472b6",
    "ph adjuster": "#facc15", "chelating": "#facc15", "ph buffer": "#facc15",
    fragrance: "#fb7185", colorant: "#fb7185", dye: "#fb7185",
    thickener: "#22c55e", emulsifier: "#22c55e", "foam booster": "#22c55e",
    humectant: "#0ea5e9", emollient: "#0ea5e9", moisturizer: "#0ea5e9",
    solvent: "#94a3b8", vehicle: "#94a3b8",
    active: "#f97316", "uv filter": "#f97316",
    builder: "#84cc16", filler: "#84cc16",
  };
  function fnBadge(fn) {
    if (!fn) return "";
    const key = String(fn).toLowerCase();
    let color = "#64748b";
    for (const k of Object.keys(FN_COLORS)) {
      if (key.includes(k)) { color = FN_COLORS[k]; break; }
    }
    return `<span style="display:inline-block; padding:2px 8px; border-radius:6px; background:${color}1A; color:${color}; font-size:0.78rem; font-weight:600;">${escapeHTML(fn)}</span>`;
  }

  /* ─── Risky ingredient detection (basic heuristic) ──────────────── */
  const HAZARD_RULES = [
    { match: /sodium hydroxide|naoh/i,   level: "warning",   note: "Strongly alkaline · skin/eye corrosive in concentrated form" },
    { match: /triclosan/i,               level: "caution",   note: "Antimicrobial · banned in some regions (FDA banned in OTC soap 2017)" },
    { match: /formaldehyde/i,            level: "danger",    note: "Known carcinogen (IARC Group 1)" },
    { match: /paraben|methylparaben|propylparaben/i, level: "caution", note: "Endocrine-disruption concerns · restricted in EU" },
    { match: /phthalat/i,                level: "warning",   note: "Reproductive toxin · banned in toys" },
    { match: /isopropyl alcohol|ipa|ethanol/i, level: "caution", note: "Highly flammable · keep away from heat" },
    { match: /ammonia/i,                 level: "warning",   note: "Respiratory irritant · use ventilation" },
    { match: /sulfuric acid|hydrochloric acid|nitric acid/i, level: "danger", note: "Strong acid · severe burns" },
    { match: /chlorhexidine/i,           level: "caution",   note: "Topical antiseptic · do not ingest" },
    { match: /benzalkonium/i,            level: "caution",   note: "Quaternary ammonium · skin irritation possible" },
    { match: /povidone iodine|pvp-?i/i,  level: "caution",   note: "Iodine-based · avoid on iodine-allergic skin" },
  ];
  function detectHazards(components) {
    const found = [];
    for (const c of components) {
      const name = String(c.name_en || "");
      for (const rule of HAZARD_RULES) {
        if (rule.match.test(name)) {
          found.push({ ingredient: name, level: rule.level, note: rule.note });
        }
      }
    }
    return found;
  }
  const LEVEL_STYLE = {
    danger:  { bg: "rgba(239, 68, 68, 0.12)",  fg: "#f87171", label: "خطر · DANGER" },
    warning: { bg: "rgba(251, 146, 60, 0.12)", fg: "#fb923c", label: "تحذير · WARNING" },
    caution: { bg: "rgba(250, 204, 21, 0.12)", fg: "#facc15", label: "احتياط · CAUTION" },
    info:    { bg: "rgba(0, 212, 255, 0.12)",  fg: "#22d3ee", label: "معلومة · INFO" },
  };

  /* ─── Print / PDF helpers ───────────────────────────────────────── */
  function injectPrintStyles() {
    if (document.getElementById("fai-print-style")) return;
    const s = document.createElement("style");
    s.id = "fai-print-style";
    s.textContent = `
      @media print {
        nav.navbar, footer.footer, .no-print { display: none !important; }
        body { background: white !important; color: black !important; }
        .card { border: 1px solid #ccc !important; box-shadow: none !important; background: white !important; }
        h1, h2, h3 { color: black !important; }
        table { page-break-inside: avoid; }
        thead { background: #f5f5f5 !important; }
        a { color: black !important; text-decoration: none !important; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ─── Main ──────────────────────────────────────────────────────── */
  whenReady(async () => {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (!id) return; // No id → leave the static demo content untouched

    const { row, error } = await window.FAI_DB.getById(id);
    if (error || !row) {
      console.warn("[formula-detail] not found:", error);
      renderNotFound(error?.message || "Formula not found");
      return;
    }

    injectPrintStyles();

    const components = Array.isArray(row.components) ? row.components : [];
    const hasPhase = components.some(c => c.phase);
    const proc = (row.process_conditions && row.process_conditions.order_of_addition) || "";
    const hazards = detectHazards(components);

    const componentRows = components.map((c, i) => `
      <tr>
        <td style="padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.06); color:var(--text-3); width:32px;">${i + 1}</td>
        <td style="padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">
          <strong>${escapeHTML(c.name_en || "—")}</strong>
        </td>
        <td style="padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">
          ${c.cas_number
            ? `<a href="https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(c.cas_number)}" target="_blank" rel="noopener" style="color:var(--secondary); font-family:'Courier New',monospace; font-size:0.85rem;" title="Open in PubChem">${escapeHTML(c.cas_number)}</a>`
            : `<span style="color:var(--text-3);">—</span>`}
        </td>
        <td style="padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.06); text-align:right; white-space:nowrap;">
          <strong style="color:var(--primary);">${(c.percentage ?? 0).toFixed(2)}%</strong>
        </td>
        <td style="padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">${fnBadge(c.function)}</td>
        ${hasPhase ? `<td style="padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.06); color:var(--text-2);">${escapeHTML(c.phase || "")}</td>` : ""}
      </tr>
    `).join("");

    const totalPct = components.reduce((s, c) => s + (Number(c.percentage) || 0), 0);

    const hazardCards = hazards.map(h => {
      const style = LEVEL_STYLE[h.level] || LEVEL_STYLE.info;
      return `
        <div style="background:${style.bg}; border-left:3px solid ${style.fg}; padding:12px 14px; border-radius:8px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:4px; flex-wrap:wrap;">
            <strong style="color:${style.fg};">${escapeHTML(h.ingredient)}</strong>
            <span style="background:${style.fg}; color:#000; padding:2px 8px; border-radius:6px; font-size:0.72rem; font-weight:800; letter-spacing:0.5px;">${style.label}</span>
          </div>
          <div style="color:var(--text-2); font-size:0.88rem;">${escapeHTML(h.note)}</div>
        </div>
      `;
    }).join("");

    const cat = escapeHTML(row.category || "specialty");
    const subCat = row.sub_category ? ` · ${escapeHTML(row.sub_category)}` : "";
    const formType = row.form_type ? `<span style="color:var(--text-3); font-size:0.92rem;">${escapeHTML(row.form_type)}</span>` : "";
    const trustScore = row.trust_score ?? 0;
    const code = row.source_url || row.id?.slice(0, 8);

    const html = `
      <section style="padding: 120px 0 60px;">
        <div class="container" style="max-width: 1100px;">

          <!-- Breadcrumb -->
          <div class="no-print" style="display:flex; align-items:center; gap:8px; color:var(--text-3); font-size:0.9rem; margin-bottom:24px;">
            <a href="./index.html" style="color:var(--text-3);">${T("Home", "الرئيسية")}</a>
            <span>›</span>
            <a href="./search.html" style="color:var(--text-3);">${T("Search", "البحث")}</a>
            <span>›</span>
            <span style="color:var(--text-1);">${escapeHTML(row.name_en || row.name)}</span>
          </div>

          <!-- Hero Card -->
          <div class="card" style="padding:32px; margin-bottom:24px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:18px; flex-wrap:wrap; margin-bottom:20px;">
              <div style="flex:1; min-width:280px;">
                <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
                  <span style="background:rgba(0,255,136,0.12); color:var(--primary); padding:4px 12px; border-radius:999px; font-size:0.78rem; font-weight:700;">🧪 ${cat}${subCat}</span>
                  ${formType}
                </div>
                <h1 style="font-size:1.8rem; margin-bottom:8px; line-height:1.3;">${escapeHTML(row.name_en || row.name)}</h1>
                ${row.name_ar && row.name_ar !== row.name_en ? `<div style="color:var(--text-2); font-size:1.05rem;">${escapeHTML(row.name_ar)}</div>` : ""}
                ${row.description ? `<p style="color:var(--text-2); margin-top:10px; line-height:1.7;">${escapeHTML(row.description)}</p>` : ""}
              </div>

              <div style="text-align:right; flex-shrink:0; min-width:140px;">
                <div style="font-size:0.78rem; color:var(--text-3); margin-bottom:6px;">${T("Trust Score", "درجة الثقة")}</div>
                <div style="font-size:2.4rem; font-weight:900; color:var(--primary); line-height:1;">${trustScore}<span style="font-size:1rem; color:var(--text-3); font-weight:600;">%</span></div>
                <div style="margin-top:14px; font-size:0.78rem; color:var(--text-3);">${T("Code", "الرمز")}</div>
                <code style="color:var(--text-2); font-size:0.82rem;">${escapeHTML(code || "")}</code>
              </div>
            </div>

            ${row.source_title ? `
              <div style="padding-top:14px; border-top:1px solid rgba(255,255,255,0.06); color:var(--text-3); font-size:0.85rem;">
                📚 ${T("Source", "المصدر")}: ${escapeHTML(row.source_title)}${row.source_author ? ` · ${escapeHTML(row.source_author)}` : ""}${row.source_year ? ` · ${row.source_year}` : ""}
              </div>
            ` : ""}
          </div>

          <!-- Action Bar -->
          <div class="no-print" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:24px;">
            <button class="btn btn-primary" onclick="window.print()">
              📄 ${T("Export PDF", "تصدير PDF")}
            </button>
            <button class="btn btn-ghost" onclick="navigator.clipboard.writeText(window.location.href).then(()=>this.textContent='✓ Copied')">
              🔗 ${T("Copy link", "نسخ الرابط")}
            </button>
            <a class="btn btn-ghost" href="./search.html?q=${encodeURIComponent((row.name_en || row.name).split(' ').slice(0, 2).join(' '))}">
              🔍 ${T("Find similar", "ابحث عن مشابه")}
            </a>
            <button class="btn btn-ghost" onclick="alert('${T('Sign in to save formulas', 'سجّل دخول لحفظ الفورمولا')}')">
              ⭐ ${T("Save", "حفظ")}
            </button>
          </div>

          <!-- Components Table -->
          <div class="card" style="padding:32px; margin-bottom:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:18px; flex-wrap:wrap;">
              <h2 style="font-size:1.3rem; margin:0;">${T("Ingredients", "المكوّنات")} <span style="color:var(--text-3); font-weight:400;">(${components.length})</span></h2>
              <div style="font-size:0.85rem; color:var(--text-3);">
                ${T("Total", "المجموع")}: <strong style="color:${Math.abs(totalPct - 100) < 1 ? 'var(--primary)' : 'var(--accent)'};">${totalPct.toFixed(1)}%</strong>
              </div>
            </div>
            <div style="overflow-x:auto; border-radius:10px; border:1px solid rgba(255,255,255,0.06);">
              <table style="width:100%; border-collapse:collapse; font-size:0.94rem;">
                <thead>
                  <tr style="background:rgba(255,255,255,0.02); color:var(--text-3); font-size:0.78rem; text-transform:uppercase; letter-spacing:0.5px;">
                    <th style="text-align:right; padding:12px 8px; font-weight:700;">#</th>
                    <th style="text-align:right; padding:12px 8px; font-weight:700;">${T("Ingredient", "المادة")}</th>
                    <th style="text-align:right; padding:12px 8px; font-weight:700;">CAS</th>
                    <th style="text-align:right; padding:12px 8px; font-weight:700;">%</th>
                    <th style="text-align:right; padding:12px 8px; font-weight:700;">${T("Function", "الوظيفة")}</th>
                    ${hasPhase ? `<th style="text-align:right; padding:12px 8px; font-weight:700;">${T("Phase", "المرحلة")}</th>` : ""}
                  </tr>
                </thead>
                <tbody>${componentRows}</tbody>
              </table>
            </div>
          </div>

          ${proc ? `
            <div class="card" style="padding:32px; margin-bottom:24px;">
              <h2 style="font-size:1.3rem; margin-bottom:14px;">⚗️ ${T("Preparation", "طريقة التحضير")}</h2>
              <p style="color:var(--text-2); line-height:1.9; white-space:pre-wrap; font-size:0.98rem;">${escapeHTML(proc)}</p>
            </div>
          ` : ""}

          ${hazards.length ? `
            <div class="card" style="padding:32px; margin-bottom:24px;">
              <h2 style="font-size:1.3rem; margin-bottom:6px;">⚠️ ${T("Safety Notes", "ملاحظات السلامة")}</h2>
              <p style="color:var(--text-3); font-size:0.88rem; margin-bottom:18px;">
                ${T("Auto-derived from ingredient hazard database.", "مستخلصة تلقائيًا من قاعدة بيانات مخاطر المكوّنات.")}
              </p>
              ${hazardCards}
            </div>
          ` : ""}

          ${row.properties && Object.keys(row.properties).length ? `
            <div class="card" style="padding:32px; margin-bottom:24px;">
              <h2 style="font-size:1.3rem; margin-bottom:14px;">📊 ${T("Properties", "الخصائص")}</h2>
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px;">
                ${Object.entries(row.properties).filter(([_, v]) => v != null && v !== "").map(([k, v]) => `
                  <div style="background:rgba(255,255,255,0.02); padding:14px; border-radius:10px;">
                    <div style="color:var(--text-3); font-size:0.78rem; text-transform:capitalize; margin-bottom:4px;">${escapeHTML(k.replace(/_/g, " "))}</div>
                    <div style="color:var(--text-1); font-weight:600; font-size:1rem;">${escapeHTML(String(v))}</div>
                  </div>
                `).join("")}
              </div>
            </div>
          ` : ""}

          <!-- Disclaimer -->
          <div style="padding:18px; background:rgba(0, 212, 255, 0.06); border-radius:12px; border:1px solid rgba(0, 212, 255, 0.2); color:var(--text-2); font-size:0.85rem; line-height:1.7;">
            <strong style="color:var(--secondary);">📋 ${T("Disclaimer", "إخلاء مسؤولية")}:</strong>
            ${T(
              "This formula is provided for informational and educational purposes. Always perform compatibility tests, consult regulatory standards in your country (FDA / REACH / SFDA / GSO), and follow safe handling practices in a controlled lab environment.",
              "هذه الفورمولا للأغراض المعلوماتية والتعليمية. دائمًا قم باختبارات التوافق، راجع المعايير التنظيمية في بلدك (FDA / REACH / SFDA / GSO)، واتبع ممارسات التداول الآمنة في بيئة مختبرية مضبوطة."
            )}
          </div>

        </div>
      </section>
    `;

    // Replace everything between nav and footer
    const nav    = document.querySelector("nav.navbar");
    const footer = document.querySelector("footer.footer");
    if (nav && footer) {
      let n = nav.nextElementSibling;
      while (n && n !== footer) {
        const next = n.nextElementSibling;
        n.remove();
        n = next;
      }
      footer.insertAdjacentHTML("beforebegin", html);
      document.title = `${row.name_en || row.name} — Formula AI Global`;

      // Re-trigger language application so newly-inserted elements get translated
      if (typeof window.applyLang === "function") {
        try { window.applyLang(); } catch (_) { /* noop */ }
      }
    }
  });

  function renderNotFound(msg) {
    const nav    = document.querySelector("nav.navbar");
    const footer = document.querySelector("footer.footer");
    if (!nav || !footer) return;
    let n = nav.nextElementSibling;
    while (n && n !== footer) {
      const next = n.nextElementSibling;
      n.remove();
      n = next;
    }
    const html = `
      <section style="padding:160px 0 80px;">
        <div class="container" style="max-width:600px; text-align:center;">
          <div style="font-size:4rem; margin-bottom:16px;">🧪</div>
          <h1 style="margin-bottom:12px;" data-i18n-ar="الفورمولا غير موجودة">Formula not found</h1>
          <p style="color:var(--text-2); margin-bottom:24px;" data-i18n-ar="ربما تم حذف هذه الفورمولا أو أن الرابط غير صحيح.">
            This formula may have been removed or the link is incorrect.
          </p>
          <p style="color:var(--text-3); font-size:0.85rem; margin-bottom:32px;">${escapeHTML(msg)}</p>
          <a href="./search.html" class="btn btn-primary" data-i18n-ar="عودة للبحث">Back to search</a>
        </div>
      </section>
    `;
    footer.insertAdjacentHTML("beforebegin", html);
  }
})();
