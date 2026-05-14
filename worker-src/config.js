/**
 * config.js — single source of truth for plan limits and billing amounts.
 * Keep these numbers in sync with pricing.html and PROJECT_HISTORY.md.
 */

/** Anonymous (IP-keyed) daily search limit. */
export const FREE_DAILY_LIMIT = 10;

/** Default daily limit for paid plans (overridden by dailyLimitFor). */
export const PAID_DAILY_LIMIT = 100;

/**
 * Daily search limit per plan. Keep aligned with pricing.html.
 * @type {Record<string, number>}
 */
export const PLAN_DAILY_LIMITS = {
  guest: FREE_DAILY_LIMIT, // 10
  starter: FREE_DAILY_LIMIT * 2, // 20 (free signed-in)
  professional: PAID_DAILY_LIMIT, // 100
  business: PAID_DAILY_LIMIT * 5, // 500
  enterprise: 100000, // effectively unlimited
};

/**
 * Paystack subscription plans + fallback amounts (in pesewas for GHS,
 * cents for USD). Plan codes come from env. Display is in USD on the site,
 * billed in GHS via Paystack (1 USD ≈ 12 GHS, May 2026).
 *
 * @param {Record<string, string|undefined>} env
 * @returns {Record<string, {code: string|undefined, amount: number, currency: string}>}
 */
export function paystackPlanMap(env) {
  return {
    professional: { code: env.PAYSTACK_PLAN_PRO, amount: 30000, currency: 'GHS' }, // $25 ≈ GHS 300
    business: { code: env.PAYSTACK_PLAN_BIZ, amount: 60000, currency: 'GHS' }, // $50 ≈ GHS 600
    enterprise: { code: env.PAYSTACK_PLAN_ENT, amount: 150000, currency: 'GHS' }, // $125 ≈ GHS 1,500
  };
}

/**
 * Stripe price IDs keyed by plan name.
 * @param {Record<string, string|undefined>} env
 * @returns {Record<string, string|undefined>}
 */
export function stripePriceMap(env) {
  return {
    professional: env.STRIPE_PRICE_PRO,
    business: env.STRIPE_PRICE_BIZ,
    enterprise: env.STRIPE_PRICE_ENT,
  };
}

/** Resolve daily search limit for a plan name. */
export function dailyLimitFor(plan) {
  return PLAN_DAILY_LIMITS[plan] ?? FREE_DAILY_LIMIT;
}
