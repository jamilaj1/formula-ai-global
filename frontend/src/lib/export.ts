// =============================================================================
// Formula export helpers
// - Plain text (.txt)
// - CSV (.csv) — opens in Excel and any spreadsheet app
// - Excel via XML SpreadsheetML (.xls) — no library needed
// - Print-friendly window for PDF via browser "Save as PDF"
// =============================================================================

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(content: string, filename = 'formula.txt') {
  // Prepend BOM so Excel detects UTF-8 (Arabic, Chinese, etc.)
  const blob = new Blob(['﻿' + content], { type: 'text/plain;charset=utf-8' })
  triggerDownload(blob, filename)
}

// Try to parse a markdown table out of the AI response. Falls back to a
// single-column CSV if no table is detected.
function parseTable(text: string): string[][] {
  const lines = text.split(/\r?\n/)
  const tableLines = lines.filter((l) => /\|/.test(l) && !/^[\s|:-]+$/.test(l))
  if (tableLines.length >= 2) {
    return tableLines.map((line) =>
      line
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((c) => c.trim())
    )
  }
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => [l])
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function downloadCSV(text: string, filename = 'formula.csv') {
  const rows = parseTable(text)
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  triggerDownload(blob, filename)
}

// Excel via SpreadsheetML 2003 — works in Excel, LibreOffice, Numbers, Sheets.
// No npm dependency required.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function downloadExcel(text: string, filename = 'formula.xls') {
  const rows = parseTable(text)
  const xmlRows = rows
    .map(
      (row) =>
        `<Row>${row
          .map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`)
          .join('')}</Row>`
    )
    .join('')
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Formula">
    <Table>${xmlRows}</Table>
  </Worksheet>
</Workbook>`
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' })
  triggerDownload(blob, filename)
}

// Open a clean print window so the user can "Save as PDF" via the browser dialog.
export function printFormula(text: string, title = 'Formula') {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(title)}</title>
    <style>
      body{font-family:Segoe UI,system-ui,sans-serif;line-height:1.7;padding:32px;max-width:780px;margin:auto}
      h1{font-size:22px;border-bottom:2px solid #10b981;padding-bottom:8px}
      pre{white-space:pre-wrap;font-family:inherit;font-size:14px}
      table{border-collapse:collapse;width:100%;margin:16px 0}
      th,td{border:1px solid #cbd5e1;padding:8px 12px;text-align:left}
      th{background:#f1f5f9}
    </style></head><body>
    <h1>${escapeXml(title)}</h1>
    <pre>${escapeXml(text)}</pre>
    <script>setTimeout(()=>window.print(),250)</script>
  </body></html>`)
  w.document.close()
}
