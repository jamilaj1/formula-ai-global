/**
 * admin.js — owner-only financial dashboard.
 *
 * Phase 9.5: one endpoint that returns every number admin.html's
 * Financials tab needs in a single round-trip. The handler is locked
 * down to `auth.email === OWNER_EMAIL` (same gate as the rest of the
 * /be/* admin surface).
 *
 * Data sources
 * ------------
 *   profiles               → plan distribution, signup totals
 *   consultation_requests  → one-time consulting revenue (paid + delivered)
 *   api_usage              → Claude operational cost (cost of goods sold)
 *
 * Aggregation strategy
 * --------------------
 * Parallel PostgREST queries (Promise.all). Plan counts use
 * `Prefer: count=exact` and read the Content-Range header so we don't
 * pay for fetching N rows just to count them. consulting_requests and
 * api_usage are small enough today (sub-1000 rows in 30 d) that a
 * straight SELECT + JS reduce is faster than building an RPC.
 *
 * We deliberately compute everything server-side so the browser sees a
 * clean JSON and can't be tricked into mis-rendering by a fragmented
 * partial fetch.
 */
import { json } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';

const OWNER_EMAIL = 'jamilaj1@gmail.com';

// USD/month — same source of truth as worker-src/config.js's
// paystackPlanMap (which holds the same numbers in GHS pesewas). If you
// change one, change both.
const PLAN_PRICES_USD = {
  professional: 25,
  business:     50,
  enterprise:  125,
};
const PAID_PLANS = Object.keys(PLAN_PRICES_USD);
// All plan names we want to surface in the breakdown chart.
const ALL_PLANS = ['free', 'starter', ...PAID_PLANS];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ASSUMED_LIFETIME_MONTHS = 12;   // LTV proxy until we have real churn data

function parseCountFromContentRange(header) {
  if (!header) return 0;
  const tail = String(header).split('/').pop();
  const n = parseInt(tail || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

async function countWhere(env, path) {
  const r = await sbService(env, `${path}${path.includes('?') ? '&' : '?'}select=id`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  if (!r.ok) return 0;
  return parseCountFromContentRange(r.headers.get('content-range'));
}

function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round(Number(n || 0) * f) / f;
}

export async function handleAdminFinancials(auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) {
    return json({ error: 'forbidden' }, 403);
  }

  const now = Date.now();
  const since30dIso = new Date(now - 30 * MS_PER_DAY).toISOString();
  const since30dMs  = now - 30 * MS_PER_DAY;

  // ── Parallel fan-out ──────────────────────────────────────────
  const [
    planCountsArr,
    totalSignups,
    newSignups30d,
    consultRowsResp,
    claudeRowsResp,
  ] = await Promise.all([
    // Count per plan (one HEAD-style request each, parallel)
    Promise.all(ALL_PLANS.map(async (p) => [
      p,
      await countWhere(env, `/profiles?plan=eq.${encodeURIComponent(p)}`),
    ])),

    countWhere(env, '/profiles'),
    countWhere(env, `/profiles?created_at=gte.${encodeURIComponent(since30dIso)}`),

    // Consulting revenue — small enough table to pull rows + sum locally
    sbService(env, '/consultation_requests?status=in.(paid,delivered)&select=amount_usd,status,created_at'),

    // Claude operational cost — bounded to 30d so the response stays small
    sbService(env, `/api_usage?created_at=gte.${encodeURIComponent(since30dIso)}&select=est_cost_usd,cache_hit,model`),
  ]);

  // ── Plan distribution ────────────────────────────────────────
  const planDistribution = Object.fromEntries(planCountsArr);
  let mrr = 0;
  for (const p of PAID_PLANS) {
    mrr += (planDistribution[p] || 0) * PLAN_PRICES_USD[p];
  }
  const activePaidUsers =
    (planDistribution.professional || 0) +
    (planDistribution.business     || 0) +
    (planDistribution.enterprise   || 0);

  // ── Consulting revenue (paid + delivered) ───────────────────
  let consultPaid = 0;
  let consultDelivered = 0;
  let consult30d = 0;
  const consultRows = consultRowsResp.ok ? await consultRowsResp.json().catch(() => []) : [];
  for (const r of consultRows) {
    const amt = Number(r.amount_usd || 0);
    if (r.status === 'paid')      consultPaid += amt;
    if (r.status === 'delivered') consultDelivered += amt;
    if (new Date(r.created_at).getTime() >= since30dMs) consult30d += amt;
  }
  const consultTotal = consultPaid + consultDelivered;

  // ── Claude cost (cost of goods sold, last 30 d) ─────────────
  let claudeCost30d = 0;
  let claudeCalls30d = 0;
  let claudeCacheHits30d = 0;
  const claudeRows = claudeRowsResp.ok ? await claudeRowsResp.json().catch(() => []) : [];
  for (const r of claudeRows) {
    claudeCost30d += Number(r.est_cost_usd || 0);
    claudeCalls30d += 1;
    if (r.cache_hit) claudeCacheHits30d += 1;
  }

  // ── Derived metrics ─────────────────────────────────────────
  const arr        = mrr * 12;
  const revenue30d = mrr + consult30d;
  const grossMargin = revenue30d > 0 ? ((revenue30d - claudeCost30d) / revenue30d) * 100 : 0;
  const arpu        = activePaidUsers > 0 ? mrr / activePaidUsers : 0;
  // LTV proxy: ARPU × assumed lifetime. Until we wire real churn data
  // this is an honest "annual value if they stay a year" estimate.
  const ltvUsd     = arpu * ASSUMED_LIFETIME_MONTHS;
  const conversion  = totalSignups > 0 ? (activePaidUsers / totalSignups) * 100 : 0;
  const cacheHitRatio = claudeCalls30d > 0 ? (claudeCacheHits30d / claudeCalls30d) * 100 : 0;

  return json({
    ok: true,
    generated_at: new Date(now).toISOString(),
    currency: 'USD',
    assumptions: {
      plan_prices: PLAN_PRICES_USD,
      lifetime_months_for_ltv: ASSUMED_LIFETIME_MONTHS,
      cac_notice: 'CAC not tracked — wire after Phase 5 lead-gen (ad spend → leads attribution).',
    },
    plan_distribution: planDistribution,

    // Headline numbers
    mrr_usd: round(mrr, 0),
    arr_usd: round(arr, 0),
    active_paid_users: activePaidUsers,
    total_signups: totalSignups,
    new_signups_30d: newSignups30d,

    // Revenue mix (last 30 days)
    revenue_30d: {
      subscription: round(mrr, 0),     // monthly recurring
      consulting:   round(consult30d, 0),
      total:        round(revenue30d, 0),
    },

    // Lifetime consulting (since launch, paid + delivered)
    consulting_revenue: {
      paid:      round(consultPaid, 0),
      delivered: round(consultDelivered, 0),
      total:     round(consultTotal, 0),
    },

    // Cost + margin
    claude_cost_30d:  round(claudeCost30d, 2),
    claude_calls_30d: claudeCalls30d,
    claude_cache_hit_pct: round(cacheHitRatio, 1),
    gross_margin_pct: round(grossMargin, 1),

    // Unit economics
    arpu_usd:        round(arpu, 2),
    ltv_usd:         round(ltvUsd, 0),
    cac_usd:         null,                       // explicitly not tracked
    conversion_pct:  round(conversion, 2),
  });
}
