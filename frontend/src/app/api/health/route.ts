import { NextResponse } from 'next/server'

export const runtime = 'edge'

function maskUrl(url: string | undefined): string {
  if (!url) return 'NOT_SET'
  // Show host portion only so the user can spot typos like 'ib' vs 'iv'
  try {
    const u = new URL(url)
    return u.host
  } catch {
    return 'INVALID'
  }
}

function maskKey(key: string | undefined): string {
  if (!key) return 'NOT_SET'
  if (key.length < 16) return 'TOO_SHORT'
  return `${key.slice(0, 12)}...${key.slice(-6)} (${key.length} chars)`
}

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Probe whether the Supabase URL actually resolves and responds.
  let supabaseReachable = false
  let supabaseError: string | undefined
  if (supabaseUrl) {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
        signal: AbortSignal.timeout(5000),
      })
      supabaseReachable = res.ok || res.status === 404
    } catch (err: unknown) {
      supabaseError = err instanceof Error ? err.message : 'fetch failed'
    }
  }

  return NextResponse.json({
    status: 'ok',
    service: 'formula-ai-global',
    version: '3.1.0',
    timestamp: new Date().toISOString(),
    env: {
      anthropic_key_set: Boolean(process.env.ANTHROPIC_API_KEY),
      supabase_url: maskUrl(supabaseUrl),
      supabase_key_preview: maskKey(supabaseKey),
      supabase_reachable: supabaseReachable,
      supabase_error: supabaseError,
      stripe_set: Boolean(process.env.STRIPE_SECRET_KEY),
    },
  })
}
