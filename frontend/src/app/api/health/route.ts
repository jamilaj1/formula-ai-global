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
  // We send the anon key so /auth/v1/health returns 200; even if the key is
  // wrong/missing, ANY HTTP response (200, 401, 404...) proves the host is
  // reachable — only a network/DNS error means the URL is broken.
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
      // Any HTTP response means the server is reachable.
      supabaseReachable = true
    } catch (err: unknown) {
      supabaseError = 