import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'

// Detect cost-tier signals in any of the supported languages.
// When the user explicitly asks for cheap/economy formulas we tell Claude to
// strip every non-essential ingredient.
const ECONOMY_PATTERNS = [
  /\b(cheap|cheapest|low[- ]?cost|low[- ]?price|economy|economical|budget|affordable)\b/i,
  /منخفض(\s|ال)*(التكلفة|تكلفة|السعر|السع)/,
  /اقتصاد(ي|ية|يه)/,
  /رخيص/,
  /(bon\s+marché|économique|à\s+bas\s+prix)/i,
  /(barato|económico|de\s+bajo\s+precio)/i,
  /(günstig|preiswert|billig)/i,
  /(便宜|低成本|经济|廉价)/,
  /(安価|経済的|低コスト)/,
  /(저렴|경제|저비용)/,
  /(मूल्य\s*कम|सस्ता)/,
  /(arzon|murah)/i,
]

const PREMIUM_PATTERNS = [
  /\b(premium|luxury|high[- ]?end|professional[- ]?grade|salon[- ]?grade)\b/i,
  /(فاخر|راقي|محترف|مميز|درجة\s*أولى)/,
  /(haut\s+de\s+gamme|luxe|premium)/i,
  /(de\s+lujo|premium|alta\s+gama)/i,
  /(豪华|高端|专业级|顶级)/,
  /(高級|プレミアム|サロン)/,
]

function detectCostTier(query: string): 'economy' | 'premium' | 'standard' {
  if (ECONOMY_PATTERNS.some((re) => re.test(query))) return 'economy'
  if (PREMIUM_PATTERNS.some((re) => re.test(query))) return 'premium'
  return 'standard'
}

function buildSystemPrompt(language: string, tier: 'economy' | 'premium' | 'standard'): string {
  const base = `You are an expert chemical formulator with 30 years of experience in cosmetics,
cleaning products, and industrial chemistry. The user is writing in ${language};
respond in ${language}.

Always provide:
1. A clear formula name and category
2. A markdown table with columns: # | Component | CAS Number | % | Function
3. The percentages MUST sum to exactly 100%, with WATER as the balance
4. Step-by-step mixing procedure (numbered)
5. Safety warnings (PPE, incompatibilities, fatal-mix warnings)
6. Quality control parameters (pH, viscosity, appearance)
7. Estimated cost per kg in USD (rough order of magnitude)

HARD RULES:
- Use REAL CAS Registry Numbers only (never invented)
- Never mix anionic + cationic surfactants
- NaOCl + any acid = CHLORINE GAS (FATAL) — never propose this
- NaCl has no role in disinfectants
- Pine oil requires non-ionic emulsifiers, not anionic
- Cocamide DEA is restricted in many markets — prefer Cocamide MEA or
  Cocamidopropyl Betaine`

  if (tier === 'economy') {
    return `${base}

THIS IS AN ECONOMY / LOW-COST REQUEST. The user explicitly asked for the
cheapest possible formulation. You MUST:

- Use the absolute MINIMUM number of ingredients (typically 5-7, not 10+)
- Use ONLY the cheapest commodity chemicals available globally:
  * LABSA / Sodium Lauryl Sulfate (cheap surfactants) — yes
  * Sodium Chloride (table salt) for thickening — yes
  * Citric Acid for pH — yes
  * Sodium Hydroxide for neutralization — yes
  * Water as ~70-80% of the formula — yes
- AVOID expensive ingredients in this tier:
  * Glycerin / Glycerine (premium humectant) — REMOVE unless absolutely required
  * SLES (more expensive than LABSA) — only if LABSA alone won't work
  * Cocamide DEA / MEA (premium foam booster) — REMOVE
  * Specialty preservatives (Kathon, Phenoxyethanol) — use sodium benzoate instead
  * Premium fragrances — use a generic citrus or pine fragrance at 0.1-0.2%
  * Colorants — optional, mention as "optional"
- Quote a cost in USD per kilogram and confirm it is significantly below the
  market average for that product category
- If the user is in a developing market, mention that local water quality may
  affect ingredient ratios`
  }

  if (tier === 'premium') {
    return `${base}

This is a PREMIUM / SALON-GRADE request. Use professional-grade ingredients:
- Mild surfactants (Cocamidopropyl Betaine, Decyl Glucoside, Coco Glucoside)
- Conditioning agents (Polyquaternium-7, Glycerin, Panthenol)
- Premium preservatives (Phenoxyethanol + Ethylhexylglycerin, Geogard)
- Higher cost is expected; quote it honestly`
  }

  return base
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('query') || ''
  const language = searchParams.get('language') || 'en'

  if (!query) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { success: false, error: 'ANTHROPIC_API_KEY not configured on server' },
      { status: 500 }
    )
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const tier = detectCostTier(query)

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0.1,
      system: buildSystemPrompt(language, tier),
      messages: [{ role: 'user', content: query }],
    })

    const firstBlock = message.content[0]
    const text = firstBlock && firstBlock.type === 'text' ? firstBlock.text : ''

    return NextResponse.json({ success: true, result: text, query, tier })
  } catch (error: unknown) {
    console.error('Brain error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
