import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Map plan id -> Stripe Price ID, configured via env.
function priceIdFor(plan: string): string | null {
  const map: Record<string, string | undefined> = {
    professional: process.env.STRIPE_PRICE_PROFESSIONAL,
    business: process.env.STRIPE_PRICE_BUSINESS,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  }
  return map[plan] || null
}

// Minimal Stripe surface we use, so we don't need @types/stripe at compile time.
// The real Stripe SDK satisfies this shape.
interface StripeLike {
  checkout: {
    sessions: {
      create: (params: Record<string, unknown>) => Promise<{ url: string | null }>
    }
  }
}

async function loadStripe(secret: string): Promise<StripeLike | null> {
  try {
    // Bracket-form import keeps TypeScript from resolving 'stripe' at build
    // time, so the project compiles even before `npm install stripe`.
    const mod = (await import(/* webpackIgnore: true */ 'stripe' as string)) as {
      default: new (key: string) => StripeLike
    }
    return new mod.default(secret)
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) {
    return NextResponse.json(
      {
        error:
          'Payments are not configured yet. Set STRIPE_SECRET_KEY and STRIPE_PRICE_* environment variables in Vercel.',
      },
      { status: 501 }
    )
  }

  let body: { plan?: string; email?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const plan = (body.plan || '').toLowerCase()
  if (plan === 'starter') {
    return NextResponse.json({ error: 'Starter plan is free, no checkout needed' }, { status: 400 })
  }
  const priceId = priceIdFor(plan)
  if (!priceId) {
    return NextResponse.json(
      { error: `No Stripe price ID configured for plan "${plan}"` },
      { status: 400 }
    )
  }

  const stripe = await loadStripe(secret)
  if (!stripe) {
    return NextResponse.json(
      {
        error:
          'The "stripe" npm package is not installed. Run `npm install stripe` in frontend/.',
      },
      { status: 501 }
    )
  }

  try {
    const origin = new URL(request.url).origin
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
      customer_email: body.email,
      allow_promotion_codes: true,
    })
    return NextResponse.json({ url: session.url })
  } catch (error: unknown) {
    console.error('Checkout error:', error)
    const msg = error instanceof Error ? error.message : 'Checkout failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
