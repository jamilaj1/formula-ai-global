import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'

const SYSTEM_PROMPT = `You are an expert chemical formulator. Your task is to read a PDF
of a chemistry / cosmetics / cleaning-products book and extract EVERY complete
chemical formula it contains.

For each formula return a JSON object with:
- name: short formula name in English
- category: e.g. "shampoo", "disinfectant", "floor cleaner"
- components: array of { name, percentage, cas_number, function }
- notes: any important warnings or process notes

Rules:
- Only return formulas that are actually present in the source. Do not invent.
- Percentages should sum to ~100%. If they don't, include a note.
- Use real CAS Registry Numbers when known.
- Output a single JSON array. No prose. No markdown fences.`

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

  // 25 MB hard limit (Vercel serverless body cap is 4.5 MB by default; users hitting this
  // will need a larger plan or direct-to-storage flow, but we still validate here).
  const MAX_BYTES = 25 * 1024 * 1024
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { success: false, error: `File too large (>${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    )
  }

  try {
    const arrayBuf = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuf).toString('base64')

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      temperature: 0.1,
      system: `${SYSTEM_PROMPT}\nThe user prefers responses in: ${language}.`,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            {
              type: 'text',
              text: 'Extract every complete chemical formula in this PDF as a JSON array.',
            },
          ],
        },
      ],
    })

    const firstBlock = message.content[0]
    const text = firstBlock && firstBlock.type === 'text' ? firstBlock.text : ''

    // Try to pull the JSON array out of the response (be lenient).
    let formulas: unknown = []
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      try {
        formulas = JSON.parse(jsonMatch[0])
      } catch {
        formulas = []
      }
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      size: file.size,
      formulas,
      raw: jsonMatch ? undefined : text.slice(0, 4000),
    })
  } catch (error: unknown) {
    console.error('Upload error:', error)
    const msg = error instanceof Error ? error.message : 'Extraction failed'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
