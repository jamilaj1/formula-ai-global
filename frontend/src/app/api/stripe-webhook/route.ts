import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Stripe webhook handler:
// - Verifies the signature using STRIPE_WEBHOOK_SECRET (set in Stripe Dashboard
//   when you add the endpoint).
// - On checkout.session.completed / customer.subscription.created/updated/deleted,
//   updates the user's plan in the Supabase `profiles` table.
//
// Required env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// SUPABASE_SERVICE_KEY (for server-side writes), NEXT_PUBLIC_SUPABASE_URL.

interface StripeEvent {
  id: string
  type: string
  data: { object: Record<string, unknown> }
}

interface StripeLike {
  webhooks: {
    constructEvent: (body: string | Buffer, sig: string, secret: string) => StripeEvent
  }
  subscriptions: {
    retrieve: (id: string) => Promise<{ items: { data: Array<{ price: { id: string } }> }; status: string }>
  }
}

async function loadStripe(secret: string): Promise<StripeLike | null> {
  try {
    const mod = (await import(/* webpackIgnore: true */ 'stripe' as string)) as {
      default: new (key: string) => StripeLike
    }
    return new mod.default(secret)
  } catch {
    return null
  }
}

// Map Stripe Price ID -> internal plan id.
function planForPrice(priceId: string): string {
  if (priceId === process.env.STRIPE_PRICE_PROFESSIONAL) return 'professional'
  if (priceId === process.env.STRIPE_PRICE_BUSINESS) return 'business'
  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) return 'enterprise'
  return 'starter'
}

async function updateUserPlan(email: string | undefined, plan: string) {
  if (!email) return
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return
  // Use REST API directly; we don't want to depend on supabase-js for the
  // service-role operation that needs to bypass RLS.
  await fetch(`${url}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ plan }),
  })
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_SECRET_KEY
  const whsec = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !whsec) {
    return NextResponse.json({ error: 'Stripe webhook not configured' }, { status: 501 })
  }

  const sig = request.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const stripe = await loadStripe(secret)
  if (!stripe) return NextResponse.json({ error: 'stripe package not installed' }, { status: 501 })

  const raw = await request.text()
  let event: StripeEvent
  try {
    event = stripe.webhooks.constructEvent(raw, sig, whsec)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid signature'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as {
          customer_email?: string
          subscription?: string
        }
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription)
          const priceId = sub.items.data[0]?.price.id || ''
          await updateUserPlan(session.customer_email, planForPrice(priceId))
        }
        break
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as {
          status: string
          items: { data: Array<{ price: { id: string } }> }
          customer_email?: string
        }
        const priceId = sub.items.data[0]?.price.id || ''
        const plan = sub.status === 'active' ? planForPrice(priceId) : 'starter'
        await updateUserPlan(sub.customer_email, plan)
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as { customer_email?: string }
        await updateUserPlan(sub.customer_email, 'starter')
        break
      }
    }
  } catch (err: unknown) {
    console.error('Webhook handler error:', err)
    // Don't 500 — Stripe will retry. Acknowledge and let the next event resync.
  }

  return NextResponse.json({ received: true })
}
