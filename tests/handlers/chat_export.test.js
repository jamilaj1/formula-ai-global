/**
 * Unit tests for the Phase 9.4 chat export path in
 * worker-src/handlers/chat.js. Covers the Markdown renderer (pure
 * function) and the handler's auth + format gates + backend proxy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleChatExport,
  _renderChatMarkdownForTesting as renderChatMarkdown,
} from '../../worker-src/handlers/chat.js';

function baseEnv(over = {}) {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_KEY: 'service-test',
    SUPABASE_ANON_KEY: 'anon-test',
    CHEM_BACKEND_URL: 'https://chem.test',
    BACKEND_INTERNAL_SECRET: 'internal-shared',
    ...over,
  };
}

function userAuth(userId = 'user-1') {
  return { kind: 'user', email: 'u@x.com', userId, id: 'auth-1', plan: 'professional' };
}

function urlWith(qs) {
  return new URL(`https://w.test/chat/export?${qs}`);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

/* ─── Markdown renderer ────────────────────────────────────────── */

describe('renderChatMarkdown', () => {
  it('includes the title, session id, and turn count', () => {
    const md = renderChatMarkdown(
      { id: 'sess-1', title: 'My chat', created_at: '2026-05-29T10:00:00Z', updated_at: '2026-05-29T11:00:00Z' },
      [
        { role: 'user',      content: { text: 'Hi there' },         created_at: '2026-05-29T10:01:00Z' },
        { role: 'assistant', content: { text: 'Hello, chemist!' },  created_at: '2026-05-29T10:01:05Z' },
      ]
    );
    expect(md).toContain('# My chat');
    expect(md).toContain('`sess-1`');
    expect(md).toContain('**Turns:** 2');
    expect(md).toContain('## You · 2026-05-29');
    expect(md).toContain('## Formula AI · 2026-05-29');
    expect(md).toContain('Hi there');
    expect(md).toContain('Hello, chemist!');
    expect(md).toContain('Exported from Formula AI Global');
  });

  it('skips empty / tool-only turns from the count', () => {
    const md = renderChatMarkdown(
      { id: 's', title: 'X', created_at: '2026-05-29T10:00:00Z', updated_at: '2026-05-29T10:00:00Z' },
      [
        { role: 'user',      content: { text: 'q' }, created_at: '2026-05-29T10:00:00Z' },
        { role: 'tool',      content: { text: 't' }, created_at: '2026-05-29T10:00:01Z' },
        { role: 'assistant', content: { text: '' },  created_at: '2026-05-29T10:00:02Z' },
        { role: 'assistant', content: { text: 'a' }, created_at: '2026-05-29T10:00:03Z' },
      ]
    );
    expect(md).toContain('**Turns:** 2');
    expect(md).not.toContain('## Tool');
  });

  it('inlines formula references under the assistant turn that mentions them', () => {
    const md = renderChatMarkdown(
      { id: 's', title: 'X', created_at: '2026-05-29T10:00:00Z', updated_at: '2026-05-29T10:00:00Z' },
      [
        {
          role: 'assistant',
          content: {
            text: 'Here are two options.',
            formula_refs: [
              { id: 'f1', name: 'Hand Soap (Clear)', trust: 88 },
              { id: 'f2', name: 'Hand Soap (Economical)', trust: 75 },
            ],
          },
          created_at: '2026-05-29T10:00:00Z',
        },
      ]
    );
    expect(md).toContain('**Formulas referenced**');
    expect(md).toContain('Hand Soap (Clear)');
    expect(md).toContain('trust 88/100');
    expect(md).toContain('Hand Soap (Economical)');
  });

  it('handles a session with zero messages without crashing', () => {
    const md = renderChatMarkdown(
      { id: 's', title: 'Empty', created_at: '2026-05-29T10:00:00Z', updated_at: '2026-05-29T10:00:00Z' },
      []
    );
    expect(md).toContain('# Empty');
    expect(md).toContain('**Turns:** 0');
  });
});

/* ─── handleChatExport — validation + auth gate ────────────────── */

describe('handleChatExport — input validation', () => {
  it('rejects missing session_id', async () => {
    const res = await handleChatExport(urlWith(''), userAuth(), baseEnv());
    expect(res.status).toBe(400);
  });

  it('rejects unknown format', async () => {
    const res = await handleChatExport(
      urlWith('session_id=s&format=docx'), userAuth(), baseEnv()
    );
    expect(res.status).toBe(400);
  });

  it('returns 401 for a guest (no auth)', async () => {
    const res = await handleChatExport(
      urlWith('session_id=s&format=md'), null, baseEnv()
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 for guest-kind auth', async () => {
    const res = await handleChatExport(
      urlWith('session_id=s&format=md'),
      { kind: 'guest', id: 'guest-x' },
      baseEnv()
    );
    expect(res.status).toBe(401);
  });
});

/* ─── handleChatExport — ownership + DB integration ────────────── */

describe('handleChatExport — DB integration', () => {
  it('returns 404 when the user does not own the session', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/chat_sessions')) {
        return new Response('[]', { status: 200 });   // no rows → no ownership
      }
      return new Response('[]', { status: 200 });
    });
    const res = await handleChatExport(
      urlWith('session_id=sess-x&format=md'),
      userAuth(),
      baseEnv()
    );
    expect(res.status).toBe(404);
  });

  it('returns Markdown attachment on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/chat_sessions')) {
        return new Response(JSON.stringify([{
          id: 'sess-1', title: 'Shampoo brainstorm',
          created_at: '2026-05-29T10:00:00Z', updated_at: '2026-05-29T11:00:00Z',
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('/chat_messages')) {
        return new Response(JSON.stringify([
          { role: 'user',      content: { text: 'I need a shampoo for dry hair' }, created_at: '2026-05-29T10:01:00Z' },
          { role: 'assistant', content: { text: 'Here are 3 options.' },          created_at: '2026-05-29T10:01:05Z' },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('[]', { status: 200 });
    });
    const res = await handleChatExport(
      urlWith('session_id=sess-1&format=md'),
      userAuth(),
      baseEnv()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(res.headers.get('Content-Disposition')).toContain('.md');
    const body = await res.text();
    expect(body).toContain('# Shampoo brainstorm');
    expect(body).toContain('shampoo for dry hair');
    expect(body).toContain('Here are 3 options');
  });

  it('forwards to FastAPI for PDF and returns its bytes', async () => {
    let backendUrl = null;
    let backendBody = null;
    let backendHeaders = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('/chat_sessions')) {
        return new Response(JSON.stringify([{
          id: 'sess-2', title: 'Cream R&D',
          created_at: '2026-05-29T09:00:00Z', updated_at: '2026-05-29T09:30:00Z',
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('/chat_messages')) {
        return new Response(JSON.stringify([
          { role: 'user', content: { text: 'A moisturising cream' }, created_at: '2026-05-29T09:00:00Z' },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('/api/v2/chat/render-pdf')) {
        backendUrl = u;
        backendBody = JSON.parse(init.body);
        backendHeaders = init.headers;
        // Fake but legitimate-looking PDF magic header.
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).buffer, {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        });
      }
      return new Response('[]', { status: 200 });
    });
    const res = await handleChatExport(
      urlWith('session_id=sess-2&format=pdf'),
      userAuth(),
      baseEnv()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('.pdf');
    expect(backendUrl).toContain('https://chem.test/api/v2/chat/render-pdf');
    expect(backendBody.markdown).toContain('# Cream R&D');
    expect(backendHeaders['x-formula-internal']).toBe('internal-shared');
  });

  it('returns 500 when CHEM_BACKEND_URL missing for PDF', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/chat_sessions')) {
        return new Response(JSON.stringify([{
          id: 's', title: 'x',
          created_at: '2026-05-29T09:00:00Z', updated_at: '2026-05-29T09:30:00Z',
        }]), { status: 200 });
      }
      if (u.includes('/chat_messages')) {
        return new Response('[]', { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    const res = await handleChatExport(
      urlWith('session_id=s&format=pdf'),
      userAuth(),
      baseEnv({ CHEM_BACKEND_URL: '' })
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('backend_not_configured');
  });

  it('returns 502 when backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/chat_sessions')) {
        return new Response(JSON.stringify([{
          id: 's', title: 'x',
          created_at: '2026-05-29T09:00:00Z', updated_at: '2026-05-29T09:30:00Z',
        }]), { status: 200 });
      }
      if (u.includes('/chat_messages')) {
        return new Response('[]', { status: 200 });
      }
      if (u.includes('/api/v2/chat/render-pdf')) {
        throw new Error('connect ECONNREFUSED');
      }
      return new Response('[]', { status: 200 });
    });
    const res = await handleChatExport(
      urlWith('session_id=s&format=pdf'),
      userAuth(),
      baseEnv()
    );
    expect(res.status).toBe(502);
  });
});
