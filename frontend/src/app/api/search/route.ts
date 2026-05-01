import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('query') || ''
  const language = searchParams.get('language') || 'en'

  if (!query) {
    return NextResponse.json({ results: 'Please enter a search query' })
  }

  try {
    const origin = new URL(request.url).origin
    const response = await fetch(
      `${origin}/api/brain?query=${encodeURIComponent(query)}&language=${language}`
    )
    if (!response.ok) throw new Error(`Error: ${response.status}`)
    const data = await response.json()
    return NextResponse.json({ results: data.result || 'No results found' })
  } catch (error: unknown) {
    console.error('Search error:', error)
    const msg = error instanceof Error ? error.message : 'Search failed. Please try again.'
    return NextResponse.json({ results: msg })
  }
}
