/**
 * Unit tests for worker-src/handlers/consulting.js.
 *
 * Covers the four Phase 2 handlers + the Phase 2-close additions:
 *   intake   — validation (package, email, fields), rate limit, user_id stamping
 *   list     — owner-only gate
 *   deliver  — owner gate + body forwarding + markdown size cap + backend errors
 *   resend   — owner gate + URL routing
 *   pay      — Paystack key gate, request lookup, custom-needs-discovery, already-paid
 *
 * We import the handler functions directly and pass a fake env with an
 * in-memory KV. globalThis.fetch is mocked per test so no live network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleConsultingIntake,
  handleConsultingList,
  handleConsultingDeliver,
  handleConsultingResend,
  handleConsultingPay,
} from '../../worker-src/handlers/consulting.js';

const OWNER = 'jamilaj1@gmail.com';

function fakeKv() {
  const store = new Map();
  return {
    get: vi.fn(async (k) => store.get(k) ?? null),
    put: vi.fn(async (k, v) => { store.set(k, v); }),
  };
}

function baseEnv(over = {}) {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'anon-test',
    SUPABASE_SERVICE_KEY: 'service-test',
    PAYSTACK_SECRET_KEY: 'sk_test_paystack',
    CHEM_BACKEND_URL: 'https://chem.test',
    BACKEND_INTERNAL_SECRET: 'internal-shared-secret',
    RATELIMIT_KV: fakeKv(),
    ...over,
  };
}

function ownerAuth() {
  return { kind: 'user', email: OWNER, userId: 'owner-uuid', id: 'auth-1', plan: 'enterprise' };
}

function intakeReq(body, headers = {}) {
  return new Request('https://w.test/be/consulting/intake', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42', ...headers },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

/* ─── intake validation ─────────────────────────────────────────── */

describe('handleConsultingIntake — validation', () => {
  it('rejects invalid JSON body', async () => {
    const req = new Request('https://w.test/be/consulting/intake', {
      method: 'POST',
      body: 'not-json',
      headers: { 'CF-Connecting-IP': '1.1.1.1' },
    });
    const res = await handleConsultingIntake(req, null, baseEnv());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });

  it('rejects invalid package', async () => {
    const res = await handleConsultingIntake(
      intakeReq({
        package: 'bogus', email: 'x@y.com',
        product_type: 'p', market: 'm', brief: 'b'.repeat(30),
      }),
      null, baseEnv()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_package');
  });

  it('rejects invalid email', async () => {
    const res = await handleConsultingIntake(
      intakeReq({
        package: 'quick', email: 'no-at-sign',
        product_type: 'p', market: 'm', brief: 'b'.repeat(30),
      }),
      null, baseEnv()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_email');
  });

  it('rejects missing required fields', async () => {
    const res = await handleConsultingIntake(
      intakeReq({
        package: 'quick', email: 'x@y.com',
        product_type: '', market: 'm', brief: '',
      }),
      null, baseEnv()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_fields');
  });

  it('accepts a valid intake, lowercases the email, and stamps amount_usd', async () => {
    let captured = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify([{ id: 'req-123' }]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const res = await handleConsultingIntake(
      intakeReq({
        package: 'full',
        email: 'CHEMIST@example.com',
        company: 'Co',
        product_type: 'shampoo',
        market: 'KSA',
        brief: 'I need a sulphate-free shampoo for dry hair'.repeat(2),
      }),
      null, baseEnv()
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe('req-123');
    expect(body.package).toBe('full');
    expect(body.amount_usd).toBe(2500);
    expect(captured.email).toBe('chemist@example.com');  // lower-cased
    expect(captured.amount_usd).toBe(2500);
    expect(captured.status).toBe('intake');
  });

  it('attaches user_id when the caller is signed in', async () => {
    let captured = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify([{ id: 'req-x' }]), { status: 201 });
    });
    await handleConsultingIntake(
      intakeReq({
        package: 'quick', email: 'x@y.com',
        product_type: 'p', market: 'm', brief: 'b'.repeat(30),
      }),
      { kind: 'user', userId: 'signed-in-uuid', email: 'x@y.com' },
      baseEnv()
    );
    expect(captured.user_id).toBe('signed-in-uuid');
  });

  it('rate-limits after 3 intakes from the same IP', async () => {
    let count = 0;
    const kv = {
      get: vi.fn(async () => String(count)),
      put: vi.fn(async (_k, v) => { count = parseInt(v, 10); }),
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify([{ id: 'req-x' }]), { status: 201 })
    );
    const env = baseEnv({ RATELIMIT_KV: kv });
    const valid = {
      package: 'quick', email: 'x@y.com',
      product_type: 'p', market: 'm', brief: 'b'.repeat(30),
    };
    // 3 allowed
    for (let i = 0; i < 3; i++) {
      const ok = await handleConsultingIntake(intakeReq(valid), null, env);
      expect(ok.status).toBe(200);
    }
    // 4th blocked
    const blocked = await handleConsultingIntake(intakeReq(valid), null, env);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toBe('too_many_intake_submissions');
  });

  it('returns 500 on DB error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('relation broken', { status: 500 })
    );
    const res = await handleConsultingIntake(
      intakeReq({
        package: 'quick', email: 'x@y.com',
        product_type: 'p', market: 'm', brief: 'b'.repeat(30),
      }),
      null, baseEnv()
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('db_error');
  });
});

/* ─── list (owner-only) ─────────────────────────────────────────── */

describe('handleConsultingList — owner gate', () => {
  it('returns 403 for a guest', async () => {
    const res = await handleConsultingList(null, baseEnv());
    expect(res.status).toBe(403);
  });

  it('returns 403 for a non-owner user', async () => {
    const res = await handleConsultingList(
      { kind: 'user', email: 'someone@else.com' },
      baseEnv()
    );
    expect(res.status).toBe(403);
  });

  it('returns the rows for the owner', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ id: 'r1', status: 'intake' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const res = await handleConsultingList(ownerAuth(), baseEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.requests)).toBe(true);
    expect(body.requests[0].id).toBe('r1');
  });
});

/* ─── deliver ───────────────────────────────────────────────────── */

describe('handleConsultingDeliver — owner-only proxy', () => {
  function deliverReq(body) {
    return new Request('https://w.test/be/consulting/deliver', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  it('returns 403 for a non-owner', async () => {
    const res = await handleConsultingDeliver(
      deliverReq({ id: 'abc' }),
      { kind: 'user', email: 'other@x.com' },
      baseEnv()
    );
    expect(res.status).toBe(403);
  });

  it('rejects missing id', async () => {
    const res = await handleConsultingDeliver(
      deliverReq({ markdown_override: 'x' }),
      ownerAuth(),
      baseEnv()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_id');
  });

  it('forwards id + markdown_override + force to backend deliver endpoint', async () => {
    let capturedUrl = null;
    let capturedBody = null;
    let capturedHeaders = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body);
      capturedHeaders = init.headers;
      return new Response(
        JSON.stringify({ ok: true, status: 'delivered', email_id: 'em-1' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const res = await handleConsultingDeliver(
      deliverReq({ id: 'req-xyz', markdown_override: '# Hello\nbody', force: false }),
      ownerAuth(),
      baseEnv()
    );
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain('https://chem.test/api/v2/consulting/req-xyz/deliver');
    expect(capturedBody.markdown_override).toContain('Hello');
    expect(capturedBody.force).toBe(false);
    expect(capturedHeaders['x-formula-internal']).toBe('internal-shared-secret');
  });

  it('caps markdown_override at 200KB', async () => {
    let capturedBody = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const huge = 'A'.repeat(250_000);
    await handleConsultingDeliver(
      deliverReq({ id: 'req-1', markdown_override: huge }),
      ownerAuth(), baseEnv()
    );
    expect(capturedBody.markdown_override.length).toBe(200_000);
  });

  it('returns 500 when CHEM_BACKEND_URL is missing', async () => {
    const res = await handleConsultingDeliver(
      deliverReq({ id: 'r1' }),
      ownerAuth(),
      baseEnv({ CHEM_BACKEND_URL: '' })
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('backend_not_configured');
  });

  it('returns 502 when backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const res = await handleConsultingDeliver(
      deliverReq({ id: 'r1' }),
      ownerAuth(),
      baseEnv()
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('backend_unreachable');
  });

  it('propagates backend 4xx error detail and status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'no draft' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const res = await handleConsultingDeliver(
      deliverReq({ id: 'r1' }),
      ownerAuth(),
      baseEnv()
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.detail).toBe('no draft');
  });
});

/* ─── resend ────────────────────────────────────────────────────── */

describe('handleConsultingResend — owner-only proxy', () => {
  function resendReq(body) {
    return new Request('https://w.test/be/consulting/resend', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  it('returns 403 for a non-owner', async () => {
    const res = await handleConsultingResend(
      resendReq({ id: 'abc' }),
      { kind: 'user', email: 'other@x.com' },
      baseEnv()
    );
    expect(res.status).toBe(403);
  });

  it('forwards id to backend /resend route', async () => {
    let capturedUrl = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const res = await handleConsultingResend(
      resendReq({ id: 'req-aaa' }),
      ownerAuth(),
      baseEnv()
    );
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain('/api/v2/consulting/req-aaa/resend');
  });
});

/* ─── pay (Paystack) ────────────────────────────────────────────── */

describe('handleConsultingPay — package-specific branches', () => {
  function payReq(body) {
    return new Request('https://w.test/be/consulting/pay', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'CF-Connecting-IP': '203.0.113.42' },
    });
  }

  it('returns 503 when PAYSTACK_SECRET_KEY missing', async () => {
    const res = await handleConsultingPay(
      payReq({ id: 'r1' }),
      null, baseEnv({ PAYSTACK_SECRET_KEY: '' })
    );
    expect(res.status).toBe(503);
  });

  it('returns 400 when id missing', async () => {
    const res = await handleConsultingPay(payReq({}), null, baseEnv());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_id');
  });

  it('returns 404 when request id not found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const res = await handleConsultingPay(payReq({ id: 'nope' }), null, baseEnv());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('request_not_found');
  });

  it('returns 409 custom_needs_discovery_call for the custom package', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{
        id: 'r1', email: 'c@x.com', package: 'custom',
        product_type: 'p', status: 'intake', amount_usd: 5000,
      }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const res = await handleConsultingPay(payReq({ id: 'r1' }), null, baseEnv());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('custom_needs_discovery_call');
  });

  it('returns 409 already_paid for paid/delivered/review/drafting rows', async () => {
    for (const status of ['paid', 'drafting', 'review', 'delivered']) {
      vi.restoreAllMocks();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify([{
          id: 'r1', email: 'c@x.com', package: 'quick',
          product_type: 'p', status, amount_usd: 1000,
        }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      const res = await handleConsultingPay(payReq({ id: 'r1' }), null, baseEnv());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('already_paid');
    }
  });
});
