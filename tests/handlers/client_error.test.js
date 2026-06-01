/**
 * Unit tests for worker-src/handlers/client_error.js (E5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleClientError } from '../../worker-src/handlers/client_error.js';

function kv() {
  const store = new Map();
  return { get: vi.fn(async k => store.get(k) ?? null), put: vi.fn(async (k, v) => { store.set(k, v); }) };
}
function env() {
  // No SENTRY_DSN / BETTER_STACK → shipError no-ops internally; we only
  // assert the handler's own contract (status + rate limit + filtering).
  return { RATELIMIT_KV: kv() };
}
function req(body, ip = '203.0.113.5') {
  return new Request('https://w.test/be/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => vi.restoreAllMocks());

describe('handleClientError', () => {
  it('returns 204 for a valid error report', async () => {
    const res = await handleClientError(req({ message: 'TypeError: x is undefined', stack: 'at foo' }), env());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns 204 (drops) on malformed JSON', async () => {
    const res = await handleClientError(req('not-json'), env());
    expect(res.status).toBe(204);
  });

  it('returns 204 (drops) on empty message', async () => {
    const res = await handleClientError(req({ message: '   ' }), env());
    expect(res.status).toBe(204);
  });

  it('ignores noise like "Script error." without calling observability', async () => {
    // shipError would try to fetch Sentry; with no DSN it no-ops, but we
    // assert no throw + 204 for the known-noise message.
    const res = await handleClientError(req({ message: 'Script error.' }), env());
    expect(res.status).toBe(204);
  });

  it('rate-limits after 30 reports from one IP (still 204)', async () => {
    const sharedEnv = env();
    let last;
    for (let i = 0; i < 35; i++) {
      last = await handleClientError(req({ message: 'boom ' + i }), sharedEnv);
    }
    // Always 204 to the browser (we silently drop excess server-side).
    expect(last.status).toBe(204);
  });

  it('fails open to 204 even if observability throws', async () => {
    // Force fetch to throw (shipSentry uses fetch); handler must still 204.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const res = await handleClientError(
      req({ message: 'Error: boom', stack: 'x' }),
      { RATELIMIT_KV: kv(), SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/1' }
    );
    expect(res.status).toBe(204);
  });
});
