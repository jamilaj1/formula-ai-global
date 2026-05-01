import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min — books can have many chunks

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `You are an expert chemical formulator. You receive a chunk of
text from a chemistry / cosmetics / cleaning-products book. Extract EVERY complete
chemical formula it contains.

For each formula return a JSON object with:
- name: short formula name in English
- category: e.g. "shampoo", "disinfectant", "floor cleaner", "aerosol spray"
- components: array of { name, percentage, cas_number, function }
- notes: any important warnings or process notes

Rules:
- Only return formulas that are actually present in the source. Do not invent.
- A formula is "complete" if it has at least 2 ingredients with percentages.
- Use real CAS Registry Numbers when known.
- Output ONLY a JSON array. No prose. No markdown fences. No explanation.
- If no complete formulas exist in this chunk, output an empty array: []`

const RATE_LIMIT_TPM = 400_000 // safety margin under 450K limit
const MAX_CHARS_PER_CHUNK = 60_000 // ~15K input tokens per chunk
const MAX_CHUNKS = 30 // hard cap so we don't run forever

type Component = { name?: string; percentage?: string; cas_number?: string; function?: string }
type Formula = {
  name?: string
  category?: string
  components?: Component[]
  notes?: string
}

// Split text into chunks at paragraph boundaries when possible
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

// Extract a JSON array from Claude's response (be lenient)
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

// Sleep helper for retry/backoff
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Call Claude with auto-retry on rate limit (429)
async function callClaude(
  anthropic: Anthropic,
  chunk: string,
  language: string,
  attempt = 0
): Promise<Formula[]> {
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0.1,
      system: `${SYSTEM_PROMPT}\nThe user prefers responses in: ${language}.`,
      messages: [{ role: 'user', content: `Extract every complete chemical formula:\n\n${chunk}` }],
    })
    const firstBlock = message.content[0]
    const text = firstBlock && firstBlock.type === 'text' ? firstBlock.text : ''
    return extractFormulas(text)
  } catch (err: unknown) {
    // Retry on rate limit (max 4 attempts, exponential backoff)
    const errMsg = err instanceof Error ? err.message : String(err)
    const isRateLimit =
      errMsg.includes('rate_limit') || errMsg.includes('429') || errMsg.includes('overloaded')
    if (isRateLimit && attempt < 4) {
      const waitMs = Math.min(60_000, 5_000 * Math.pow(2, attempt)) // 5s, 10s, 20s, 40s
      await sleep(waitMs)
      return callClaude(anthropic, chunk, language, attempt + 1)
    }
    throw err
  }
}

// Deduplicate formulas by lowercased name + first component
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
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { success: false, error: 'ANTHROPIC_API_KEY not configured on server' },
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
    // 1. Extract text from PDF (much smaller than sending raw PDF to Claude)
    const arrayBuf = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)

    // pdf-parse is CommonJS, use dynamic import
    const pdfParseModule = await import('pdf-parse')
    const pdfParse = (pdfParseModule as { default?: unknown }).default || pdfParseModule
    const pdfData = await (pdfParse as (b: Buffer) => Promise<{ text: string; numpages: number }>)(buffer)

    const fullText = pdfData.text || ''
    const pages = pdfData.numpages || 0

    if (fullText.length < 200) {
      return NextResponse.json({
        success: false,
        error: 'Could not extract text from PDF (image-only PDF?). Try a different file.',
      }, { status: 422 })
    }

    // 2. Split into chunks Claude can handle (and stay under rate limit)
    const chunks = splitText(fullText, MAX_CHARS_PER_CHUNK).slice(0, MAX_CHUNKS)

    // 3. Process each chunk with auto-retry; pace requests to stay under TPM
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const allFormulas: Formula[] = []
    const charsPerToken = 4
    const minMsBetweenCalls = Math.ceil(
      (MAX_CHARS_PER_CHUNK / charsPerToken) * (60_000 / RATE_LIMIT_TPM)
    )

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      try {
        const formulas = await callClaude(anthropic, chunk, language)
        allFormulas.push(...formulas)
      } catch (err) {
        console.error(`Chunk ${i + 1}/${chunks.length} failed:`, err)
        // Continue with remaining chunks even if one fails
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
      formulas: deduped,
    })
  } catch (error: unknown) {
    console.error('Upload error:', error)
    const msg = error instanceof Error ? error.message : 'Extraction failed'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
