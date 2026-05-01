import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Supabase redirects here with ?code=... after Google sign-in. supabase-js
// in the browser intercepts the URL automatically, so we just bounce the
// user to /dashboard. (If you ever switch to server-side cookie auth via
// @supabase/ssr, this is where you'd call exchangeCodeForSession.)
export async function GET(request: Request) {
  const url = new URL(request.url)
  const next = url.searchParams.get('next') || '/dashboard'
  return NextResponse.redirect(new URL(next, request.url))
}
