'use client'
import React, { useState } from 'react'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Download, Copy, Check, FileSpreadsheet, FileText } from 'lucide-react'

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
                  <th className={`text-right py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('percentage')}</th>
                  <th className={`text-right py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('cas_number')}</th>
                  <th className={`text-right py-3 px-4 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('function')}</th>
                </tr>
              </thead>
              <tbody>
                {parsedComponents.map((comp, idx) => (
                  <tr key={idx} className={`border-t ${isDark ? 'border-gray-700 hover:bg-gray-800/50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <td className={`py-3 px-4 font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{comp.name}</td>
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
              {copied ? 'Copied!' : t('share')}
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

  // Method 1: Markdown table parsing
  let inTable = false
  let headerSkipped = false
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // Detect table start
    if (trimmed.includes('|') && (trimmed.includes('%') || trimmed.includes('CAS') || trimmed.includes('Function'))) {
      inTable = true
      headerSkipped = false
      continue
    }
    
    // Skip separator line (|---|---|)
    if (inTable && !headerSkipped && trimmed.match(/^\|[\s\-|]+\|$/)) {
      headerSkipped = true
      continue
    }
    
    // Parse table row
    if (inTable && headerSkipped && trimmed.includes('|')) {
      const parts = trimmed.split('|').map(p => p.replace(/\*\*/g, '').trim()).filter(p => p)
      if (parts.length >= 2) {
        const comp: Component = { name: '', percentage: '', cas_number: '', function: '' }
        
        // Try different column orders
        if (parts.length === 4) {
          comp.name = parts[0]
          comp.percentage = parts[1]
          comp.cas_number = parts[2]
          comp.function = parts[3]
        } else if (parts.length === 3) {
          comp.name = parts[0]
          comp.percentage = parts[1]
          comp.cas_number = parts[2]
        } else if (parts.length === 2) {
          comp.name = parts[0]
          comp.percentage = parts[1]
        }
        
        // Skip header-like rows
        if (comp.name && !comp.name.includes('---') && !comp.name.includes('Component') && !comp.name.includes('Ingredient') && !comp.name.includes('المكون') && comp.name.length > 2) {
          // Check if has percentage
          if (comp.percentage && comp.percentage.match(/\d+\.?\d*\s*%/)) {
            components.push(comp)
          } else if (parts.length > 2 && parts[2].match(/\d+\.?\d*\s*%/)) {
            comp.percentage = parts[2]
            comp.cas_number = parts.length > 3 ? parts[1] : ''
            components.push(comp)
          }
        }
      }
    }
    
    // End of table
    if (inTable && !trimmed.includes('|') && components.length > 0) {
      inTable = false
    }
  }

  // Method 2: Percentage-pattern parsing (if no table found)
  if (components.length === 0) {
    for (const line of lines) {
      const match = line.match(/(.+?)\s+(\d+\.?\d*\s*%)\s*(\d{2,7}-\d{2,7}-\d)?\s*(.*)/)
      if (match && !match[1].includes('المجموع') && !match[1].includes('Total') && !match[1].includes('TOTAL')) {
        components.push({
          name: match[1].trim(),
          percentage: match[2].trim(),
          cas_number: match[3]?.trim() || '',
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
    const pct = parseFloat(c.percentage?.replace('%', '').replace(',', '.'))
    if (!isNaN(pct)) total += pct
  }
  return total.toFixed(2)
}