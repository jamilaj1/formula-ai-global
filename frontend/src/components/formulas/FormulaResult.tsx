'use client'
import React, { useState } from 'react'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Copy, Check, FileSpreadsheet, FileText } from 'lucide-react'

interface Component {
  name: string
  percentage: string
  cas_number?: string
  function?: string
}

interface FormulaResultProps {
  rawText: string
}

export default function FormulaResult({ rawText }: FormulaResultProps) {
  const { t } = useLanguage()
  const { isDark } = useTheme()
  const [copied, setCopied] = useState(false)
  const [showFull, setShowFull] = useState(false)

  const parsedComponents = parseComponents(rawText)

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const exportCSV = () => {
    let csv = 'Component,Percentage,CAS Number,Function\n'
    parsedComponents.forEach(c => {
      csv += `"${c.name}","${c.percentage}","${c.cas_number || ''}","${c.function || ''}"\n`
    })
    downloadFile('\uFEFF' + csv, 'formula.csv', 'text/csv;charset=utf-8')
  }

  const exportExcel = () => {
    let html = `<html><body><table border="1"><tr><th>Component</th><th>Percentage</th><th>CAS Number</th><th>Function</th></tr>`
    parsedComponents.forEach(c => {
      html += `<tr><td>${c.name}</td><td>${c.percentage}</td><td>${c.cas_number || ''}</td><td>${c.function || ''}</td></tr>`
    })
    html += '</table></body></html>'
    downloadFile(html, 'formula.xls', 'application/vnd.ms-excel')
  }

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {parsedComponents.length > 0 && (
        <>
          <div className={`rounded-2xl overflow-hidden border ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? 'bg-gray-800' : 'bg-gray-100'}>
                  <th className={`text-left py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('components')}</th>
                  <th className={`text-center py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`} style={{width: '100px'}}>%</th>
                  <th className={`text-center py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`} style={{width: '130px'}}>CAS</th>
                  <th className={`text-left py-3 px-4 font-bold hidden md:table-cell ${isDark ? 'text-white' : 'text-gray-900'}`}>Function</th>
                </tr>
              </thead>
              <tbody>
                {parsedComponents.map((comp, idx) => (
                  <tr key={idx} className={`border-t ${isDark ? 'border-gray-700 hover:bg-gray-800/50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <td className={`py-2.5 px-4 font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{comp.name}</td>
                    <td className={`py-2.5 px-4 text-center font-mono font-bold ${isDark ? 'text-green-400' : 'text-green-600'}`}>{comp.percentage}</td>
                    <td className={`py-2.5 px-4 text-center font-mono text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{comp.cas_number || '—'}</td>
                    <td className={`py-2.5 px-4 text-xs hidden md:table-cell ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{comp.function || '—'}</td>
                  </tr>
                ))}
                <tr className={`border-t-2 ${isDark ? 'border-gray-600' : 'border-gray-300'} font-bold`}>
                  <td className={`py-3 px-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>Total</td>
                  <td className={`py-3 px-4 text-center font-mono ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                    {calculateTotal(parsedComponents)}%
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={exportCSV}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20">
              <FileSpreadsheet className="w-4 h-4" /> CSV
            </button>
            <button onClick={exportExcel}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20">
              <FileText className="w-4 h-4" /> Excel
            </button>
            <button onClick={() => copyToClipboard(rawText)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </>
      )}

      <div className={`rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
        <button
          onClick={() => setShowFull(!showFull)}
          className={`w-full text-left p-4 font-medium cursor-pointer ${isDark ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'}`}>
          📝 {showFull ? 'Hide' : 'Show'} Full Details
        </button>
        {showFull && (
          <pre className={`px-4 pb-4 whitespace-pre-wrap font-sans leading-7 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            {rawText}
          </pre>
        )}
      </div>
    </div>
  )
}

function parseComponents(text: string): Component[] {
  const components: Component[] = []
  const lines = text.split('\n')
  let inTable = false
  let headerFound = false
  let separatorFound = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) continue

    // Detect table header (must contain | and one of these keywords)
    if (trimmed.includes('|') && !inTable) {
      const lower = trimmed.toLowerCase()
      if (lower.includes('ingredient') || lower.includes('component') || lower.includes('المكون') ||
          (lower.includes('%') && lower.includes('cas')) || lower.includes('function')) {
        inTable = true
        headerFound = true
        continue
      }
    }

    // Skip separator line (|---|---|)
    if (inTable && !separatorFound && trimmed.match(/^\|[\s\-:|]+\|$/)) {
      separatorFound = true
      continue
    }

    // Parse data rows
    if (inTable && separatorFound && trimmed.includes('|')) {
      const parts = trimmed.split('|').map(p => p.replace(/\*\*/g, '').trim()).filter(p => p)

      if (parts.length >= 2) {
        const comp: Component = { name: '', percentage: '', cas_number: '', function: '' }

        // Find which column has the percentage
        let pctIdx = -1
        let casIdx = -1
        let nameIdx = -1
        let funcIdx = -1

        parts.forEach((part, i) => {
          if (part.match(/^\d+\.?\d*\s*%$/)) pctIdx = i
          else if (part.match(/^\d{2,7}-\d{2,7}-\d$/)) casIdx = i
          else if (part.match(/^\d+\.?\d*\s*g$/)) { /* skip grams column */ }
          else if (nameIdx === -1 && i !== pctIdx && i !== casIdx) nameIdx = i
        })

        if (pctIdx === -1) {
          // Check if any part contains percentage
          parts.forEach((part, i) => {
            if (part.match(/\d+\.?\d*\s*%/)) pctIdx = i
          })
        }

        // Skip rows without percentage
        if (pctIdx === -1) continue

        // Skip summary/total rows
        const firstPart = parts[0].toLowerCase()
        if (firstPart.includes('total') || firstPart.includes('المجموع') || firstPart.includes('totaal')) continue

        // Skip rows that look like section headers (all caps, no number)
        if (parts.length <= 2 && !parts[0].match(/\d/)) continue

        comp.percentage = parts[pctIdx]
        comp.name = nameIdx !== -1 ? parts[nameIdx] : parts[0]
        comp.cas_number = casIdx !== -1 ? parts[casIdx] : (parts.length > 2 ? parts[parts.length - 2] : '')
        comp.function = funcIdx !== -1 ? parts[funcIdx] : (parts.length > 3 ? parts[parts.length - 1] : '')

        // Clean up - remove grams column if mistaken
        if (comp.cas_number?.match(/^\d+\.?\d*\s*g$/)) comp.cas_number = ''

        // Only add if name doesn't look like a header
        if (comp.name.length > 2 && !comp.name.includes('---') && !comp.name.match(/^step/i)) {
          components.push(comp)
        }
      }
    }

    // End table detection
    if (inTable && !trimmed.includes('|') && components.length > 0) {
      inTable = false
    }
  }

  return components
}

function calculateTotal(components: Component[]): string {
  let total = 0
  for (const c of components) {
    const pct = parseFloat(c.percentage?.replace('%', '').replace(',', '.'))
    if (!isNaN(pct)) total += pct
  }
  return total.toFixed(2)
}