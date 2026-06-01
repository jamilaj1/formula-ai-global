/**
 * Unit tests for worker-src/handlers/admin.js — Phase 9.5 financials.
 *
 * Strategy: mock the Supabase REST surface used by the handler so
 * Promise.all resolves with synthetic payloads, then assert the handler
 * computes the headline figures + derived ratios correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAdminFinancials } from '../../worker-src/handlers/admin.js';

const OWNER = 'jamilaj1@gmail.com';

function baseEnv() {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_KEY: 'service-test',
    SUPABASE_ANON_KEY: 'anon-test',
  };
}

function ownerAuth() {
  return { kind: 'user', email: OWNER, userId: 'owner-uuid' };
}

/**
 * Build a fake Supabase fetch responder.
 *
 * `planCounts` maps plan name → row count (delivered via the
 * Content-Range header that PostgREST returns with Prefer: count=exact).
 *
 * `consultRows` and `claudeRows` are returned verbatim as JSON arrays
 * for the consultation_requests + api_usage queries respectively.
 *
 * `totalSignups` and `newSignups30d` are also delivered via
 * Content-Range — separate from the plan counts.
 */
function fakeFetch({
  planCounts = {},
  totalSignups = 0,
  newSignups30d = 0,
  consultRows = [],
  claudeRows = [],
  signupsDaily = null,   // null → RPC 500 (tests graceful degrade)
  activation = null,     // null → RPC 500 (tests graceful degrade)
} = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);

    // E3 — signups_by_day RPC
    if (u.includes('/rpc/signups_by_day')) {
      if (signupsDaily === null) return new Response('err', { status: 500 });
      return new Response(JSON.stringify(signupsDaily), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // D2 — activation_rate RPC
    if (u.includes('/rpc/activation_rate')) {
      if (activation === null) return new Response('err', { status: 500 });
      return new Response(JSON.stringify([activation]), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Plan-specific counts: /profiles?plan=eq.<plan>
    const planMatch = u.match(/profiles\?plan=eq\.([^&]+)/);
    if (planMatch) {
      const plan = decodeURIComponent(planMatch[1]);
      const n = planCounts[plan] ?? 0;
      return new Response('[]', {
        status: 200,
        headers: { 'content-range': `0-0/${n}` },
      });
    }

    // New-signups window: /profiles?created_at=gte....
    if (u.includes('/profiles') && u.includes('created_at=gte')) {
      return new Response('[]', {
        status: 200,
        headers: { 'content-range': `0-0/${newSignups30d}` },
      });
    }

    // Total signups: /profiles (no plan, no created_at filter)
    if (u.includes('/profiles')) {
      return new Response('[]', {
        status: 200,
        headers: { 'content-range': `0-0/${totalSignups}` },
      });
    }

    // Consulting revenue
    if (u.includes('/consultation_requests')) {
      return new Response(JSON.stringify(consultRows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Claude cost (api_usage)
    if (u.includes('/api_usage')) {
      return new Response(JSON.stringify(claudeRows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('{}', { status: 200 });
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

/* ─── auth gate ────────────────────────────────────────────────── */

describe('handleAdminFinancials — auth gate', () => {
  it('returns 403 for a guest (null auth)', async () => {
    const res = await handleAdminFinancials(null, baseEnv());
    expect(res.status).toBe(403);
  });

  it('returns 403 for a non-owner', async () => {
    const res = await handleAdminFinancials(
      { kind: 'user', email: 'someone@else.com' },
      baseEnv()
    );
    expect(res.status).toBe(403);
  });
});

/* ─── headline aggregations ────────────────────────────────────── */

describe('handleAdminFinancials — computed metrics', () => {
  it('computes MRR from active paid plans only', async () => {
    fakeFetch({
      planCounts: {
        free: 400, starter: 80,
        professional: 8,   // 8 × $25 = $200
        business: 2,       // 2 × $50 = $100
        enterprise: 1,     // 1 × $125 = $125
      },
      totalSignups: 491,
    });
    const res = await handleAdminFinancials(ownerAuth(), baseEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mrr_usd).toBe(425);
    expect(body.arr_usd).toBe(425 * 12);
    expect(body.active_paid_users).toBe(11);
    expect(body.plan_distribution.professional).toBe(8);
    expect(body.plan_distribution.enterprise).toBe(1);
  });

  it('returns ARPU = MRR / active_paid_users', async () => {
    fakeFetch({
      planCounts: { professional: 4 },  // 4 × $25 = $100
      totalSignups: 4,
    });
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(body.mrr_usd).toBe(100);
    expect(body.active_paid_users).toBe(4);
    expect(body.arpu_usd).toBe(25);
  });

  it('returns ARPU = 0 when no paid users (no NaN)', async () => {
    fakeFetch({
      planCounts: { free: 50 },
      totalSignups: 50,
    });
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(body.mrr_usd).toBe(0);
    expect(body.active_paid_users).toBe(0);
    expect(body.arpu_usd).toBe(0);
    expect(body.ltv_usd).toBe(0);
    expect(body.conversion_pct).toBe(0);
  });

  it('LTV = ARPU × lifetime_months (default 12)', async () => {
    fakeFetch({ planCounts: { business: 2 } });
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(body.mrr_usd).toBe(100);
    expect(body.arpu_usd).toBe(50);
    expect(body.ltv_usd).toBe(50 * 12);
    expect(body.assumptions.lifetime_months_for_ltv).toBe(12);
  });

  it('sums consulting revenue by status (paid + delivered)', async () => {
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const oneYearAgo = new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString();
    fakeFetch({
      consultRows: [
        { amount_usd: 1000, status: 'paid',      created_at: oneDayAgo },
        { amount_usd: 2500, status: 'delivered', created_at: oneDayAgo },
        { amount_usd:  500, status: 'paid',      created_at: oneYearAgo },
        { amount_usd: 5000, status: 'delivered', created_at: oneYearAgo },
      ],
    });
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(body.consulting_revenue.paid).toBe(1500);     // 1000 + 500
    expect(body.consulting_revenue.delivered).toBe(7500);// 2500 + 5000
    expect(body.consulting_revenue.total).toBe(9000);
    // 30-day window includes only the two recent rows
    expect(body.revenue_30d.consulting).toBe(3500);
  });

  it('computes Claude cost + cache hit ratio over 30 d', async () => {
    fakeFetch({
      claudeRows: [
        { est_cost_usd: 0.05, cache_hit: false },
        { est_cost_usd: 0.10, cache_hit: false },
        { est_cost_usd: 0.00, cache_hit: true  },
        { est_cost_usd: 0.00, cache_hit: true  },
      ],
    });
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(body.claude_cost_30d).toBe(0.15);
    expect(body.claude_calls_30d).toBe(4);
    expect(body.claude_cache_hit_pct).toBe(50);
  });

  it('computes gross margin = (revenue − Claude cost) / revenue', async () => {
    fakeFetch({
      planCounts: { professional: 4 },           // MRR $100
      claudeRows: [{ est_cost_usd: 10, cache_hit: false }],  // cost $10
    });
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(body.mrr_usd).toBe(100);
    expect(body.claude_cost_30d).toBe(10);
    // (100 − 10) / 100 = 0.9 → 90.0%
    expect(body.gross_margin_pct).toBe(90.0);
  });

  it('gross margin is 0 when there is no revenue (no NaN/Infinity)', async () => {
    fakeFetch({
      claudeRows: [{ est_cost_usd: 5, cache_hit: false }],
    });
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(body.mrr_usd).toBe(0);
    expect(body.gross_margin_pct).toBe(0);
  });

  it('reports signup → paid conversion %', async () => {
    fakeFetch({
      planCounts: { free: 90, professional: 10 },
      totalSignups: 100,
    });
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(body.active_paid_users).toBe(10);
    expect(body.conversion_pct).toBe(10);
  });

  it('returns plan_prices + cac_notice in the assumptions block', async () => {
    fakeFetch({});
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(body.assumptions.plan_prices).toEqual({
      professional: 25,
      business:     50,
      enterprise:  125,
    });
    expect(typeof body.assumptions.cac_notice).toBe('string');
    expect(body.cac_usd).toBeNull();
  });

  it('attaches generated_at as a parseable ISO timestamp', async () => {
    fakeFetch({});
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(typeof body.generated_at).toBe('string');
    expect(new Date(body.generated_at).toString()).not.toBe('Invalid Date');
  });

  it('E3: returns signups_daily from the RPC', async () => {
    fakeFetch({
      signupsDaily: [
        { day: '2026-05-30', n: 2 },
        { day: '2026-05-31', n: 5 },
      ],
    });
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(body.signups_daily).toHaveLength(2);
    expect(body.signups_daily[1]).toEqual({ day: '2026-05-31', n: 5 });
  });

  it('E3: degrades to [] when the signups_by_day RPC is absent (not yet migrated)', async () => {
    fakeFetch({ signupsDaily: null }); // RPC 500
    const res = await handleAdminFinancials(ownerAuth(), baseEnv());
    expect(res.status).toBe(200);   // endpoint still works
    expect((await res.json()).signups_daily).toEqual([]);
  });

  it('D2: returns activation {eligible, activated, pct} from the RPC', async () => {
    fakeFetch({ activation: { eligible: 100, activated: 42, pct: 42.0 } });
    const body = await (await handleAdminFinancials(ownerAuth(), baseEnv())).json();
    expect(body.activation).toEqual({ eligible: 100, activated: 42, pct: 42 });
  });

  it('D2: degrades to null when activation_rate RPC is absent', async () => {
    fakeFetch({ activation: null }); // RPC 500
    const res = await handleAdminFinancials(ownerAuth(), baseEnv());
    expect(res.status).toBe(200);
    expect((await res.json()).activation).toBeNull();
  });
});
