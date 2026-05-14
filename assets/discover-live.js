/* ──────────────────────────────────────────────────────────────────────────
   discover-live.js — multi-source academic + patent harvester UI
     • POST /discover  → starts a discovery job (sync, single shot)
     • GET  /discover/jobs → lists previous jobs
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  const WORKER_URL = 'https://formula-ai-brain.jamilaj1.workers.dev';

  function whenReady(fn) {
    if (window.FAI_DB && window.FAI_AUTH) return fn();
    const id = setInterval(() => {
      if (window.FAI_DB && window.FAI_AUTH) { clearInterval(id); fn(); }
    }, 50);
  }

  whenReady(() => {
    const queryInput = document.getElementById('disc-query');
    const maxInput   = document.getElementById('disc-max');
    const btn        = document.getElementById('disc-btn');
    const progress   = document.getElementById('progress');
    const result     = document.getElementById('result');
    const jobsList   = document.getElementById('jobs-list');
    const authBlock  = document.getElementById('auth-required');

    // Source-card click feedback
    document.querySelectorAll('.source-card input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const card = cb.closest('.source-card');
        if (cb.checked) card.classList.add('active');
        else card.classList.remove('active');
      });
    });

    function checkAuth() {
      if (!window.FAI_AUTH.user) {
        if (authBlock) authBlock.style.display = 'block';
        if (btn) btn.disabled = true;
      } else {
        if (authBlock) authBlock.style.display = 'none';
        if (btn) btn.disabled = false;
        loadJobs();
      }
    }
    window.FAI_AUTH.onChange(checkAuth);
    checkAuth();

    btn.addEventListener('click', async () => {
      if (!window.FAI_AUTH.user) {
        alert('Please sign in first.');
        return;
      }
      const query = queryInput.value.trim();
      if (!query) { alert('Please enter a topic to discover.'); return; }

      const sources = Array.from(document.querySelectorAll('.source-card input[type="checkbox"]:checked'))
        .map(cb => cb.value);
      if (!sources.length) { alert('Pick at least one source.'); return; }

      const max = Math.min(Math.max(parseInt(maxInput.value) || 8, 1), 20);

      result.innerHTML = '';
      progress.style.display = 'flex';
      btn.disabled = true;

      try {
        const token = window.FAI_AUTH.getAccessToken();
        const r = await fetch(`${WORKER_URL}/discover`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            query,
            sources,
            max_per_source: max,
          }),
        });
        const data = await r.json().catch(() => ({}));
        progress.style.display = 'none';

        if (!r.ok || data.error) {
          result.innerHTML = `
            <div class="result-card" style="border-color:#f87171;">
              <h3 style="color:#f87171;">Discovery failed</h3>
              <p style="color: var(--text-2);">${escapeHtml(data.error || `HTTP ${r.status}`)}: ${escapeHtml(data.detail || '')}</p>
            </div>
          `;
        } else {
          const sourcesText = Object.entries(data.by_source || {})
            .map(([k, v]) => `${escapeHtml(k)}: ${v}`).join(' · ');
          const detailsList = (data.details || []).map(d => `
            <div class="source-row">
              <strong>${escapeHtml(d.title)}</strong>
              ${d.inserted ? `<span class="badge">+${d.inserted} formulas</span>` : ''}
              <div class="meta">Found ${d.found || 0} candidate(s) — Inserted ${d.inserted || 0}</div>
            </div>
          `).join('');
          result.innerHTML = `
            <div class="result-card">
              <h3 style="color: var(--primary);">✓ Discovery complete</h3>
              <div class="stat-grid">
                <div><div class="num">${data.results_found || 0}</div><div class="lbl">Sources searched</div></div>
                <div><div class="num" style="color: var(--primary);">${data.formulas_extracted || 0}</div><div class="lbl">Formulas added</div></div>
                <div><div class="num" style="color: var(--secondary);">${(data.sources_searched || []).length}</div><div class="lbl">Providers used</div></div>
              </div>
              ${sourcesText ? `<div style="margin-top: 10px; color: var(--text-3); font-size: 0.88rem;">By source: ${sourcesText}</div>` : ''}
              ${detailsList ? `<h4 style="margin-top:18px; margin-bottom:10px;">Top findings:</h4><div class="source-list">${detailsList}</div>` : ''}
              <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
                <a href="./chat.html" class="btn btn-primary">Try the AI on these new formulas</a>
                <a href="./search.html?q=${encodeURIComponent(query)}" class="btn btn-ghost">Search them</a>
              </div>
            </div>
          `;
          loadJobs();
        }
      } catch (err) {
        progress.style.display = 'none';
        result.innerHTML = `
          <div class="result-card" style="border-color:#f87171;">
            <h3 style="color:#f87171;">Connection error</h3>
            <p>${escapeHtml(err.message)}</p>
          </div>
        `;
      } finally {
        btn.disabled = false;
      }
    });

    async function loadJobs() {
      if (!window.FAI_AUTH.user) return;
      try {
        const token = window.FAI_AUTH.getAccessToken();
        const r = await fetch(`${WORKER_URL}/discover/jobs`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await r.json();
        const jobs = data.jobs || [];
        if (!jobs.length) {
          jobsList.innerHTML = `<div style="color: var(--text-3); font-size: 0.9rem;">No discovery jobs yet.</div>`;
          return;
        }
        jobsList.innerHTML = jobs.map(j => `
          <div class="source-row">
            <strong>${escapeHtml(j.query)}</strong>
            ${j.formulas_extracted ? `<span class="badge">+${j.formulas_extracted} formulas</span>` : ''}
            <div class="meta">
              ${(j.sources || []).join(', ')} ·
              ${j.results_found || 0} sources ·
              ${new Date(j.created_at).toLocaleDateString()}
            </div>
          </div>
        `).join('');
      } catch (_) {}
    }

    function escapeHtml(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  });
})();
