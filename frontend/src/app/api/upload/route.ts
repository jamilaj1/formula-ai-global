import { NextResponse } from 'next/server'
import { generate, availableProvider } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SYSTEM_PROMPT = `You are an expert chemical formulator extracting MULTI-INGREDIENT
RECIPES (formulas) from a book chunk. The book may contain a glossary that
describes single chemicals — IGNORE the glossary; you ONLY want recipes.

A FORMULA is a list of 3+ ingredients with percentages that combine into one product.
Examples of valid formulas:
  "White Spray Paint": Alkyd Resin 25%, Titanium Dioxide 20%, Toluene 33%, Xylene 10%, ...
  "Anti-Dandruff Shampoo": Water 70%, SLES 15%, CAPB 5%, Climbazole 1.5%, ...

NOT a formula (REJECT these):
  "Sodium Hydroxide: 100% Sodium Hydroxide" — this is a glossary entry for ONE chemical
  "Carmoisine: 100% Carmoisine" — single-chemical encyclopedia entry
  Any entry with only 1 or 2 ingredients
  Any entry where the only ingredient is 100% of itself

For each REAL formula return a JSON object:
  - name: descriptive name (e.g. "Industrial White Spray Paint")
  - category: e.g. "spray paint", "shampoo", "disinfectant"
  - components: array of { name, percentage, cas_number, function } — MUST have >= 3 items with DIFFERENT percentages
  - notes: warnings or process notes

Output ONLY a JSON array. No prose. No markdown fences.
If no real formulas exist in this chunk, output: []

BE PERMISSIVE about percentage totals — some formulas list "qs to 100%" or
omit minor ingredients. As long as you see 3+ different ingredients combining
to make ONE product, extract it.`

const MAX_CHARS_PER_CHUNK = 40_000
const MAX_CHUNKS = 60

type Component = { name?: string; percentage?: string; cas_number?: string; function?: string }
type Formula = {
  name?: string
  category?: string
  components?: Component[]
  notes?: string
}

function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const chunks: string[] = []
  const paragraphs = text.split(/\n\s*\n/)
  let current = ''
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > maxChars && current.length > 0) {
      chunks.push(current)
      current = p
    } else {
      current = current ? current + '\n\n' + p : p
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function extractFormulas(text: string): Formula[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Keep things permissive: reject only obvious glossary entries
function isRealFormula(f: Formula): boolean {
  const components = f.components || []
  if (components.length < 3) return false

  const pcts = components.map((c) => {
    const raw = String(c.percentage || '').replace(/[%\s]/g, '')
    const num = parseFloat(raw)
    return isFinite(num) ? num : 0
  })

  // Reject only if dominant single ingredient is 99%+ AND the formula has fewer
  // than 5 components — that pattern matches glossary entries best.
  const max = Math.max(...pcts, 0)
  if (max >= 99.5 && components.length < 5) return false

  // Reject if every percentage is identical (e.g. all 100% — clearly a list)
  const unique = new Set(pcts.map((p) => p.toFixed(1)))
  if (unique.size === 1) return false

  return true
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function processChunk(
  chunk: string,
  language: string,
  preferredProvider: 'anthropic' | 'groq' | undefined,
  attempt = 0
): Promise<Formula[]> {
  try {
    const out = await generate({
      system: `${SYSTEM_PROMPT}\nThe user prefers responses in: ${language}.`,
      user: `Extract every multi-ingredient formula from this text:\n\n${chunk}`,
      maxTokens: 4096,
      temperature: 0.1,
      preferredProvider,
    })
    return extractFormulas(out.text)
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const isRateLimit =
      errMsg.includes('rate_limit') ||
      errMsg.includes('429') ||
      errMsg.includes('overloaded') ||
      errMsg.includes('Rate limit')
    if (isRateLimit && attempt < 4) {
      const waitMs = Math.min(60_000, 5_000 * Math.pow(2, attempt))
      await sleep(waitMs)
      return processChunk(chunk, language, preferredProvider, attempt + 1)
    }
    throw err
  }
}

function dedupeFormulas(formulas: Formula[]): Formula[] {
  const seen = new Set<string>()
  const out: Formula[] = []
  for (const f of formulas) {
    const key = `${(f.name || '').toLowerCase().trim()}|${f.components?.[0]?.name?.toLowerCase().trim() || ''}`
    if (key === '|') continue
    if (!seen.has(key)) {
      seen.add(key)
      out.push(f)
    }
  }
  return out
}

export async function POST(request: Request) {
  if (availableProvider() === 'none') {
    return NextResponse.json(
      { success: false, error: 'No AI provider configured. Set GROQ_API_KEY or ANTHROPIC_API_KEY.' },
      { status: 500 }
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const language = (formData.get('language') as string) || 'en'

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 })
  }
  if (file.type && file.type !== 'application/pdf') {
    return NextResponse.json({ success: false, error: 'File must be a PDF' }, { status: 400 })
  }

  const MAX_BYTES = 25 * 1024 * 1024
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { success: false, error: `File too large (>${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    )
  }

  try {
    const arrayBuf = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)

    const pdfParseModule = await import('pdf-parse')
    const pdfParse = (pdfParseModule as { default?: unknown }).default || pdfParseModule
    const pdfData = await (pdfParse as (b: Buffer) => Promise<{ text: string; numpages: number }>)(buffer)

    const fullText = pdfData.text || ''
    const pages = pdfData.numpages || 0

    if (fullText.length < 200) {
      return NextResponse.json(
        { success: false, error: 'Could not extract text from PDF (image-only PDF?). Try a different file.' },
        { status: 422 }
      )
    }

    const chunks = splitText(fullText, MAX_CHARS_PER_CHUNK).slice(0, MAX_CHUNKS)
    const allFormulas: Formula[] = []
    let rawCount = 0
    let chunksFailed = 0
    let lastError = ''

    // Try Groq first (free + fast). If a chunk fails, fall back to Anthropic.
    const minMsBetweenCalls = 2500

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      let formulas: Formula[] = []

      // First attempt: Groq (free)
      try {
        formulas = await processChunk(chunk, language, 'groq')
      } catch (err) {
        // Second attempt: Anthropic fallback
        if (process.env.ANTHROPIC_API_KEY) {
          try {
            formulas = await processChunk(chunk, language, 'anthropic')
          } catch (err2) {
            chunksFailed += 1
            lastError = err2 instanceof Error ? err2.message : String(err2)
            console.error(`Chunk ${i + 1}/${chunks.length} failed (both providers):`, err2)
          }
        } else {
          chunksFailed += 1
          lastError = err instanceof Error ? err.message : String(err)
        }
      }

      rawCount += formulas.length
      const valid = formulas.filter(isRealFormula)
      allFormulas.push(...valid)

      if (i < chunks.length - 1) await sleep(minMsBetweenCalls)
    }

    const deduped = dedupeFormulas(allFormulas)

    // If everything failed, surface an actionable error
    if (chunksFailed === chunks.length) {
      return NextResponse.json(
        {
          success: false,
          error: `All ${chunks.length} chunks failed. Last error: ${lastError.slice(0, 300)}`,
        },
        { status: 502 }
      )
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      size: file.size,
      pages,
      chunks_processed: chunks.length,
      chunks_failed: chunksFailed,
      raw_extracted: rawCount,
      filtered_out: rawCount - deduped.length,
      formulas: deduped,
    })
  } catch (error: unknown) {
    console.error('Upload error:', error)
    const msg = error instanceof Error ? error.message : 'Extraction failed'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
