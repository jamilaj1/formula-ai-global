/**
 * Worker tests — exercises the real worker.js via its default export.
 *
 * Strategy: mock global fetch to intercept Supabase + Anthropic + Stripe + Paystack
 * calls, then dispatch synthetic Requests to worker.fetch(req, env). This proves
 * the routing layer, CORS handling, auth resolution, rate limiting, and webhook
 * signature verification work end-to-end without deploying.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../worker.js';

const baseEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_KEY: 'service-test-key',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  PAYSTACK_SECRET_KEY: 'sk_test_paystack',
  STRIPE_PRICE_PRO: 'price_pro',
  STRIPE_PRICE_BIZ: 'price_biz',
  STRIPE_PRICE_ENT: 'price_ent',
  ALLOWED_ORIGIN: 'https://jamilformula.com',
};

function makeRequest(path, init = {}) {
  return new Request(`https://worker.test${path}`, init);
}

function authedRequest(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', 'Bearer fake-jwt-token');
  return new Request(`https://worker.test${path}`, { ...init, headers });
}

/** Mock fetch that responds with success for Supabase auth resolution. */
function mockAuthedFetch(extra = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'user-uuid-123', email: 'jamil@test.com' }), {
        status: 200,
      });
    }
    if (u.includes('/rest/v1/profiles')) {
      return new Response(JSON.stringify([{ plan: 'professional' }]), { status: 200 });
    }
    if (u.includes('/rest/v1/api_usage')) {
      return new Response('[]', {
        status: 200,
        headers: { 'content-range': '0-0/0' },
      });
    }
    if (extra[u]) return extra[u](init);
    for (const key of Object.keys(extra)) {
      if (u.includes(key)) return extra[key](init);
    }
    return new Response('{}', { status: 200 });
  });
}

/** Compute hex HMAC-SHA512 (Paystack) or HMAC-SHA256 (Stripe). */
async function hmacHex(secret, message, hash) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

beforeEach(() => {
  vi.restoreAllMocks();
});

/* ─── CORS + Routing basics ───────────────────────────────────────── */

describe('CORS preflight', () => {
  it('responds 200 with CORS headers on OPTIONS', async () => {
    const res = await worker.fetch(makeRequest('/search', { method: 'OPTIONS' }), baseEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('sets Access-Control-Allow-Origin on every response', async () => {
    const res = await worker.fetch(makeRequest('/'), baseEnv);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });
});

describe('health endpoint', () => {
  it('GET / returns service metadata', async () => {
    const res = await worker.fetch(makeRequest('/'), baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toMatch(/Formula AI/i);
    expect(Array.isArray(body.endpoints)).toBe(true);
    expect(body.endpoints).toContain('/search');
    expect(body.endpoints).toContain('/chat');
  });

  it('GET /health returns the same metadata', async () => {
    const res = await worker.fetch(makeRequest('/health'), baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});

describe('unknown routes', () => {
  it('returns 404 for an undefined path', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const res = await worker.fetch(makeRequest('/definitely-not-a-route'), baseEnv);
    expect(res.status).toBe(404);
  });
});

/* ─── /search ─────────────────────────────────────────────────────── */

describe('/search', () => {
  it('rejects empty query early', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const res = await worker.fetch(makeRequest('/search?q='), baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBe('empty');
    expect(body.rows).toEqual([]);
  });

  it('returns 429 when guest exceeds daily limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/rest/v1/api_usage')) {
        return new Response('[]', {
          status: 200,
          headers: { 'content-range': '0-9/9999' },
        });
      }
      return new Response('{}', { status: 200 });
    });
    const res = await worker.fetch(makeRequest('/search?q=shampoo'), baseEnv);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('rate_limit_exceeded');
    expect(body.plan).toBe('guest');
    expect(body.limit).toBe(10);
  });
});

/* ─── /usage ──────────────────────────────────────────────────────── */

describe('/usage', () => {
  it('returns plan + limit + remaining for a guest', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/rest/v1/api_usage')) {
        return new Response('[]', {
          status: 200,
          headers: { 'content-range': '0-2/3' },
        });
      }
      return new Response('{}', { status: 200 });
    });
    const res = await worker.fetch(makeRequest('/usage'), baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toBe('guest');
    expect(body.limit).toBe(10);
    expect(body.used).toBe(3);
    expect(body.remaining).toBe(7);
    expect(body.resetsAt).toBeTruthy();
  });

  it('returns higher limit for a professional user', async () => {
    mockAuthedFetch();
    const res = await worker.fetch(authedRequest('/usage'), baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toBe('professional');
    expect(body.limit).toBe(100);
  });
});

/* ─── /safety + /lab ──────────────────────────────────────────────── */

describe('/safety', () => {
  it('rejects invalid JSON body', async () => {
    const res = await worker.fetch(
      makeRequest('/safety', { method: 'POST', body: 'not-json' }),
      baseEnv
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });

  it('rejects formula without components', async () => {
    const res = await worker.fetch(
      makeRequest('/safety', { method: 'POST', body: JSON.stringify({ name: 'x' }) }),
      baseEnv
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_components');
  });
});

describe('/lab', () => {
  it('rejects invalid JSON body', async () => {
    const res = await worker.fetch(
      makeRequest('/lab', { method: 'POST', body: '{not json' }),
      baseEnv
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });

  it('rejects formula without components', async () => {
    const res = await worker.fetch(
      makeRequest('/lab', { method: 'POST', body: JSON.stringify({}) }),
      baseEnv
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_components');
  });
});

/* ─── Auth-required endpoints reject guests ───────────────────────── */

describe('Endpoints that require authentication', () => {
  const guestPosts = [
    '/save_formula',
    '/extract',
    '/discover',
    '/cost',
    '/scale',
    '/prices',
    '/paystack/checkout',
    '/stripe/checkout',
  ];

  for (const path of guestPosts) {
    it(`POST ${path} returns 401 for a guest`, async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () => new Response('{}', { status: 200 })
      );
      const res = await worker.fetch(
        makeRequest(path, { method: 'POST', body: JSON.stringify({}) }),
        baseEnv
      );
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('auth_required');
    });
  }

  it('GET /library returns 401 for a guest', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const res = await worker.fetch(makeRequest('/library'), baseEnv);
    expect(res.status).toBe(401);
  });

  it('GET /library/some-id returns 401 for a guest', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const res = await worker.fetch(makeRequest('/library/abc-123'), baseEnv);
    expect(res.status).toBe(401);
  });

  it('DELETE /library/some-id returns 401 for a guest', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const res = await worker.fetch(makeRequest('/library/abc-123', { method: 'DELETE' }), baseEnv);
    expect(res.status).toBe(401);
  });
});

/* ─── auth resolution ─────────────────────────────────────────────── */

describe('auth resolution', () => {
  it('treats requests without Authorization header as guest', async () => {
    let usagePayload = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('/rest/v1/api_usage') && init?.method === 'POST') {
        usagePayload = JSON.parse(init.body);
      }
      if (u.includes('/rest/v1/api_usage')) {
        return new Response('[]', {
          status: 200,
          headers: { 'content-range': '0-0/0' },
        });
      }
      if (u.includes('anthropic.com')) {
        return new Response(
          JSON.stringify({
            content: [{ type: 'text', text: '{"must":["shampoo"],"categories":[],"boost":[]}' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.includes('/rest/v1/formulas')) {
        return new Response('[]', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    const res = await worker.fetch(
      makeRequest('/search?q=shampoo', {
        headers: { 'CF-Connecting-IP': '203.0.113.42' },
      }),
      baseEnv
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usage.plan).toBe('guest');
    if (usagePayload) {
      expect(usagePayload.caller_id).toMatch(/^ip:/);
    }
  });

  it('treats requests with invalid Bearer token as guest (fail-soft)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) {
        return new Response('Unauthorized', { status: 401 });
      }
      if (u.includes('/rest/v1/api_usage')) {
        return new Response('[]', {
          status: 200,
          headers: { 'content-range': '0-0/0' },
        });
      }
      return new Response('{}', { status: 200 });
    });
    const res = await worker.fetch(authedRequest('/usage'), baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toBe('guest');
  });
});

/* ─── /stripe/checkout ────────────────────────────────────────────── */

describe('/stripe/checkout', () => {
  it('returns 401 for unauthenticated callers', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const res = await worker.fetch(
      makeRequest('/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan: 'professional' }),
      }),
      baseEnv
    );
    expect(res.status).toBe(401);
  });

  it('returns 503 when STRIPE_SECRET_KEY is missing', async () => {
    mockAuthedFetch();
    const envNoStripe = { ...baseEnv, STRIPE_SECRET_KEY: '' };
    const res = await worker.fetch(
      authedRequest('/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan: 'professional' }),
      }),
      envNoStripe
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('stripe_not_configured');
  });

  it('rejects unknown plan name', async () => {
    mockAuthedFetch();
    const res = await worker.fetch(
      authedRequest('/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan: 'nonsense' }),
      }),
      baseEnv
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unknown_plan');
  });
});

/* ─── /paystack/checkout ──────────────────────────────────────────── */

describe('/paystack/checkout', () => {
  it('returns 401 for unauthenticated callers', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const res = await worker.fetch(
      makeRequest('/paystack/checkout', { method: 'POST', body: JSON.stringify({ plan: 'pro' }) }),
      baseEnv
    );
    expect(res.status).toBe(401);
  });
});

/* ─── /stripe/webhook signature verification (post-fix) ───────────── */

describe('/stripe/webhook signature verification', () => {
  it('rejects POST without stripe-signature header', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
    const res = await worker.fetch(
      makeRequest('/stripe/webhook', { method: 'POST', body }),
      baseEnv
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST with malformed stripe-signature header', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
    const res = await worker.fetch(
      makeRequest('/stripe/webhook', {
        method: 'POST',
        body,
        headers: { 'stripe-signature': 'garbage' },
      }),
      baseEnv
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST with forged signature (wrong secret)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { metadata: { user_id: 'victim-uuid', plan: 'enterprise' } } },
    });
    const forgedSig = await hmacHex('wrong-secret', `${timestamp}.${body}`, 'SHA-256');
    const res = await worker.fetch(
      makeRequest('/stripe/webhook', {
        method: 'POST',
        body,
        headers: { 'stripe-signature': `t=${timestamp},v1=${forgedSig}` },
      }),
      baseEnv
    );
    expect(res.status).toBe(401);
  });

  it('accepts POST with valid Stripe signature', async () => {
    let patchedProfile = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/rest/v1/profiles')) {
        patchedProfile = init?.body ? JSON.parse(init.body) : null;
        return new Response(null, { status: 204 });
      }
      return new Response('{}', { status: 200 });
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { metadata: { user_id: 'paying-user-uuid', plan: 'professional' } } },
    });
    const sig = await hmacHex(baseEnv.STRIPE_WEBHOOK_SECRET, `${timestamp}.${body}`, 'SHA-256');
    const res = await worker.fetch(
      makeRequest('/stripe/webhook', {
        method: 'POST',
        body,
        headers: { 'stripe-signature': `t=${timestamp},v1=${sig}` },
      }),
      baseEnv
    );
    expect(res.status).toBe(200);
    expect(patchedProfile).toEqual(expect.objectContaining({ plan: 'professional' }));
  });
});

/* ─── /agents and /vision proxy (Phase 3 + 6) ─────────────────── */

describe('/agents proxy', () => {
  it('returns 503 when CHEM_BACKEND_URL is not configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const envNo = { ...baseEnv, CHEM_BACKEND_URL: '' };
    const res = await worker.fetch(
      makeRequest('/agents/evaluate', {
        method: 'POST',
        body: JSON.stringify({ formula: {} }),
      }),
      envNo
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('backend_not_configured');
  });

  it('forwards /agents/evaluate to backend /api/agents/evaluate', async () => {
    let capturedUrl = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/api/agents/evaluate')) {
        capturedUrl = u;
        return new Response(
          JSON.stringify({ overall_verdict: 'ready', summary: 'ok' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    });
    const envWith = { ...baseEnv, CHEM_BACKEND_URL: 'https://chem.example.com' };
    const res = await worker.fetch(
      makeRequest('/agents/evaluate', {
        method: 'POST',
        body: JSON.stringify({ formula: { components: [] } }),
      }),
      envWith
    );
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain('https://chem.example.com/api/agents/evaluate');
    const body = await res.json();
    expect(body.overall_verdict).toBe('ready');
  });
});

describe('/vision proxy', () => {
  it('forwards /vision/label to backend /api/vision/label', async () => {
    let capturedUrl = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/api/vision/label')) {
        capturedUrl = u;
        return new Response(
          JSON.stringify({ ok: true, ingredients: ['water', 'glycerin'] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    });
    const envWith = { ...baseEnv, CHEM_BACKEND_URL: 'https://chem.example.com' };
    const res = await worker.fetch(
      makeRequest('/vision/label', {
        method: 'POST',
        body: JSON.stringify({ image: 'data:image/jpeg;base64,...' }),
      }),
      envWith
    );
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain('https://chem.example.com/api/vision/label');
  });

  it('returns 503 when CHEM_BACKEND_URL is not configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const envNo = { ...baseEnv, CHEM_BACKEND_URL: '' };
    const res = await worker.fetch(
      makeRequest('/vision/structure', {
        method: 'POST',
        body: JSON.stringify({ image: 'x' }),
      }),
      envNo
    );
    expect(res.status).toBe(503);
  });
});

/* ─── /paystack/webhook signature verification (post-fix) ─────────── */

/* ─── /chem/* proxy (Phase 1 — RDKit backend) ─────────────────── */

describe('/chem proxy', () => {
  it('returns 503 when CHEM_BACKEND_URL is not configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const envNoChem = { ...baseEnv, CHEM_BACKEND_URL: '' };
    const res = await worker.fetch(
      makeRequest('/chem/properties', {
        method: 'POST',
        body: JSON.stringify({ smiles: 'CCO' }),
      }),
      envNoChem
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('chem_backend_not_configured');
  });

  it('forwards /chem/properties to backend /api/chem/properties', async () => {
    let capturedUrl = null;
    let capturedBody = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('/api/chem/properties')) {
        capturedUrl = u;
        capturedBody = init?.body;
        return new Response(
          JSON.stringify({ valid: true, molecular_weight: 46.069, formula: 'C2H6O' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const envWithChem = { ...baseEnv, CHEM_BACKEND_URL: 'https://chem.example.com' };
    const res = await worker.fetch(
      makeRequest('/chem/properties', {
        method: 'POST',
        body: JSON.stringify({ smiles: 'CCO' }),
      }),
      envWithChem
    );
    expect(res.status).toBe(200);
    expect(capturedUrl).toContain('https://chem.example.com/api/chem/properties');
    expect(capturedBody).toBe(JSON.stringify({ smiles: 'CCO' }));
    const body = await res.json();
    expect(body.molecular_weight).toBe(46.069);
  });

  it('returns 502 when backend is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('network unreachable');
    });
    const envWithChem = { ...baseEnv, CHEM_BACKEND_URL: 'https://chem.example.com' };
    const res = await worker.fetch(
      makeRequest('/chem/health', { method: 'GET' }),
      envWithChem
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('chem_backend_unreachable');
  });

  it('attaches auth context headers to the backend request', async () => {
    let capturedHeaders = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) {
        return new Response(
          JSON.stringify({ id: 'user-uuid-xyz', email: 'jamil@test.com' }),
          { status: 200 }
        );
      }
      if (u.includes('/rest/v1/profiles')) {
        return new Response(JSON.stringify([{ plan: 'professional' }]), { status: 200 });
      }
      if (u.includes('/api/chem/')) {
        capturedHeaders = init?.headers || {};
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const envWithChem = { ...baseEnv, CHEM_BACKEND_URL: 'https://chem.example.com' };
    await worker.fetch(authedRequest('/chem/health'), envWithChem);
    expect(capturedHeaders).toBeTruthy();
    expect(capturedHeaders['X-Forwarded-User-Id']).toBe('user-uuid-xyz');
    expect(capturedHeaders['X-Forwarded-User-Plan']).toBe('professional');
    expect(capturedHeaders['X-Forwarded-User-Kind']).toBe('user');
  });
});

describe('/paystack/webhook signature verification', () => {
  it('rejects POST without x-paystack-signature header', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const body = JSON.stringify({ event: 'charge.success', data: {} });
    const res = await worker.fetch(
      makeRequest('/paystack/webhook', { method: 'POST', body }),
      baseEnv
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST with forged signature (wrong secret)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200 })
    );
    const body = JSON.stringify({
      event: 'charge.success',
      data: { metadata: { user_id: 'victim-uuid', plan: 'enterprise' } },
    });
    const forged = await hmacHex('wrong-secret', body, 'SHA-512');
    const res = await worker.fetch(
      makeRequest('/paystack/webhook', {
        method: 'POST',
        body,
        headers: { 'x-paystack-signature': forged },
      }),
      baseEnv
    );
    expect(res.status).toBe(401);
  });

  it('accepts POST with valid Paystack signature', async () => {
    let patched = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/rest/v1/profiles')) {
        patched = init?.body ? JSON.parse(init.body) : null;
        return new Response(null, { status: 204 });
      }
      return new Response('{}', { status: 200 });
    });
    const body = JSON.stringify({
      event: 'charge.success',
      data: { metadata: { user_id: 'paying-uuid', plan: 'business' } },
    });
    const sig = await hmacHex(baseEnv.PAYSTACK_SECRET_KEY, body, 'SHA-512');
    const res = await worker.fetch(
      makeRequest('/paystack/webhook', {
        method: 'POST',
        body,
        headers: { 'x-paystack-signature': sig },
      }),
      baseEnv
    );
    expect(res.status).toBe(200);
    expect(patched).toEqual(expect.objectContaining({ plan: 'business' }));
  });
});
