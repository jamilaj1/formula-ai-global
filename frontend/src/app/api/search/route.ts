import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('query') || ''
  return NextResponse.json({ results: 'Search results for: "' + query + '" - AI Brain will process this query.' })
}
