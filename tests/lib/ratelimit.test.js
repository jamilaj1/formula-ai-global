/**
 * Unit tests for worker-src/lib/ratelimit.js.
 *
 * The limiter is a fixed-window counter keyed by `bucket:<window-id>`.
 * We stub KV with an in-memory Map so behaviour matches production minus
 * the TTL eviction (which the unit test doesn't try to assert — KV TTL
 * is Cloudflare's responsibility).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  rateLimit,
  rateLimitResponse,
  clientIP,
} from '../../worker-src/lib/ratelimit.js';

function fakeKv() {
  const store = new Map();
  return {
    store,
    get: vi.fn(async (k) => store.get(k) ?? null),
    put: vi.fn(async (k, v) => { store.set(k, v); }),
  };
}

describe('clientIP', () => {
  it('prefers CF-Connecting-IP when present', () => {
    const req = new Request('https://x.test/', {
      headers: { 'CF-Connecting-IP': '1.1.1.1', 'X-Forwarded-For': '2.2.2.2' },
    });
    expect(clientIP(req)).toBe('1.1.1.1');
  });

  it('falls back to the first X-Forwarded-For entry when CF missing', () => {
    const req = new Request('https://x.test/', {
      headers: { 'X-Forwarded-For': '3.3.3.3, 4.4.4.4' },
    });
    expect(clientIP(req)).toBe('3.3.3.3');
  });

  it('falls back to X-Real-IP', () => {
    const req = new Request('https://x.test/', {
      headers: { 'X-Real-IP': '5.5.5.5' },
    });
    expect(clientIP(req)).toBe('5.5.5.5');
  });

  it('returns "unknown" when no IP header is present', () => {
    const req = new Request('https://x.test/');
    expect(clientIP(req)).toBe('unknown');
  });
});

describe('rateLimit', () => {
  it('fails OPEN when RATELIMIT_KV not bound (degraded mode)', async () => {
    const r = await rateLimit({}, { bucket: 'x', limit: 10, window: 60 });
    expect(r.ok).toBe(true);
    expect(r.used).toBe(0);
  });

  it('allows N requests, then blocks the (N+1)th', async () => {
    const env = { RATELIMIT_KV: fakeKv() };
    for (let i = 1; i <= 5; i++) {
      const r = await rateLimit(env, { bucket: 'b', limit: 5, window: 60 });
      expect(r.ok).toBe(true);
      expect(r.used).toBe(i);
    }
    const r6 = await rateLimit(env, { bucket: 'b', limit: 5, window: 60 });
    expect(r6.ok).toBe(false);
    expect(r6.used).toBe(6);
    expect(r6.retryAfter).toBeGreaterThan(0);
  });

  it('separates buckets per identity', async () => {
    const env = { RATELIMIT_KV: fakeKv() };
    for (let i = 0; i < 3; i++) {
      await rateLimit(env, { bucket: 'user-a', limit: 3, window: 60 });
    }
    const otherUser = await rateLimit(env, { bucket: 'user-b', limit: 3, window: 60 });
    expect(otherUser.ok).toBe(true);
    expect(otherUser.used).toBe(1);
  });

  it('persists with expirationTtl = window + 5 (boundary safety)', async () => {
    const kv = fakeKv();
    await rateLimit({ RATELIMIT_KV: kv }, { bucket: 'x', limit: 5, window: 60 });
    const opts = kv.put.mock.calls[0][2];
    expect(opts.expirationTtl).toBe(65);
  });

  it('substitutes safe defaults when limit/window are 0 or non-numeric', async () => {
    // limit: 0 → falsy → `0 || 30` → 30. Same for window: 0 → 60.
    // This is intentional: missing/zero values shouldn't accidentally
    // block everything; they fall back to sensible defaults instead.
    const env = { RATELIMIT_KV: fakeKv() };
    const r = await rateLimit(env, { bucket: 'c', limit: 0, window: 0 });
    expect(r.ok).toBe(true);
    expect(r.limit).toBe(30);
  });

  it('clamps negative limit to 1 (genuinely "almost-no-quota")', async () => {
    const env = { RATELIMIT_KV: fakeKv() };
    // limit: -5 is truthy, so `||` doesn't substitute; Math.max(1, -5) = 1.
    const r1 = await rateLimit(env, { bucket: 'neg', limit: -5, window: 60 });
    expect(r1.ok).toBe(true);    // 1st call: used=1, 1 > 1 is false → allowed
    expect(r1.limit).toBe(1);
    const r2 = await rateLimit(env, { bucket: 'neg', limit: -5, window: 60 });
    expect(r2.ok).toBe(false);   // 2nd call: used=2, 2 > 1 → blocked
  });

  it('returns resetIn in seconds within the current window', async () => {
    const env = { RATELIMIT_KV: fakeKv() };
    const r = await rateLimit(env, { bucket: 'd', limit: 100, window: 60 });
    expect(r.resetIn).toBeGreaterThanOrEqual(1);
    expect(r.resetIn).toBeLessThanOrEqual(60);
  });
});

describe('rateLimitResponse', () => {
  it('returns 429 with rate-limit headers', async () => {
    const res = rateLimitResponse({ used: 5, limit: 3, resetIn: 30, retryAfter: 30 });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).toBe('30');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.error).toBe('rate_limit_exceeded');
    expect(body.used).toBe(5);
    expect(body.limit).toBe(3);
    expect(body.retry_after).toBe(30);
  });

  it('accepts a custom error code', async () => {
    const res = rateLimitResponse(
      { used: 1, limit: 0, resetIn: 60, retryAfter: 60 },
      'too_many_intake_submissions'
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('too_many_intake_submissions');
  });
});
