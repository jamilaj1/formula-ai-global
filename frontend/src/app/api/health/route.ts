import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'formula-ai-global',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    deps: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    },
  })
}
