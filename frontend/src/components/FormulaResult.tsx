'use client'
import React from 'react'

// Lightweight markdown renderer optimized for the formulation responses Claude
// returns: headings, paragraphs, ordered/unordered lists, tables, bold, inline
// code. No external dependency, ~200 lines, handles RTL and CJK.

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'hr' }

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(line)
}

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Blank line
    if (!line.trim()) {
      i++
      continue
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push({ kind: 'hr' })
      i++
      continue
    }

    // Headings
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3, text: h[2].trim() })
      i++
      continue
    }

    // Tables: a line with pipes followed by a separator line
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line)
      const rows: string[][] = []
      i += 2 // skip header + separator
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push({ kind: 'table', headers, rows })
      continue
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '').trim())
        i++
      }
      blocks.push({ kind: 'list', ordered: true, items })
      continue
    }

    // Unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, '').trim())
        i++
      }
      blocks.push({ kind: 'list', ordered: false, items })
      continue
    }

    // Paragraph (until blank line or block boundary)
    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push({ kind: 'paragraph', text: para.join(' ').trim() })
  }

  return blocks
}

// Inline formatting: **bold**, *italic*, `code`, simple URLs.
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\*[^*]+\*)|(https?:\/\/\S+)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      parts.push(
        <code key={key++} className="px-1.5 py-0.5 rounded bg-black/20 dark:bg-white/10 text-emerald-400 text-[0.92em]">
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('*')) {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    } else {
      parts.push(
        <a key={key++} href={tok} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline break-all">
          {tok}
        </a>
      )
    }
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// Detect a column that probably holds a percentage or numeric value, so we
// can right-align it. We also use this to highlight the "%" cell.
function isNumericHeader(h: string): boolean {
  return /(%|percent|نسب|قدر|كمية|amount|qty|porcent|prozent|分量|百分比|pourcentage)/i.test(h)
}

export default function FormulaResult({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown)

  return (
    <div className="formula-md">
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          const cls = b.level === 1 ? 'text-2xl font-bold mt-6 mb-3'
                    : b.level === 2 ? 'text-xl font-bold mt-5 mb-2'
                    : 'text-lg font-semibold mt-4 mb-2'
          return <div key={i} className={cls}>{renderInline(b.text)}</div>
        }
        if (b.kind === 'paragraph') {
          return <p key={i} className="my-3 leading-relaxed">{renderInline(b.text)}</p>
        }
        if (b.kind === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul'
          const cls = b.ordered ? 'list-decimal pl-6 my-3 space-y-1.5' : 'list-disc pl-6 my-3 space-y-1.5'
          return (
            <Tag key={i} className={cls}>
              {b.items.map((item, j) => (
                <li key={j} className="leading-relaxed">{renderInline(item)}</li>
              ))}
            </Tag>
          )
        }
        if (b.kind === 'hr') {
          return <hr key={i} className="my-6 border-white/10 dark:border-white/10" />
        }
        // table
        const numericCols = b.headers.map(isNumericHeader)
        return (
          <div key={i} className="my-4 overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-emerald-500/10">
                  {b.headers.map((h, j) => (
                    <th key={j} className={`px-4 py-3 font-bold text-emerald-400 border-b border-emerald-500/20 ${numericCols[j] ? 'text-right' : 'text-start'}`}>
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-emerald-500/5 transition-colors">
                    {row.map((cell, ci) => (
                      <td key={ci} className={`px-4 py-2.5 border-b border-black/5 dark:border-white/5 ${numericCols[ci] ? 'text-right font-mono tabular-nums' : 'text-start'}`}>
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
