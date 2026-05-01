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
  "Sodium Hydroxide: 100% Sodium Hydroxide" — glossary entry for ONE chemical
  "Carmoisine: 100% Carmoisine" — single-chemical encyclopedia entry
  Any entry with only 1 or 2 ingredients
  Any entry where the only ingredient is 100% of itself

For each REAL formula return a JSON object:
  - name: descriptive name
  - category: e.g. "spray paint", "shampoo"
  - components: array of { name, percentage, cas_number, function } — MUST have >= 3 items
  - notes: warnings or process notes

Output ONLY a JSON array. No prose. No markdown fences.
If no real formulas exist in this chunk, output: []

BE PERMISSIVE about percentage totals — books often omit minor ingredients
or use "qs to 100%". Extract anything with 3+ different ingredients combining
into one product.`

// IMPORTANT: keep total processing under Vercel's 300s timeout
// pdf-parse on a 700-page PDF can take 30-60s alone. Be conservative:
// 12 chunks × ~6s = 72s + pdf-parse ~60s = ~132s. Plenty of margin.
// Larger books should be split client-side before upload.
const MAX_CHARS_PER_CHUNK = 60_000
const MAX_CHUNKS = 12

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

function isRealFormula(f: Formula): boolean {
  const components = f.components || []
  if (components.length < 3) return false

  const pcts = components.map((c) => {
    const raw = String(c.percentage || '').replace(/[%\s]/g, '')
    const num = parseFloat(raw)
    return isFinite(num) ? num : 0
  })

  const max = Math.max(...pcts, 0)
  if (max >= 99.5 && components.length < 5) return false

  const unique = new Set(pcts.map((p) => p.toFixed(1)))
  if (unique.size === 1) return false

  return true
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function processChunk(chunk: string, language: string, attempt = 0): Promise<Formula[]> {
  try {
    // Anthropic (Claude) does this task ~2x better than Llama on Groq.
    // Falls back to Groq automatically if Anthropic key missing or errors.
    const out = await generate({
      system: `${SYSTEM_PROMPT}\nThe user prefers responses in: ${language}.`,
      user: `Extract every multi-ingredient formula from this text:\n\n${chunk}`,
      maxTokens: 4096,
      temperature: 0.1,
      preferredProvider: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'groq',
    })
    return extractFormulas(out.text)
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const isRateLimit =
      errMsg.includes('rate_limit') ||
      errMsg.includes('429') ||
      errMsg.includes('overloaded') ||
      errMsg.includes('Rate limit')
    if (isRateLimit && attempt < 2) {
      await sleep(3000 * Math.pow(2, attempt))
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
      { success: false, error: 'No AI provider configured.' },
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

  // Hard time budget: stop processing chunks before Vercel kills us
  const startTime = Date.now()
  const TIME_BUDGET_MS = 250_000 // 4 min 10s — leaves 50s safety margin

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
        { success: false, error: 'Could not extract text from PDF (image-only PDF?).' },
        { status: 422 }
      )
    }

    const allChunks = splitText(fullText, MAX_CHARS_PER_CHUNK)
    const chunks = allChunks.slice(0, MAX_CHUNKS)
    const allFormulas: Formula[] = []
    let rawCount = 0
    let chunksDone = 0
    let chunksFailed = 0
    let lastError = ''
    let stoppedEarly = false

    const minMsBetweenCalls = 800

    for (let i = 0; i < chunks.length; i++) {
      // Time-budget check: if we're running out, stop and return partial results
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        stoppedEarly = true
        break
      }

      try {
        const formulas = await processChunk(chunks[i], language)
        rawCount += formulas.length
        const valid = formulas.filter(isRealFormula)
        allFormulas.push(...valid)
        chunksDone += 1
      } catch (err) {
        chunksFailed += 1
        lastError = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)
        console.error(`Chunk ${i + 1} failed:`, err)
      }

      if (i < chunks.length - 1) await sleep(minMsBetweenCalls)
    }

    const deduped = dedupeFormulas(allFormulas)

    if (chunksDone === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `All chunks failed. Last error: ${lastError || 'unknown'}`,
        },
        { status: 502 }
      )
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      size: file.size,
      pages,
      total_chunks: allChunks.length,
      chunks_processed: chunksDone,
      chunks_failed: chunksFailed,
      stopped_early: stoppedEarly,
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
