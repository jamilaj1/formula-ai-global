/* ──────────────────────────────────────────────────────────────────────────
   learn-live.js — drag-drop PDF/text upload, extract formulas via Claude
     • Reads PDFs in-browser using pdf.js (no upload of binary)
     • Sends extracted text to Worker /extract endpoint
     • Shows progress and results
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  const WORKER_URL = 'https://formula-ai-brain.jamilaj1.workers.dev';
  const MAX_CHARS  = 60000;

  function whenReady(fn) {
    if (window.FAI_DB && window.FAI_AUTH) return fn();
    const id = setInterval(() => {
      if (window.FAI_DB && window.FAI_AUTH) { clearInterval(id); fn(); }
    }, 50);
  }

  whenReady(() => {
    const dropZone   = document.getElementById('drop-zone');
    const fileInput  = document.getElementById('file-input');
    const fileInfo   = document.getElementById('file-info');
    const textInput  = document.getElementById('text-input');
    const titleInput = document.getElementById('meta-title');
    const authorInput= document.getElementById('meta-author');
    const yearInput  = document.getElementById('meta-year');
    const extractBtn = document.getElementById('extract-btn');
    const progress   = document.getElementById('progress');
    const result     = document.getElementById('result');
    const history    = document.getElementById('upload-history');
    const authBlock  = document.getElementById('auth-required');

    let extractedText = '';
    let currentFileName = '';

    /* ─── Auth gate ───────────────────────────────────────────────── */
    function checkAuth() {
      if (!window.FAI_AUTH.user) {
        if (authBlock) authBlock.style.display = 'block';
        if (extractBtn) extractBtn.disabled = true;
      } else {
        if (authBlock) authBlock.style.display = 'none';
        if (extractBtn) extractBtn.disabled = false;
        loadHistory();
      }
    }
    window.FAI_AUTH.onChange(checkAuth);
    checkAuth();

    /* ─── PDF / file reading ──────────────────────────────────────── */
    async function readPdfText(file) {
      if (!window['pdfjsLib']) throw new Error('PDF reader not loaded');
      const arrayBuf = await file.arrayBuffer();
      const pdf = await window['pdfjsLib'].getDocument({ data: arrayBuf }).promise;
      let fullText = '';
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc   = await page.getTextContent();
        fullText += tc.items.map(it => it.str).join(' ') + '\n\n';
        if (fullText.length > MAX_CHARS * 1.2) break; // soft cap during read
      }
      return fullText.trim();
    }

    async function readTxtText(file) {
      return await file.text();
    }

    async function handleFile(file) {
      if (!file) return;
      currentFileName = file.name;
      fileInfo.innerHTML = `
        <div class="file-pill">
          <span>📄</span>
          <span><strong>${escapeHtml(file.name)}</strong> · ${(file.size/1024).toFixed(1)} KB</span>
          <span class="x" id="remove-file" title="Remove">✕</span>
        </div>
        <div style="color: var(--text-3); font-size: 0.85rem; margin-top: 6px;">Reading...</div>
      `;
      document.getElementById('remove-file')?.addEventListener('click', () => {
        extractedText = '';
        currentFileName = '';
        fileInfo.innerHTML = '';
        fileInput.value = '';
      });

      try {
        if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
          extractedText = await readPdfText(file);
        } else {
          extractedText = await readTxtText(file);
        }
        // Trim to max
        if (extractedText.length > MAX_CHARS) {
          extractedText = extractedText.slice(0, MAX_CHARS);
        }
        if (!titleInput.value.trim()) {
          titleInput.value = file.name.replace(/\.[^/.]+$/, '');
        }
        fileInfo.querySelector('div:last-child').innerHTML =
          `<span style="color: var(--primary);">✓ Read ${extractedText.length.toLocaleString()} characters</span>`;
      } catch (err) {
        fileInfo.querySelector('div:last-child').innerHTML =
          `<span style="color:#f87171;">Error: ${escapeHtml(err.message)}</span>`;
      }
    }

    /* ─── Drop zone events ────────────────────────────────────────── */
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => handleFile(e.target.files[0]));

    ['dragenter', 'dragover'].forEach(evt =>
      dropZone.addEventListener(evt, e => {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach(evt =>
      dropZone.addEventListener(evt, e => {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.remove('dragover');
      })
    );
    dropZone.addEventListener('drop', e => {
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    });

    /* ─── Extract button ──────────────────────────────────────────── */
    extractBtn.addEventListener('click', async () => {
      if (!window.FAI_AUTH.user) {
        alert('Please sign in first.');
        return;
      }
      const title = titleInput.value.trim();
      if (!title) { alert('Please enter a book title.'); return; }

      // Pick text source: file content OR pasted text
      const text = (extractedText || textInput.value).trim();
      if (text.length < 200) {
        alert('Need at least 200 characters of book content. Either upload a file or paste text.');
        return;
      }

      result.innerHTML = '';
      progress.style.display = 'flex';
      extractBtn.disabled = true;

      try {
        const token = window.FAI_AUTH.getAccessToken();
        const r = await fetch(`${WORKER_URL}/extract`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            text: text.slice(0, MAX_CHARS),
            title,
            author: authorInput.value.trim() || null,
            year: parseInt(yearInput.value) || null,
          }),
        });
        const data = await r.json().catch(() => ({}));
        progress.style.display = 'none';

        if (!r.ok || data.error) {
          result.innerHTML = `
            <div class="result-card" style="border-color:#f87171;">
              <h3 style="color:#f87171;">Extraction failed</h3>
              <p style="color: var(--text-2);">${escapeHtml(data.error || `HTTP ${r.status}`)}: ${escapeHtml(data.detail || '')}</p>
            </div>
          `;
        } else {
          const previews = (data.preview || []).map(p => `
            <div class="preview-item">
              <strong>${escapeHtml(p.name || 'Unnamed')}</strong>
              <div style="color: var(--text-3); font-size: 0.82rem; margin-top:2px;">
                ${(p.components || []).length} ingredients · ${escapeHtml(p.category || '—')}
              </div>
            </div>
          `).join('');
          result.innerHTML = `
            <div class="result-card">
              <h3>✓ Extraction complete</h3>
              <div class="stat-grid">
                <div><div class="num">${data.found || 0}</div><div class="lbl">Formulas found</div></div>
                <div><div class="num" style="color: var(--primary);">${data.inserted || 0}</div><div class="lbl">Added to database</div></div>
                <div><div class="num" style="color: var(--accent);">${(data.skipped || []).length}</div><div class="lbl">Skipped</div></div>
              </div>
              ${previews ? `<h4 style="margin-top:18px; margin-bottom:10px;">First few:</h4><div class="preview-list">${previews}</div>` : ''}
              <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
                <a href="./chat.html" class="btn btn-primary">Try the AI on these new formulas</a>
                <a href="./search.html" class="btn btn-ghost">Search them</a>
              </div>
            </div>
          `;
          // refresh history
          loadHistory();
          // Reset inputs
          extractedText = '';
          fileInfo.innerHTML = '';
          fileInput.value = '';
          textInput.value = '';
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
        extractBtn.disabled = false;
      }
    });

    /* ─── History list ────────────────────────────────────────────── */
    async function loadHistory() {
      if (!window.FAI_AUTH.user) return;
      try {
        const sb = window.FAI_AUTH.client;
        const { data, error } = await sb.from('uploaded_books')
          .select('id,title,author,year,status,formulas_extracted,created_at')
          .order('created_at', { ascending: false })
          .limit(20);
        if (error || !data?.length) {
          history.innerHTML = `<div style="color: var(--text-3); font-size: 0.9rem;">No books uploaded yet.</div>`;
          return;
        }
        history.innerHTML = data.map(b => {
          const badge = b.status === 'done' ? `<span class="badge badge-done">${b.formulas_extracted || 0} extracted</span>`
                       : b.status === 'failed' ? `<span class="badge badge-failed">Failed</span>`
                       : `<span class="badge badge-processing">${b.status}</span>`;
          const when = new Date(b.created_at).toLocaleDateString();
          return `
            <div class="upload-row">
              <span style="font-size:1.4rem;">📚</span>
              <div style="flex:1; min-width:0;">
                <div style="font-weight:700;">${escapeHtml(b.title)}</div>
                <div style="color: var(--text-3); font-size:0.78rem;">
                  ${b.author ? escapeHtml(b.author) + ' · ' : ''}${b.year || ''} · ${when}
                </div>
              </div>
              ${badge}
            </div>
          `;
        }).join('');
      } catch (_) {}
    }

    function escapeHtml(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  });
})();
