import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('query') || ''

  if (!query) {
    return NextResponse.json({ results: 'Please enter a search query' })
  }

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/brain?query=${encodeURIComponent(query)}&language=en`
    )
    if (!response.ok) throw new Error(`Error: ${response.status}`)
    const data = await response.json()
    return NextResponse.json({ results: data.result || 'No results found' })
  } catch (error: any) {
    console.error('Search error:', error)
    return NextResponse.json({
      results: '⚠️ ' + (error.message || 'Search failed. Please try again.')
    })
  }
}