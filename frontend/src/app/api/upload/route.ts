import { NextResponse } from 'next/server'
import { generate, availableProvider } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min — books can have many chunks

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

const MAX_CHARS_PER_CHUNK = 50_000 // ~12K tokens, fits in Groq's 128K context comfortably
const MAX_CHUNKS = 30

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function processChunk(chunk: string, language: string, attempt = 0): Promise<Formula[]> {
  try {
    const out = await generate({
      system: `${SYSTEM_PROMPT}\nThe user prefers responses in: ${language}.`,
      user: `Extract every complete chemical formula:\n\n${chunk}`,
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
      {
        success: false,
        error:
          'No AI provider configured. Set GROQ_API_KEY (free at console.groq.com) or ANTHROPIC_API_KEY.',
      },
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
      return NextResponse.json({
        success: false,
        error: 'Could not extract text from PDF (image-only PDF?). Try a different file.',
      }, { status: 422 })
    }

    const chunks = splitText(fullText, MAX_CHARS_PER_CHUNK).slice(0, MAX_CHUNKS)
    const allFormulas: Formula[] = []

    // Groq is 30 RPM = one call every 2 seconds. Be conservative and pace 2.5s.
    const minMsBetweenCalls = 2500

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      try {
        const formulas = await processChunk(chunk, language)
        allFormulas.push(...formulas)
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
      formulas: deduped,
    })
  } catch (error: unknown) {
    console.error('Upload error:', error)
    const msg = error instanceof Error ? error.message : 'Extraction failed'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
