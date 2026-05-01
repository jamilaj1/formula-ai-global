import { NextResponse } from 'next/server'
import { generate, availableProvider } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min

const SYSTEM_PROMPT = `You are an expert chemical formulator extracting REAL FORMULATIONS
(multi-ingredient recipes) from a book chunk. The book may also contain a glossary,
an index of raw materials, a bibliography, and a table of contents — IGNORE those.

A VALID FORMULA has ALL of these properties:
  1. THREE OR MORE different ingredients (a single-chemical entry is NOT a formula)
  2. Percentages that VARY — they must NOT all be 100%
  3. Percentages of all listed ingredients should sum to roughly 100%
  4. A clear product name (e.g. "White Spray Paint", "Anti-Dandruff Shampoo")
  5. The ingredients are intentionally mixed together to make ONE end product

You MUST REJECT and NOT extract any of these:
  - Glossary / encyclopedia entries that describe ONE chemical (e.g. "Sodium Hydroxide:
    100% Sodium Hydroxide CAS 1310-73-2" is an entry, NOT a formula — REJECT)
  - Lists of raw materials with their CAS numbers but no recipe
  - Any "formula" with only 1 or 2 ingredients
  - Any "formula" where the only ingredient is 100%
  - Tables of contents, indexes, or bibliographies
  - Definitions of single chemicals or product types

For each VALID formula, return a JSON object with:
  - name: short formula name in English (e.g. "White Spray Paint - Industrial Grade")
  - category: e.g. "shampoo", "disinfectant", "spray paint", "floor cleaner"
  - components: array of { name, percentage, cas_number, function } — MUST have >= 3 items
  - notes: any important warnings or process notes

Output ONLY a JSON array. No prose. No markdown fences. No explanation.
If no valid formulas exist in this chunk, output: []`

const MAX_CHARS_PER_CHUNK = 40_000 // smaller chunks = better extraction
const MAX_CHUNKS = 60 // cover ~1000-page books

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

// Strict client-side validation: reject anything that doesn't look like a real formula
function isRealFormula(f: Formula): boolean {
  const components = f.components || []
  if (components.length < 3) return false

  // Parse percentages, treating missing/invalid as 0
  const pcts = components.map((c) => {
    const raw = String(c.percentage || '').replace(/[%\s]/g, '')
    const num = parseFloat(raw)
    return isFinite(num) ? num : 0
  })

  // Reject if ANY single ingredient is 100% (that's a glossary entry)
  if (pcts.some((p) => p >= 99.5)) return false

  // Total should be roughly 100% (allow 50-150% tolerance for rounding/missing data)
  const total = pcts.reduce((s, n) => s + n, 0)
  if (total < 50 || total > 150) return false

  // Need at least 3 ingredients with valid percentages
  const validCount = pcts.filter((p) => p > 0 && p < 100).length
  if (validCount < 3) return false

  return true
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function processChunk(chunk: string, language: string, attempt = 0): Promise<Formula[]> {
  try {
    const out = await generate({
      system: `${SYSTEM_PROMPT}\nThe user prefers responses in: ${language}.`,
      user: `Extract every REAL multi-ingredient formula from this text:\n\n${chunk}`,
      maxTokens: 4096,
      temperature: 0.1,
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
      return processChunk(chunk, language, attempt + 1)
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
        {
          success: false,
          error: 'Could not extract text from PDF (image-only PDF?). Try a different file.',
        },
        { status: 422 }
      )
    }

    const chunks = splitText(fullText, MAX_CHARS_PER_CHUNK).slice(0, MAX_CHUNKS)
    const allFormulas: Formula[] = []
    let rawCount = 0

    // Groq: 30 RPM = one call every 2s. Pace at 2.5s for safety.
    const minMsBetweenCalls = 2500

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      try {
        const formulas = await processChunk(chunk, language)
        rawCount += formulas.length
        // Strict client-side filter: only keep real multi-ingredient formulas
        const valid = formulas.filter(isRealFormula)
        allFormulas.push(...valid)
      } catch (err) {
        console.error(`Chunk ${i + 1}/${chunks.length} failed:`, err)
      }
      if (i < chunks.length - 1) await sleep(minMsBetweenCalls)
    }

    const deduped = dedupeFormulas(allFormulas)

    return NextResponse.json({
      success: true,
      filename: file.name,
      size: file.size,
      pages,
      chunks_processed: chunks.length,
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
