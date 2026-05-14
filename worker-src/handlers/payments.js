/**
 * payments.js — Paystack + Stripe checkout creation + webhook handling.
 *
 * Security-critical: webhook signature verification is enforced. Any
 * unsigned or forged request is rejected with 401 *before* parsing JSON.
 * Without this, an attacker could mint themselves an enterprise plan
 * by POSTing fake events.
 */
import { json, unauthorized, badRequest, corsHeaders } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';
import { verifyStripeSignature, verifyPaystackSignature } from '../lib/crypto.js';
import { paystackPlanMap, stripePriceMap } from '../config.js';

const PAYSTACK_API = 'https://api.paystack.co';
const STRIPE_API = 'https://api.stripe.com';

/* ─── /paystack/checkout ────────────────────────────────────────── */

export async function handlePaystackCheckout(request, auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  if (!env.PAYSTACK_SECRET_KEY) {
    return json(
      {
        error: 'paystack_not_configured',
        detail: 'Set PAYSTACK_SECRET_KEY in Worker secrets.',
      },
      503
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const planMap = paystackPlanMap(env);
  const plan = planMap[body.plan];
  if (!plan) return badRequest('unknown_plan');

  const origin = request.headers.get('Origin') || 'https://jamilformula.com';

  const payload = {
    email: auth.email,
    amount: plan.amount,
    currency: plan.currency,
    callback_url: `${origin}/dashboard.html?paystack=success`,
    metadata: {
      user_id: auth.userId,
      plan: body.plan,
      origin,
    },
  };
  if (plan.code) payload.plan = plan.code;

  const r = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    return json({ error: 'paystack_error', detail: (await r.text()).slice(0, 300) }, 500);
  }
  const data = await r.json();
  if (!data.status) {
    return json({ error: 'paystack_failed', detail: data.message || 'Unknown error' }, 500);
  }

  return json({
    url: data.data.authorization_url,
    reference: data.data.reference,
    access_code: data.data.access_code,
  });
}

/* ─── /paystack/verify ──────────────────────────────────────────── */

export async function handlePaystackVerify(url, env) {
  const reference = url.searchParams.get('reference');
  if (!reference) return badRequest('missing_reference');
  if (!env.PAYSTACK_SECRET_KEY) return json({ error: 'paystack_not_configured' }, 503);

  const r = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
  });
  if (!r.ok) return json({ error: 'verify_failed' }, 500);
  const data = await r.json();
  return json({
    success: !!data.status && data.data?.status === 'success',
    status: data.data?.status,
    amount: data.data?.amount,
    currency: data.data?.currency,
    customer_email: data.data?.customer?.email,
    paid_at: data.data?.paid_at,
  });
}

/* ─── /paystack/webhook ─────────────────────────────────────────── */

export async function handlePaystackWebhook(request, env) {
  const rawBody = await request.text();

  // Reject if secret not configured or signature missing/invalid.
  if (!env.PAYSTACK_SECRET_KEY) {
    return new Response('webhook not configured', { status: 503, headers: corsHeaders });
  }
  const signature = request.headers.get('x-paystack-signature') || '';
  const sigOk = await verifyPaystackSignature(rawBody, signature, env.PAYSTACK_SECRET_KEY);
  if (!sigOk) {
    return new Response('invalid signature', { status: 401, headers: corsHeaders });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('invalid', { status: 400, headers: corsHeaders });
  }

  const eventType = event?.event || '';
  const data = event?.data || {};

  const planNameToKey = (name) => {
    if (!name) return null;
    const n = String(name).toLowerCase();
    if (n.includes('pro')) return 'professional';
    if (n.includes('biz') || n.includes('business')) return 'business';
    if (n.includes('ent')) return 'enterprise';
    return null;
  };

  if (
    eventType === 'charge.success' ||
    eventType === 'subscription.create' ||
    eventType === 'invoice.payment_succeeded'
  ) {
    const userId = data.metadata?.user_id || data.customer?.metadata?.user_id || null;
    const plan =
      data.metadata?.plan ||
      planNameToKey(data.plan?.name) ||
      planNameToKey(data.plan_object?.name) ||
      'professional';
    if (userId) {
      await sbService(env, `/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          plan,
          paystack_customer_code: data.customer?.customer_code || null,
          paystack_subscription_code: data.subscription_code || null,
          paystack_authorization_code: data.authorization?.authorization_code || null,
          plan_renews_at: data.next_payment_date || null,
        }),
      });
    }
  }

  if (eventType === 'subscription.disable' || eventType === 'subscription.not_renew') {
    const userId = data.metadata?.user_id || null;
    if (userId) {
      await sbService(env, `/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ plan: 'starter' }),
      });
    }
  }

  return new Response('ok', { status: 200, headers: corsHeaders });
}

/* ─── /stripe/checkout ──────────────────────────────────────────── */

export async function handleStripeCheckout(request, auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'stripe_not_configured' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const priceId = stripePriceMap(env)[body.plan];
  if (!priceId) return badRequest('unknown_plan');

  const origin = request.headers.get('Origin') || 'https://jamilformula.com';
  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    customer_email: auth.email,
    'metadata[user_id]': auth.userId,
    'metadata[plan]': body.plan,
    success_url: `${origin}/dashboard.html?checkout=success`,
    cancel_url: `${origin}/pricing.html?checkout=cancel`,
  });

  const r = await fetch(`${STRIPE_API}/v1/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!r.ok) {
    return json({ error: 'stripe_error', detail: (await r.text()).slice(0, 300) }, 500);
  }
  const session = await r.json();
  return json({ url: session.url, id: session.id });
}

/* ─── /stripe/webhook ───────────────────────────────────────────── */

export async function handleStripeWebhook(request, env) {
  const body = await request.text();

  // Verify Stripe-Signature header (HMAC-SHA256 of `${timestamp}.${body}`).
  // Without this, anyone could POST a fake checkout.session.completed event
  // and upgrade themselves to enterprise without paying.
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response('webhook not configured', { status: 503, headers: corsHeaders });
  }
  const sigHeader = request.headers.get('stripe-signature') || '';
  const sigOk = await verifyStripeSignature(body, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!sigOk) {
    return new Response('invalid signature', { status: 401, headers: corsHeaders });
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('invalid', { status: 400, headers: corsHeaders });
  }

  const type = event?.type || '';
  const obj = event?.data?.object || {};

  if (type === 'checkout.session.completed' || type === 'customer.subscription.updated') {
    const userId = obj.metadata?.user_id || obj.subscription?.metadata?.user_id;
    const plan = obj.metadata?.plan || 'professional';
    if (userId) {
      await sbService(env, `/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ plan, stripe_customer_id: obj.customer || null }),
      });
    }
  }

  if (type === 'customer.subscription.deleted') {
    const userId = obj.metadata?.user_id;
    if (userId) {
      await sbService(env, `/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ plan: 'starter' }),
      });
    }
  }

  return new Response('ok', { status: 200, headers: corsHeaders });
}
