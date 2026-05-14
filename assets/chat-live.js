/* ──────────────────────────────────────────────────────────────────────────
   chat-live.js — conversational AI front-end for chat.html
     • POST /chat          — send message, get reply
     • GET  /chat/sessions — list user's sessions
     • GET  /chat/messages — load full message history of one session
   Depends on FAI_DB (assets/supabase-client.js).
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  const WORKER_URL = 'https://formula-ai-brain.jamilaj1.workers.dev';

  function whenReady(fn) {
    if (window.FAI_DB) return fn();
    const id = setInterval(() => { if (window.FAI_DB) { clearInterval(id); fn(); } }, 50);
  }

  whenReady(() => {
    const feed       = document.getElementById('chat-feed');
    const emptyState = document.getElementById('chat-empty');
    const form       = document.getElementById('chat-form');
    const input      = document.getElementById('chat-input');
    const sendBtn    = document.getElementById('chat-send');
    const newBtn     = document.getElementById('chat-new');
    const list       = document.getElementById('chat-list');
    const usagePill  = document.getElementById('chat-usage');
    const titleEl    = document.getElementById('chat-title');
    if (!feed || !form) return;

    let currentSessionId = null;

    /* ─── helpers ─────────────────────────────────────────────────── */
    const escape = s => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    function formatReply(text) {
      // Convert simple markdown-ish into HTML: bold, line breaks, formula links
      let html = escape(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br/>');
      return html;
    }

    async function authHeaders() {
      const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
      try {
        const token = window.FAI_AUTH?.getAccessToken?.()
                   || window.FAI_AUTH?.session?.access_token
                   || null;
        if (token) h.Authorization = `Bearer ${token}`;
      } catch (_) {}
      return h;
    }

    function appendMessage(role, text, formulaRefs) {
      if (emptyState) emptyState.remove();
      const wrap = document.createElement('div');
      wrap.className = `chat-msg ${role}`;
      const avatar = role === 'user' ? 'You' : 'AI';
      const formulaCards = (formulaRefs && formulaRefs.length)
        ? `<div class="formula-card-inline">
             ${formulaRefs.slice(0, 6).map(f => `
               <div style="margin: 4px 0;">
                 🧪 <a href="./formulas.html?id=${encodeURIComponent(f.id)}" target="_blank">${escape(f.name || 'Formula')}</a>
                 ${f.trust ? `<span style="color:var(--text-3); font-size:0.78rem; margin-inline-start:6px;">trust ${f.trust}%</span>` : ''}
               </div>
             `).join('')}
           </div>`
        : '';
      wrap.innerHTML = `
        <div class="avatar">${escape(avatar)}</div>
        <div class="bubble">${role === 'user' ? escape(text) : formatReply(text)}${formulaCards}</div>
      `;
      feed.appendChild(wrap);
      feed.scrollTop = feed.scrollHeight;
    }

    function appendTyping() {
      const wrap = document.createElement('div');
      wrap.className = 'chat-msg ai';
      wrap.id = 'chat-typing';
      wrap.innerHTML = `
        <div class="avatar">AI</div>
        <div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>
      `;
      feed.appendChild(wrap);
      feed.scrollTop = feed.scrollHeight;
    }
    function removeTyping() {
      document.getElementById('chat-typing')?.remove();
    }

    function setUsage(used, limit, plan) {
      if (!usagePill) return;
      const planLabel = plan === 'guest' ? 'Guest'
                      : plan === 'starter' ? 'Free'
                      : plan === 'professional' ? 'Pro'
                      : plan === 'business' ? 'Business'
                      : plan === 'enterprise' ? 'Enterprise' : plan;
      usagePill.textContent = `${planLabel}: ${used}/${limit}`;
    }

    /* ─── send a message ──────────────────────────────────────────── */
    async function sendMessage(text) {
      if (!text.trim()) return;
      input.value = '';
      input.style.height = 'auto';
      sendBtn.disabled = true;

      appendMessage('user', text);
      appendTyping();

      try {
        const r = await fetch(`${WORKER_URL}/chat`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ message: text, session_id: currentSessionId }),
        });
        const data = await r.json().catch(() => ({}));
        removeTyping();

        if (r.status === 429) {
          appendMessage('ai',
            `⚠️ ${data.detail || 'Daily limit reached.'}\n\nSign up for higher limits, or upgrade your plan.`,
            null);
        } else if (data.error) {
          appendMessage('ai', `Sorry — there was an error: ${data.error}${data.detail ? '\n' + data.detail : ''}`, null);
        } else {
          if (data.session_id) {
            const isNew = !currentSessionId;
            currentSessionId = data.session_id;
            if (isNew) refreshSessionList();
          }
          appendMessage('ai', data.reply || '(no reply)', data.formula_refs);
          if (data.usage) setUsage(data.usage.used, data.usage.limit, data.usage.plan);
        }
      } catch (err) {
        removeTyping();
        appendMessage('ai', `Connection error: ${err.message}`, null);
      } finally {
        sendBtn.disabled = false;
        input.focus();
      }
    }

    /* ─── form & input handling ───────────────────────────────────── */
    form.addEventListener('submit', e => {
      e.preventDefault();
      sendMessage(input.value);
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value);
      }
    });

    document.querySelectorAll('.chip[data-prompt]').forEach(chip => {
      chip.addEventListener('click', () => {
        sendMessage(chip.dataset.prompt);
      });
    });

    /* ─── new chat button ─────────────────────────────────────────── */
    newBtn?.addEventListener('click', () => {
      currentSessionId = null;
      feed.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'chat-empty';
      empty.id = 'chat-empty';
      empty.innerHTML = `
        <div style="font-size:3rem;">🧪</div>
        <h3>Start a new conversation</h3>
        <p>Ask about any formula, ingredient, or compliance question.</p>
      `;
      feed.appendChild(empty);
      input.focus();
    });

    /* ─── session list ────────────────────────────────────────────── */
    async function refreshSessionList() {
      try {
        const r = await fetch(`${WORKER_URL}/chat/sessions`, { headers: await authHeaders() });
        const data = await r.json();
        const sessions = data.sessions || [];
        if (!sessions.length) {
          list.innerHTML = `<div style="color:var(--text-3); font-size:0.85rem; padding:8px 4px;">No previous chats yet.</div>`;
          return;
        }
        list.innerHTML = sessions.map(s => {
          const when = new Date(s.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const isActive = s.id === currentSessionId ? 'active' : '';
          return `
            <div class="chat-side-item ${isActive}" data-session-id="${s.id}" title="${escape(s.title)}">
              ${escape(s.title || 'Untitled')}
              <span class="when">${when}</span>
            </div>`;
        }).join('');
        list.querySelectorAll('[data-session-id]').forEach(el => {
          el.addEventListener('click', () => loadSession(el.dataset.sessionId));
        });
      } catch (_) {}
    }

    async function loadSession(sessionId) {
      try {
        const r = await fetch(`${WORKER_URL}/chat/messages?session_id=${encodeURIComponent(sessionId)}`,
          { headers: await authHeaders() });
        const data = await r.json();
        if (data.error) return;
        currentSessionId = sessionId;
        feed.innerHTML = '';
        (data.messages || []).forEach(m => {
          if (m.role === 'user') appendMessage('user', m.content?.text || '');
          else if (m.role === 'assistant') appendMessage('ai', m.content?.text || '', m.content?.formula_refs);
        });
        // highlight active in list
        list.querySelectorAll('[data-session-id]').forEach(el => {
          el.classList.toggle('active', el.dataset.sessionId === sessionId);
        });
      } catch (_) {}
    }

    /* ─── initial load ────────────────────────────────────────────── */
    async function loadInitialUsage() {
      try {
        const u = await window.FAI_DB.getUsage();
        if (u && typeof u.used === 'number') setUsage(u.used, u.limit, u.plan);
      } catch (_) {}
    }

    // Wait until auth resolves (FAI_AUTH may load asynchronously)
    setTimeout(() => {
      loadInitialUsage();
      refreshSessionList();
    }, 600);
  });
})();
