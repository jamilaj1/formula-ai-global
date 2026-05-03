import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Component = {
  name: string
  cas_number: string
  percentage: number
  function: string
}

type Formula = {
  name: string
  category: string
  components: Component[]
  notes: string
}

// Parse a single CSV line, handling quoted strings with commas inside.
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result.map((s) => s.trim())
}

// Group rows by formula_name (column 0) into Formula objects.
function csvToFormulas(csv: string): { formulas: Formula[]; warnings: string[] } {
  const warnings: string[] = []
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) {
    return { formulas: [], warnings: ['File is empty or has only headers'] }
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'))
  const idx = (key: string) => header.indexOf(key)
  const required = ['formula_name', 'component_name', 'percentage']
  for (const req of required) {
    if (idx(req) === -1) {
      warnings.push(`Missing required column: ${req}`)
    }
  }
  if (warnings.length > 0) return { formulas: [], warnings }

  const formulasMap = new Map<string, Formula>()
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i])
    const name = (row[idx('formula_name')] || '').trim()
    if (!name) continue

    const componentName = (row[idx('component_name')] || '').trim()
    const pctRaw = (row[idx('percentage')] || '').replace(/[%\s]/g, '')
    const pct = parseFloat(pctRaw)

    if (!componentName || !isFinite(pct)) {
      warnings.push(`Row ${i + 1}: skipped (missing component or percentage)`)
      continue
    }

    let formula = formulasMap.get(name)
    if (!formula) {
      formula = {
        name,
        category: idx('category') >= 0 ? (row[idx('category')] || '').trim() : '',
        notes: idx('notes') >= 0 ? (row[idx('notes')] || '').trim() : '',
        components: [],
      }
      formulasMap.set(name, formula)
    }
    formula.components.push({
      name: componentName,
      cas_number: idx('cas_number') >= 0 ? (row[idx('cas_number')] || '').trim() : '',
      percentage: pct,
      function: idx('function') >= 0 ? (row[idx('function')] || '').trim() : '',
    })
    // Use the latest non-empty notes/category seen for this formula
    if (idx('notes') >= 0 && row[idx('notes')]?.trim()) formula.notes = row[idx('notes')].trim()
    if (idx('category') >= 0 && row[idx('category')]?.trim()) formula.category = row[idx('category')].trim()
  }

  return { formulas: Array.from(formulasMap.values()), warnings }
}

function formulaToMarkdown(f: Formula): string {
  const lines: string[] = []
  lines.push(`# ${f.name}`)
  if (f.category) lines.push(`*Category: ${f.category}*`)
  lines.push('')
  lines.push('| # | Component | CAS Number | % | Function |')
  lines.push('|---|---|---|---|---|')
  f.components.forEach((c, i) => {
    lines.push(`| ${i + 1} | ${c.name} | ${c.cas_number} | ${c.percentage} | ${c.function} |`)
  })
  if (f.notes) {
    lines.push('')
    lines.push(`**Notes:** ${f.notes}`)
  }
  return lines.join('\n')
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const userId = formData.get('user_id') as string

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 })
  }
  if (!userId) {
    return NextResponse.json({ success: false, error: 'user_id required' }, { status: 400 })
  }

  const text = await file.text()
  const { formulas, warnings } = csvToFormulas(text)

  if (formulas.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'No valid formulas found in the file',
        warnings,
      },
      { status: 422 }
    )
  }

  const supabase = createClient(url, key)
  let saved = 0
  const errors: string[] = []
  for (const f of formulas) {
    try {
      const { error } = await supabase.from('saved_formulas').insert({
        user_id: userId,
        name: f.name,
        category: f.category || null,
        components: f.components,
        notes: formulaToMarkdown(f),
      })
      if (error) {
        errors.push(`${f.name}: ${error.message}`)
      } else {
        saved += 1
      }
    } catch (err) {
      errors.push(`${f.name}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  return NextResponse.json({
    success: saved > 0,
    parsed: formulas.length,
    saved,
    failed: formulas.length - saved,
    warnings,
    errors: errors.slice(0, 10),
  })
}
