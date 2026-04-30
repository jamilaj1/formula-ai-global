import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
})

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('query') || ''
  const language = searchParams.get('language') || 'en'

  if (!query) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 })
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      temperature: 0.1,
      system: `You are an expert chemical formulator with 30 years of experience.
You have access to thousands of reference books and chemical databases.
The user is asking in ${language}. Respond in ${language}.

Provide:
1. Complete chemical formula with ALL components
2. EXACT percentages that sum to 100%
3. Real CAS Registry Numbers
4. Mixing procedure step by step
5. Safety warnings
6. Quality control parameters

IMPORTANT RULES:
- Percentages MUST sum to exactly 100%
- CAS numbers must be REAL (not invented)
- Never mix anionic + cationic surfactants
- Pine oil requires non-ionic emulsifiers
- NaCl has NO role in disinfectants
- NaOCl + Acid = CHLORINE GAS (FATAL)
- 80% of formulas should be affordable (use cheap materials)`,
      messages: [{ role: 'user', content: query }]
    })

    return NextResponse.json({
      success: true,
      result: (message.content[0] as any).text,
      query: query
    })
  } catch (error: any) {
    console.error('Brain error:', error)
    return NextResponse.json({
      success: false,
      error: error.message || 'Unknown error'
    }, { status: 500 })
  }
}