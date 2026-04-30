import { NextResponse } from 'next/server'

const API_URL = process.env.API_URL || 'http://localhost:8080'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('query') || ''

  if (!query) {
    return NextResponse.json({ results: 'Please enter a search query' })
  }

  try {
    const response = await fetch(`${API_URL}/api/formula/search?query=${encodeURIComponent(query)}&language=en`)
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }
    const data = await response.json()
    return NextResponse.json({ results: data.result || 'No results found' })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ 
      results: '⚠️ AI Brain is starting up. Please try again in a moment.\n\nMake sure the backend is running on http://localhost:8080' 
    })
  }
}