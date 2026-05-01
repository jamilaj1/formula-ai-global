'use client'
import React, { useState } from 'react'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Copy, Check, FileSpreadsheet, FileText, ChevronDown, ChevronUp } from 'lucide-react'

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
  const total = calculateTotal(parsedComponents)
  const totalColor = Math.abs(parseFloat(total) - 100) < 2 ? 'text-green-400' : 'text-yellow-400'

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
    let html = `<html><head><meta charset="UTF-8"></head><body><table border="1"><tr><th>Component</th><th>Percentage</th><th>CAS Number</th><th>Function</th></tr>`
    parsedComponents.forEach(c => {
      html += `<tr><td>${c.name}</td><td>${c.percentage}</td><td>${c.cas_number || ''}</td><td>${c.function || ''}</td></tr>`
    })
    html += `<tr><th>Total</th><th>${total}%</th><th></th><th></th></tr>`
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

  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const cardBg = isDark ? 'bg-gray-800/50' : 'bg-white'
  const textColor = isDark ? 'text-white' : 'text-gray-900'
  const subColor = isDark ? 'text-gray-400' : 'text-gray-500'
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200'

  return (
    <div className="space-y-4">
      {parsedComponents.length > 0 && (
        <>
          <div className={`rounded-2xl overflow-hidden border ${borderColor} ${cardBg}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={isDark ? 'bg-gray-700/50' : 'bg-gray-100'}>
                    <th className={`text-left py-3 px-4 font-bold ${textColor}`}>Component</th>
                    <th className={`text-center py-3 px-4 font-bold ${textColor}`} style={{width: '90px'}}>%</th>
                    <th className={`text-center py-3 px-4 font-bold hidden sm:table-cell ${textColor}`} style={{width: '130px'}}>CAS Number</th>
                    <th className={`text-left py-3 px-4 font-bold hidden lg:table-cell ${textColor}`}>Function</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedComponents.map((comp, idx) => (
                    <tr key={idx} className={`border-t ${borderColor} ${isDark ? 'hover:bg-gray-700/30' : 'hover:bg-gray-50'}`}>
                      <td className={`py-2.5 px-4 font-medium ${textColor}`}>{comp.name}</td>
                      <td className={`py-2.5 px-4 text-center font-mono font-bold ${isDark ? 'text-green-400' : 'text-green-600'}`}>{comp.percentage}</td>
                      <td className={`py-2.5 px-4 text-center font-mono text-xs hidden sm:table-cell ${subColor}`}>{comp.cas_number || '—'}</td>
                      <td className={`py-2.5 px-4 text-xs hidden lg:table-cell ${subColor}`}>{comp.function || '—'}</td>
                    </tr>
                  ))}
                  <tr className={`border-t-2 ${isDark ? 'border-gray-500' : 'border-gray-300'} font-bold`}>
                    <td className={`py-3 px-4 ${textColor}`}>Total</td>
                    <td className={`py-3 px-4 text-center font-mono text-lg ${totalColor}`}>{total}%</td>
                    <td className="hidden sm:table-cell"></td>
                    <td className="hidden lg:table-cell"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={exportCSV}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors">
              <FileSpreadsheet className="w-4 h-4" /> CSV
            </button>
            <button onClick={exportExcel}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">
              <FileText className="w-4 h-4" /> Excel
            </button>
            <button onClick={() => copyToClipboard(rawText)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy All'}
            </button>
          </div>
        </>
      )}

      <button onClick={() => setShowFull(!showFull)}
        className={`w-full flex items-center justify-between p-4 rounded-xl text-sm font-medium transition-colors ${isDark ? 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10' : 'bg-gray-100 text-gray-600 hover:text-gray-900 hover:bg-gray-200'}`}>
        <span>📝 {showFull ? 'Hide Full Details' : 'Show Full Details (Mixing Steps, Safety, etc.)'}</span>
        {showFull ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {showFull && (
        <div className={`rounded-xl p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <pre className={`whitespace-pre-wrap font-sans leading-7 text-sm ${subColor}`}>{rawText}</pre>
        </div>
      )}
    </div>
  )
}

// [بقية الدوال المساعدة نفسها بدون تغيير]
function parseComponents(text: string): Component[] {
  const components: Component[] = []
  const lines = text.split('\n')
  let inTable = false
  let separatorFound = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { if (inTable && components.length > 0) inTable = false; continue }

    if (trimmed.includes('|') && !inTable) {
      const lower = trimmed.toLowerCase()
      if (lower.includes('ingredient') || lower.includes('component') || lower.includes('المكون') || (lower.includes('%') && lower.includes('cas')) || lower.includes('function')) {
        inTable = true; continue
      }
    }

    if (inTable && !separatorFound && trimmed.match(/^\|[\s\-:|]+\|$/)) { separatorFound = true; continue }

    if (inTable && separatorFound && trimmed.includes('|')) {
      const parts = trimmed.split('|').map(p => p.replace(/\*\*/g, '').trim()).filter(p => p)
      if (parts.length < 2) continue

      let pctIdx = -1
      parts.forEach((part, i) => { if (part.match(/^\d+\.?\d*\s*%$/)) pctIdx = i })
      if (pctIdx === -1) { parts.forEach((part, i) => { if (!pctIdx && part.match(/\d+\.?\d*\s*%/)) pctIdx = i }) }
      if (pctIdx === -1) continue

      const firstPart = parts[0].toLowerCase()
      if (firstPart.includes('total') || firstPart.includes('المجموع')) continue
      if (parts.length <= 2 && !parts[0].match(/\d/)) continue

      const comp: Component = { name: parts[0], percentage: parts[pctIdx], cas_number: '', function: '' }
      if (parts.length > 2) comp.cas_number = parts[2]
      if (parts.length > 3) comp.function = parts[3]
      if (comp.cas_number?.match(/^\d+\.?\d*\s*g$/)) comp.cas_number = ''

      if (comp.name.length > 2 && !comp.name.includes('---') && !comp.name.match(/^step/i)) {
        components.push(comp)
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