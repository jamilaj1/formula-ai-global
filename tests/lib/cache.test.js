/**
 * Unit tests for worker-src/lib/cache.js.
 *
 * Strategy: import the lib directly (not via the bundled worker.js) and
 * pass a fake KV namespace. crypto.subtle is available in Node 18+ as a
 * global, so the SHA-256 path runs identically to the production
 * Cloudflare Workers runtime.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildCacheKey,
  cacheGet,
  cachePut,
  cacheGetOrSet,
} from '../../worker-src/lib/cache.js';

function fakeKv() {
  const store = new Map();
  return {
    store,
    get: vi.fn(async (k) => store.get(k) ?? null),
    put: vi.fn(async (k, v) => { store.set(k, v); }),
  };
}

describe('buildCacheKey', () => {
  it('returns a deterministic "cache:<64hex>" string', async () => {
    const k1 = await buildCacheKey({
      model: 'a', system: 'b', messages: [{ role: 'user', content: 'hi' }],
    });
    const k2 = await buildCacheKey({
      model: 'a', system: 'b', messages: [{ role: 'user', content: 'hi' }],
    });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^cache:[a-f0-9]{64}$/);
  });

  it('produces different keys for different models', async () => {
    const k1 = await buildCacheKey({ model: 'sonnet', messages: [] });
    const k2 = await buildCacheKey({ model: 'haiku',  messages: [] });
    expect(k1).not.toBe(k2);
  });

  it('produces different keys for different system prompts', async () => {
    const k1 = await buildCacheKey({ model: 'a', system: 'x', messages: [] });
    const k2 = await buildCacheKey({ model: 'a', system: 'y', messages: [] });
    expect(k1).not.toBe(k2);
  });

  it('produces different keys for different messages', async () => {
    const k1 = await buildCacheKey({ model: 'a', messages: [{ role: 'user', content: 'hi'  }] });
    const k2 = await buildCacheKey({ model: 'a', messages: [{ role: 'user', content: 'hey' }] });
    expect(k1).not.toBe(k2);
  });

  it('produces different keys for different tools', async () => {
    const k1 = await buildCacheKey({ model: 'a', messages: [], tools: [{ name: 'x' }] });
    const k2 = await buildCacheKey({ model: 'a', messages: [], tools: [{ name: 'y' }] });
    expect(k1).not.toBe(k2);
  });

  it('treats missing system / tools as empty (idempotent contract)', async () => {
    const k1 = await buildCacheKey({ model: 'a', messages: [] });
    const k2 = await buildCacheKey({ model: 'a', system: '', messages: [], tools: [] });
    expect(k1).toBe(k2);
  });
});

describe('cachePut + cacheGet', () => {
  it('roundtrips a JSON-serializable response', async () => {
    const env = { RATELIMIT_KV: fakeKv() };
    const ok = await cachePut(env, 'cache:abc', { content: [{ text: 'hi' }] });
    expect(ok).toBe(true);
    const got = await cacheGet(env, 'cache:abc');
    expect(got).toEqual({ content: [{ text: 'hi' }] });
  });

  it('cacheGet returns null on miss', async () => {
    const env = { RATELIMIT_KV: fakeKv() };
    expect(await cacheGet(env, 'cache:missing')).toBeNull();
  });

  it('fail-soft when RATELIMIT_KV is not bound', async () => {
    expect(await cacheGet({}, 'cache:x')).toBeNull();
    expect(await cacheGet(null, 'cache:x')).toBeNull();
    expect(await cachePut({}, 'cache:x', { a: 1 })).toBe(false);
    expect(await cachePut(null, 'cache:x', { a: 1 })).toBe(false);
  });

  it('clamps TTL to a minimum of 60 seconds (typo-protection)', async () => {
    const kv = fakeKv();
    await cachePut({ RATELIMIT_KV: kv }, 'cache:k', { a: 1 }, 5);
    const opts = kv.put.mock.calls[0][2];
    expect(opts.expirationTtl).toBe(60);
  });

  it('defaults TTL to 86400 (24h) when not specified', async () => {
    const kv = fakeKv();
    await cachePut({ RATELIMIT_KV: kv }, 'cache:y', { a: 1 });
    const opts = kv.put.mock.calls[0][2];
    expect(opts.expirationTtl).toBe(86400);
  });

  it('coerces non-integer TTL via bitwise OR (e.g. 3600.7 → 3600)', async () => {
    const kv = fakeKv();
    await cachePut({ RATELIMIT_KV: kv }, 'cache:k', { a: 1 }, 3600.7);
    const opts = kv.put.mock.calls[0][2];
    expect(opts.expirationTtl).toBe(3600);
  });

  it('swallows KV errors and never throws', async () => {
    const kv = {
      get: vi.fn(async () => { throw new Error('kv read down'); }),
      put: vi.fn(async () => { throw new Error('kv write down'); }),
    };
    expect(await cacheGet({ RATELIMIT_KV: kv }, 'cache:x')).toBeNull();
    expect(await cachePut({ RATELIMIT_KV: kv }, 'cache:x', { a: 1 })).toBe(false);
  });

  it('cacheGet returns null when stored value is invalid JSON', async () => {
    const kv = fakeKv();
    kv.store.set('cache:bad', 'not-json{');
    const env = { RATELIMIT_KV: kv };
    expect(await cacheGet(env, 'cache:bad')).toBeNull();
  });
});

describe('cacheGetOrSet', () => {
  function envWithKv() {
    return { RATELIMIT_KV: fakeKv() };
  }

  it('hit path returns the cached value and never invokes the producer', async () => {
    const env = envWithKv();
    await cachePut(env, 'cache:pre', { pre: true });
    const producer = vi.fn(async () => ({ fresh: true }));
    const r = await cacheGetOrSet(env, 'cache:pre', producer);
    expect(r.hit).toBe(true);
    expect(r.response).toEqual({ pre: true });
    expect(producer).not.toHaveBeenCalled();
  });

  it('miss path calls the producer and caches its result', async () => {
    const env = envWithKv();
    const producer = vi.fn(async () => ({ fresh: true }));
    const r = await cacheGetOrSet(env, 'cache:miss', producer);
    expect(r.hit).toBe(false);
    expect(r.response).toEqual({ fresh: true });
    expect(producer).toHaveBeenCalledOnce();
    expect(await cacheGet(env, 'cache:miss')).toEqual({ fresh: true });
  });

  it('does NOT cache when producer returns null/undefined', async () => {
    const env = envWithKv();
    const r = await cacheGetOrSet(env, 'cache:nullp', async () => null);
    expect(r.hit).toBe(false);
    expect(r.response).toBeNull();
    expect(env.RATELIMIT_KV.put).not.toHaveBeenCalled();
  });
});
