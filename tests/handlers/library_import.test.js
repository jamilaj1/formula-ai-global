/**
 * Unit tests for the Phase 9.3 import proxies in
 * worker-src/handlers/library.js.
 *
 * The handlers are thin: auth gate → backend not configured guard →
 * forward to FastAPI. We assert each layer works in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleLibraryImportPreview,
  handleLibraryImportCommit,
} from '../../worker-src/handlers/library.js';

function baseEnv(over = {}) {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_KEY: 'service-test',
    CHEM_BACKEND_URL: 'https://chem.test',
    BACKEND_INTERNAL_SECRET: 'internal-shared',
    ...over,
  };
}

function userAuth(userId = 'user-uuid-1') {
  return { kind: 'user', userId, email: 'u@x.com', id: 'auth-1', plan: 'enterprise' };
}

function multipartReq(file = new Blob(['name,ingredients\nx,Water | 50'], { type: 'text/csv' })) {
  const fd = new FormData();
  fd.append('file', file, 'test.csv');
  return new Request('https://w.test/library/import/preview', {
    method: 'POST',
    body: fd,
  });
}

function jsonReq(body) {
  return new Request('https://w.test/library/import/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('handleLibraryImportPreview', () => {
  it('returns 401 for a guest', async () => {
    const res = await handleLibraryImportPreview(multipartReq(), { kind: 'guest' }, baseEnv());
    expect(res.status).toBe(401);
  });

  it('returns 400 when the request is not multipart', async () => {
    const req = new Request('https://w.test/library/import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const res = await handleLibraryImportPreview(req, userAuth(), baseEnv());
    expect(res.status).toBe(400);
  });

  it('returns 503 when CHEM_BACKEND_URL missing', async () => {
    const res = await handleLibraryImportPreview(
      multipartReq(),
      userAuth(),
      baseEnv({ CHEM_BACKEND_URL: '' })
    );
    expect(res.status).toBe(503);
  });

  it('forwards to FastAPI, stamps user_id from auth (not from the client)', async () => {
    let captured = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      captured = { url: String(url), body: init.body, headers: init.headers };
      return new Response(JSON.stringify({
        ok: true, total_rows: 1, valid_rows: 1, rows: [], errors: [], sample_columns: [],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await handleLibraryImportPreview(multipartReq(), userAuth('forced-uuid'), baseEnv());
    expect(res.status).toBe(200);
    expect(captured.url).toContain('https://chem.test/api/v2/library/import/preview');
    expect(captured.headers['x-formula-internal']).toBe('internal-shared');
    // user_id in the multipart body is whatever auth.userId was — even if
    // the client tried to set their own (we never read from the inbound
    // form except for `file`).
    const fd = captured.body;
    expect(fd instanceof FormData).toBe(true);
    expect(fd.get('user_id')).toBe('forced-uuid');
    expect(fd.get('file')).toBeTruthy();
  });

  it('propagates backend error detail when /preview returns 4xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'missing required columns: ingredients' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const res = await handleLibraryImportPreview(multipartReq(), userAuth(), baseEnv());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.detail).toContain('missing required columns');
  });
});

describe('handleLibraryImportCommit', () => {
  it('returns 401 for a guest', async () => {
    const res = await handleLibraryImportCommit(
      jsonReq({ rows: [{ name: 'x' }] }),
      { kind: 'guest' },
      baseEnv()
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on empty rows', async () => {
    const res = await handleLibraryImportCommit(
      jsonReq({ rows: [] }),
      userAuth(),
      baseEnv()
    );
    expect(res.status).toBe(400);
  });

  it('rejects > 2000 rows with 413', async () => {
    const huge = Array.from({ length: 2001 }, (_, i) => ({ name: `row-${i}` }));
    const res = await handleLibraryImportCommit(
      jsonReq({ rows: huge }),
      userAuth(),
      baseEnv()
    );
    expect(res.status).toBe(413);
  });

  it('forwards rows + auth user_id, returns the backend payload', async () => {
    let captured = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      captured = { url: String(url), body: JSON.parse(init.body), headers: init.headers };
      return new Response(JSON.stringify({ ok: true, inserted: 2, ids: ['a', 'b'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const res = await handleLibraryImportCommit(
      jsonReq({ rows: [{ name: 'a' }, { name: 'b' }] }),
      userAuth('owner-uuid'),
      baseEnv()
    );
    expect(res.status).toBe(200);
    expect(captured.url).toContain('https://chem.test/api/v2/library/import/commit');
    expect(captured.body.user_id).toBe('owner-uuid');
    expect(captured.body.rows).toHaveLength(2);
    expect(captured.headers['x-formula-internal']).toBe('internal-shared');
    const out = await res.json();
    expect(out.inserted).toBe(2);
  });
});
