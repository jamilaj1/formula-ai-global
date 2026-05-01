'use client'
import React, { useState } from 'react'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Download, Copy, Check, FileSpreadsheet, FileText } from 'lucide-react'

interface Component {
  name: string
  name_en?: string
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
    downloadFile(csv, 'formula.csv', 'text/csv')
  }

  const exportExcel = () => {
    let html = '<table><tr><th>Component</th><th>Percentage</th><th>CAS Number</th><th>Function</th></tr>'
    parsedComponents.forEach(c => {
      html += `<tr><td>${c.name}</td><td>${c.percentage}</td><td>${c.cas_number || ''}</td><td>${c.function || ''}</td></tr>`
    })
    html += '</table>'
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

  const fullText = rawText || ''

  return (
    <div className="space-y-4">
      {parsedComponents.length > 0 && (
        <>
          <div className={`rounded-2xl overflow-hidden border ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? 'bg-gray-800' : 'bg-gray-100'}>
                  <th className={`text-left py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('components')}</th>
                  <th className={`text-right py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('percentage')}</th>
                  <th className={`text-right py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('cas_number')}</th>
                  <th className={`text-right py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('function')}</th>
                </tr>
              </thead>
              <tbody>
                {parsedComponents.map((comp, idx) => (
                  <tr key={idx} className={`border-t ${isDark ? 'border-gray-700 hover:bg-gray-800/50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <td className={`py-3 px-4 font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {comp.name}
                      {comp.name_en && comp.name_en !== comp.name && (
                        <br /><span className={isDark ? 'text-gray-500' : 'text-gray-400'}>{comp.name_en}</span>
                      )}
                    </td>
                    <td className={`py-3 px-4 text-right font-mono ${isDark ? 'text-green-400' : 'text-green-600'}`}>{comp.percentage}</td>
                    <td className={`py-3 px-4 text-right font-mono text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{comp.cas_number || '—'}</td>
                    <td className={`py-3 px-4 text-right text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{comp.function || '—'}</td>
                  </tr>
                ))}
                <tr className={`border-t ${isDark ? 'border-gray-600' : 'border-gray-300'} font-bold`}>
                  <td className={`py-3 px-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>Total</td>
                  <td className={`py-3 px-4 text-right font-mono ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                    {calculateTotal(parsedComponents)}%
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={exportCSV}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20`}>
              <FileSpreadsheet className="w-4 h-4" /> CSV
            </button>
            <button onClick={exportExcel}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20`}>
              <FileText className="w-4 h-4" /> Excel
            </button>
            <button onClick={() => copyToClipboard(fullText)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : t('share')}
            </button>
          </div>
        </>
      )}

      <details className={`rounded-xl p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
        <summary className={`cursor-pointer font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          📝 Full Details
        </summary>
        <pre className={`mt-4 whitespace-pre-wrap font-sans leading-7 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          {fullText}
        </pre>
      </details>
    </div>
  )
}

function parseComponents(text: string): Component[] {
  const components: Component[] = []
  const lines = text.split('\n')
  let inTable = false

  for (const line of lines) {
    if (line.includes('|') && (line.includes('%') || line.includes('CAS') || line.includes('Function'))) {
      inTable = true
      continue
    }
    if (inTable && line.includes('|')) {
      const parts = line.split('|').map(p => p.trim()).filter(p => p)
      if (parts.length >= 2) {
        const name = parts[0].replace(/\*\*/g, '').trim()
        const percentage = parts.length > 1 ? parts[1].replace(/\*\*/g, '').trim() : ''
        const cas = parts.length > 2 ? parts[2].replace(/\*\*/g, '').trim() : ''
        const func = parts.length > 3 ? parts[3].replace(/\*\*/g, '').trim() : ''

        if (name && !name.includes('---') && !name.includes('Ingredient') && !name.includes('Component')) {
          components.push({ name, percentage, cas_number: cas, function: func })
        }
      }
    }
  }

  if (components.length === 0) {
    for (const line of lines) {
      const match = line.match(/(.+?)\s+(\d+\.?\d*%)\s*(\d{2,5}-\d{2}-\d)?\s*(.*)/)
      if (match) {
        components.push({
          name: match[1].trim(),
          percentage: match[2],
          cas_number: match[3] || '',
          function: match[4]?.trim() || ''
        })
      }
    }
  }

  return components
}

function calculateTotal(components: Component[]): string {
  let total = 0
  for (const c of components) {
    const pct = parseFloat(c.percentage?.replace('%', ''))
    if (!isNaN(pct)) total += pct
  }
  return total.toFixed(2)
}