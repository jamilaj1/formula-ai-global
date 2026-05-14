/* library-live.js — Phase 13 + 14 + 15 frontend
 *   Tabs: Formulas | Prices | Cost | Scale
 */
(function () {
  const WORKER_URL = 'https://formula-ai-brain.jamilaj1.workers.dev';

  function whenReady(fn) {
    if (window.FAI_DB && window.FAI_AUTH) return fn();
    const id = setInterval(() => {
      if (window.FAI_DB && window.FAI_AUTH) { clearInterval(id); fn(); }
    }, 50);
  }

  whenReady(() => {
    const authBlock = document.getElementById('auth-required');
    const tabs = document.querySelectorAll('.lib-tab');
    const panels = document.querySelectorAll('.lib-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        panels.forEach(p => p.classList.toggle('active', p.dataset.panel === target));
      });
    });

    function checkAuth() {
      if (!window.FAI_AUTH.user) {
        if (authBlock) authBlock.style.display = 'block';
      } else {
        if (authBlock) authBlock.style.display = 'none';
        loadFormulas();
        loadPrices();
      }
    }
    window.FAI_AUTH.onChange(checkAuth);
    checkAuth();

    async function authHeaders() {
      const t = window.FAI_AUTH?.getAccessToken?.();
      return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    }
    function escapeHtml(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /* ─── Formulas tab ─────────────────────────────────────────── */
    let myFormulas = [];

    async function loadFormulas() {
      try {
        const r = await fetch(`${WORKER_URL}/library`, { headers: await authHeaders() });
        const data = await r.json();
        myFormulas = data.formulas || [];
        const list = document.getElementById('formulas-list');
        if (!myFormulas.length) {
          list.innerHTML = `<div style="color: var(--text-3); font-size: 0.9rem;">No formulas yet. Use AI Chat to save modifications.</div>`;
          return;
        }
        list.innerHTML = myFormulas.map(f => `
          <div class="formula-tile" data-id="${f.id}">
            <div class="cat-pill">${escapeHtml(f.category || 'specialty')}</div>
            <h4>${escapeHtml(f.name_en || f.name)}</h4>
            <div class="meta">Trust ${f.trust_score || 0}% · ${new Date(f.updated_at).toLocaleDateString()}</div>
            ${f.notes ? `<div class="meta" style="margin-top:6px;">📝 ${escapeHtml(f.notes.slice(0, 80))}${f.notes.length > 80 ? '...' : ''}</div>` : ''}
            <div class="actions">
              <button class="btn-mini act-view" data-id="${f.id}">View</button>
              <button class="btn-mini act-cost" data-id="${f.id}">Cost</button>
              <button class="btn-mini act-scale" data-id="${f.id}">Scale</button>
              <button class="btn-mini danger act-del" data-id="${f.id}">Delete</button>
            </div>
          </div>
        `).join('');
        list.querySelectorAll('.act-view').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); viewFormula(b.dataset.id); }));
        list.querySelectorAll('.act-cost').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openCostFor(b.dataset.id, 'library'); }));
        list.querySelectorAll('.act-scale').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openScaleFor(b.dataset.id, 'library'); }));
        list.querySelectorAll('.act-del').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); deleteFormula(b.dataset.id); }));
      } catch (_) {}
    }

    async function viewFormula(id) {
      try {
        const r = await fetch(`${WORKER_URL}/library/${id}`, { headers: await authHeaders() });
        const data = await r.json();
        if (data.error) { alert('Error: ' + data.error); return; }
        const f = data.formula;
        const compRows = (f.components || []).map((c, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(c.name_en || c.name || '—')}</td>
            <td>${c.cas_number || '—'}</td>
            <td><strong style="color: var(--primary);">${(c.percentage ?? 0).toFixed(2)}%</strong></td>
            <td>${escapeHtml(c.function || '—')}</td>
          </tr>
        `).join('');
        const total = (f.components || []).reduce((s, c) => s + (parseFloat(c.percentage) || 0), 0);
        document.getElementById('modal-body').innerHTML = `
          <div class="cat-pill" style="display:inline-block; padding:3px 10px; background:rgba(0,255,136,0.1); color:var(--primary); border-radius:999px; font-size:0.72rem; font-weight:700;">${escapeHtml(f.category || 'specialty')}</div>
          <h2 style="margin-top:8px; margin-bottom:6px;">${escapeHtml(f.name_en || f.name)}</h2>
          ${f.notes ? `<p style="color:var(--text-3); font-style:italic;">📝 ${escapeHtml(f.notes)}</p>` : ''}
          <div style="margin: 18px 0;">
            <table class="scale-table">
              <thead><tr><th>#</th><th>Ingredient</th><th>CAS</th><th>%</th><th>Function</th></tr></thead>
              <tbody>${compRows}</tbody>
              <tfoot><tr><td colspan="3" style="text-align:right;"><strong>Total:</strong></td><td><strong style="color:${Math.abs(total - 100) < 1 ? 'var(--primary)' : '#fb923c'};">${total.toFixed(2)}%</strong></td><td></td></tr></tfoot>
            </table>
          </div>
          ${f.process_conditions?.order_of_addition ? `<h4>Preparation</h4><p style="white-space: pre-wrap; color: var(--text-2);">${escapeHtml(f.process_conditions.order_of_addition)}</p>` : ''}
          <div style="display:flex; gap:10px; margin-top:18px; flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="window._lib.openCostFor('${f.id}','library')">Calculate cost</button>
            <button class="btn btn-ghost btn-sm" onclick="window._lib.openScaleFor('${f.id}','library')">Scale to batch</button>
          </div>
        `;
        document.getElementById('modal').classList.add('open');
      } catch (_) {}
    }

    async function deleteFormula(id) {
      if (!confirm('Delete this formula? This cannot be undone.')) return;
      try {
        await fetch(`${WORKER_URL}/library/${id}`, { method: 'DELETE', headers: await authHeaders() });
        loadFormulas();
      } catch (_) {}
    }

    document.getElementById('modal-close').addEventListener('click', () => {
      document.getElementById('modal').classList.remove('open');
    });
    document.getElementById('modal').addEventListener('click', e => {
      if (e.target.id === 'modal') e.currentTarget.classList.remove('open');
    });

    /* ─── Prices tab ───────────────────────────────────────────── */
    async function loadPrices() {
      try {
        const r = await fetch(`${WORKER_URL}/prices`, { headers: await authHeaders() });
        const data = await r.json();
        const prices = data.prices || [];
        const list = document.getElementById('prices-list');
        if (!prices.length) {
          list.innerHTML = `<div style="color: var(--text-3); font-size: 0.9rem;">No prices yet. Add your first one above.</div>`;
          return;
        }
        list.innerHTML = prices.map(p => `
          <div class="price-row">
            <div><strong>${escapeHtml(p.ingredient_name)}</strong>${p.cas_number ? ` <span style="color:var(--text-3); font-size:0.78rem;">(${escapeHtml(p.cas_number)})</span>` : ''}</div>
            <div>${parseFloat(p.price_per_kg).toFixed(2)} <span style="color: var(--text-3);">${escapeHtml(p.currency)}/kg</span></div>
            <div style="color: var(--text-3); font-size:0.82rem;">${escapeHtml(p.supplier || '—')}</div>
            <button class="btn-mini danger" data-pid="${p.id}">×</button>
          </div>
        `).join('');
        list.querySelectorAll('.btn-mini.danger').forEach(b => b.addEventListener('click', async () => {
          if (!confirm('Delete this price?')) return;
          await fetch(`${WORKER_URL}/prices/${b.dataset.pid}`, { method: 'DELETE', headers: await authHeaders() });
          loadPrices();
        }));
      } catch (_) {}
    }

    document.getElementById('p-add').addEventListener('click', async () => {
      const name = document.getElementById('p-name').value.trim();
      const price = parseFloat(document.getElementById('p-price').value);
      const cur = document.getElementById('p-cur').value;
      if (!name || !Number.isFinite(price) || price <= 0) {
        alert('Enter ingredient name and price/kg');
        return;
      }
      const r = await fetch(`${WORKER_URL}/prices`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ ingredient_name: name, price_per_kg: price, currency: cur }),
      });
      const data = await r.json();
      if (data.error) { alert('Failed: ' + data.error); return; }
      document.getElementById('p-name').value = '';
      document.getElementById('p-price').value = '';
      loadPrices();
    });

    /* ─── Cost tab ─────────────────────────────────────────────── */
    function fillFormulaSelect(selectEl, sourceEl) {
      sourceEl.addEventListener('change', () => {
        if (sourceEl.value === 'library' && myFormulas.length) {
          selectEl.innerHTML = '<option value="">— Pick a formula —</option>' + myFormulas.map(f => `<option value="${f.id}">${escapeHtml(f.name_en || f.name)}</option>`).join('');
          selectEl.tagName = 'select';
        }
      });
    }

    window._lib = {};
    window._lib.openCostFor = (id, source) => {
      document.querySelectorAll('.lib-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'cost'));
      document.querySelectorAll('.lib-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === 'cost'));
      document.getElementById('c-source').value = source || 'library';
      document.getElementById('c-formula').value = id;
      document.getElementById('modal').classList.remove('open');
      runCost();
    };
    window._lib.openScaleFor = (id, source) => {
      document.querySelectorAll('.lib-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'scale'));
      document.querySelectorAll('.lib-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === 'scale'));
      document.getElementById('s-source').value = source || 'library';
      document.getElementById('s-formula').value = id;
      document.getElementById('modal').classList.remove('open');
      runScale();
    };

    async function runCost() {
      const id = document.getElementById('c-formula').value.trim();
      const batchKg = parseFloat(document.getElementById('c-batch').value) || 1;
      if (!id) { alert('Enter or pick a formula'); return; }
      const result = document.getElementById('cost-result');
      result.innerHTML = '<div style="color:var(--text-3);">Calculating…</div>';
      const r = await fetch(`${WORKER_URL}/cost`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ formula_id: id, batch_kg: batchKg }),
      });
      const data = await r.json();
      if (data.error) { result.innerHTML = `<div style="color:#f87171;">Error: ${escapeHtml(data.error)}</div>`; return; }
      const breakdown = (data.breakdown || []).map(b => `
        <tr>
          <td>${escapeHtml(b.name)}</td>
          <td>${b.percentage.toFixed(2)}%</td>
          <td>${b.mass_kg.toFixed(3)} kg</td>
          <td>${b.price_per_kg.toFixed(2)} ${escapeHtml(b.currency)}/kg</td>
          <td><strong style="color: var(--primary);">${b.cost.toFixed(2)} ${escapeHtml(b.currency)}</strong></td>
        </tr>
      `).join('');
      const missing = (data.missing || []).map(m => `<li>${escapeHtml(m.name)} (${m.percentage.toFixed(2)}%)</li>`).join('');
      result.innerHTML = `
        <div class="cost-summary">
          <div><div class="num">${data.total_cost.toFixed(2)}</div><div class="lbl">Total (${escapeHtml(data.currency)})</div></div>
          <div><div class="num">${data.cost_per_kg.toFixed(2)}</div><div class="lbl">Per kg</div></div>
          <div><div class="num">${data.batch_kg} kg</div><div class="lbl">Batch size</div></div>
          <div><div class="num">${data.coverage_pct}%</div><div class="lbl">Coverage</div></div>
        </div>
        ${breakdown ? `<table class="scale-table"><thead><tr><th>Ingredient</th><th>%</th><th>Mass</th><th>Price</th><th>Cost</th></tr></thead><tbody>${breakdown}</tbody></table>` : ''}
        ${missing ? `<div style="margin-top:14px; padding:12px; background:rgba(251,146,60,0.08); border:1px solid rgba(251,146,60,0.2); border-radius:10px;"><strong style="color:#fb923c;">Missing prices:</strong><ul style="margin: 8px 0 0 20px;">${missing}</ul><p style="font-size:0.82rem; color:var(--text-3); margin-top:8px;">Add these to the Prices tab to include them in the total.</p></div>` : ''}
      `;
    }
    document.getElementById('c-run').addEventListener('click', runCost);

    /* ─── Scale tab ────────────────────────────────────────────── */
    async function runScale() {
      const id = document.getElementById('s-formula').value.trim();
      const target = parseFloat(document.getElementById('s-target').value) || 1;
      const unit = document.getElementById('s-unit').value;
      if (!id) { alert('Enter or pick a formula'); return; }
      const result = document.getElementById('scale-result');
      result.innerHTML = '<div style="color:var(--text-3);">Scaling…</div>';
      const r = await fetch(`${WORKER_URL}/scale`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ formula_id: id, target_kg: target, unit }),
      });
      const data = await r.json();
      if (data.error) { result.innerHTML = `<div style="color:#f87171;">Error: ${escapeHtml(data.error)}</div>`; return; }
      const massKey = `mass_${unit}`;
      const rows = (data.components || []).map(c => `
        <tr>
          <td>${escapeHtml(c.name_en)}</td>
          <td>${c.percentage.toFixed(2)}%</td>
          <td><strong style="color:var(--primary);">${c[massKey].toFixed(3)} ${escapeHtml(unit)}</strong></td>
          <td>${escapeHtml(c.function || '—')}</td>
        </tr>
      `).join('');
      result.innerHTML = `
        <div style="margin: 14px 0; color: var(--text-2);">
          Batch: <strong>${data.target_kg} ${escapeHtml(unit)}</strong> ·
          Balance: <strong style="color:${data.balance_check === 'balanced' ? 'var(--primary)' : '#fb923c'};">${escapeHtml(data.balance_check)}</strong>
        </div>
        <table class="scale-table">
          <thead><tr><th>Ingredient</th><th>%</th><th>Mass needed</th><th>Function</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:14px;">
          <button class="btn btn-ghost btn-sm" onclick="window.print()">Print recipe</button>
        </div>
      `;
    }
    document.getElementById('s-run').addEventListener('click', runScale);
  });
})();
