import { NextResponse } from 'next/server'

export const runtime = 'edge'

function maskUrl(url: string | undefined): string {
  if (!url) return 'NOT_SET'
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
  let supabaseStatus: number | undefined
  if (supabaseUrl) {
    try {
      const headers: Record<string, string> = {}
      if (supabaseKey) {
        headers['apikey'] = supabaseKey
        headers['Authorization'] = `Bearer ${supabaseKey}`
      }
      const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
        headers,
        signal: AbortSignal.timeout(5000),
      })
      supabaseStatus = res.status
      supabaseReachable = true
    } catch (err: unknown) {
      supabaseError = err instanceof Error ? err.message : 'fetch failed'
    }
  }

  return NextResponse.json({
    status: 'ok',
    service: 'formula-ai-global',
    version: '3.2.0',
    timestamp: new Date().toISOString(),
    env: {
      groq_key_set: Boolean(process.env.GROQ_API_KEY),
      anthropic_key_set: Boolean(process.env.ANTHROPIC_API_KEY),
      ai_primary: process.env.GROQ_API_KEY
        ? 'groq (free)'
        : process.env.ANTHROPIC_API_KEY
          ? 'anthropic (paid)'
          : 'NONE',
      supabase_url: maskUrl(supabaseUrl),
      supabase_key_preview: maskKey(supabaseKey),
      supabase_reachable: supabaseReachable,
      supabase_status: supabaseStatus,
      supabase_error: supabaseError,
      stripe_set: Boolean(process.env.STRIPE_SECRET_KEY),
    },
  })
}
