/**
 * Unit tests for worker-src/handlers/stats.js — Phase 6 campaign counter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCommunityStats } from '../../worker-src/handlers/stats.js';

function kv() {
  const store = new Map();
  return {
    store,
    get: vi.fn(async (k) => store.get(k) ?? null),
    put: vi.fn(async (k, v) => { store.set(k, v); }),
  };
}
function env(over = {}) {
  return { SUPABASE_URL: 'https://t.supabase.co', SUPABASE_SERVICE_KEY: 'k', ...over };
}
/** PostgREST count=exact reply via Content-Range header. */
function countReply(n) {
  return new Response('[]', { status: 200, headers: { 'content-range': `0-0/${n}` } });
}

beforeEach(() => vi.restoreAllMocks());

describe('handleCommunityStats', () => {
  it('returns real users + formulas counts + static industries', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/profiles')) return countReply(1247);
      if (u.includes('/formulas')) return countReply(3381);
      return new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } });
    });
    const res = await handleCommunityStats(env({ RATELIMIT_KV: kv() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toBe(1247);
    expect(body.formulas).toBe(3381);
    expect(body.industries).toBe(40);
  });

  it('serves from cache on the second call (no second count storm)', async () => {
    const sharedKv = kv();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/profiles')) return countReply(10);
      if (u.includes('/formulas')) return countReply(3381);
      return new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } });
    });
    await handleCommunityStats(env({ RATELIMIT_KV: sharedKv }));   // live → caches
    const callsAfterFirst = spy.mock.calls.length;
    const res2 = await handleCommunityStats(env({ RATELIMIT_KV: sharedKv })); // cache
    const body = await res2.json();
    expect(body.cached).toBe(true);
    expect(spy.mock.calls.length).toBe(callsAfterFirst); // no new Supabase calls
  });

  it('degrades to 0 users when the count query fails (never throws)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/profiles')) return new Response('err', { status: 500 });
      if (String(url).includes('/formulas')) return countReply(3381);
      return new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } });
    });
    const res = await handleCommunityStats(env({ RATELIMIT_KV: kv() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toBe(0);
    expect(body.formulas).toBe(3381);
  });

  it('works without a KV binding (cache simply skipped)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/profiles')) return countReply(5);
      if (String(url).includes('/formulas')) return countReply(3381);
      return new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } });
    });
    const res = await handleCommunityStats(env());  // no RATELIMIT_KV
    expect(res.status).toBe(200);
    expect((await res.json()).users).toBe(5);
  });
});
