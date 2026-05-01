'use client'
import React, { useState } from 'react'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Search, Copy, Check, FileText } from 'lucide-react'

export default function SearchPage() {
  const { t, language } = useLanguage()
  const { isDark } = useTheme()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [copied, setCopied] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true)
    setResult('')
    try {
      const res = await fetch(`/api/brain?query=${encodeURIComponent(query)}&language=${language}`)
      const data = await res.json()
      setResult(data.result || data.error || 'No results')
    } catch {
      setResult('Search failed.')
    }
    setLoading(false)
  }

  const copyAll = async () => {
    await navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const saveAsText = () => {
    const blob = new Blob(['﻿' + result], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'formula.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const suggestions = ['Shampoo', 'Liquid Soap', 'Disinfectant', 'Floor Cleaner', 'Car Shampoo', 'Hand Sanitizer', 'Dish Soap', 'Glass Cleaner']
  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const inputBg = isDark ? 'bg-white/10 text-white border-white/10' : 'bg-white text-gray-900 border-gray-200'

  return (
    <div className={`min-h-screen p-4 md:p-8 ${bg}`}>
      <div className="max-w-4xl mx-auto">
        <h1 className={`text-3xl font-bold mb-8 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('search')}</h1>

        <div className="flex gap-3 mb-8">
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={t('search_placeholder')}
            className={`flex-1 p-4 rounded-xl text-lg border outline-none focus:border-green-400 ${inputBg}`} />
          <button onClick={handleSearch} disabled={loading}
            className="bg-green-500 text-white px-6 py-4 rounded-xl font-bold hover:bg-green-600 disabled:opacity-50 min-w-[60px] flex items-center justify-center">
            {loading ? '...' : <Search className="w-5 h-5" />}
          </button>
        </div>

        {result && (
          <div className="space-y-4">
            <div className="formula-card">
              <pre className="table-result">{result}</pre>
            </div>
            <div className="flex gap-2">
              <button onClick={copyAll}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${isDark ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={saveAsText}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20">
                <FileText className="w-4 h-4" /> Save
              </button>
            </div>
          </div>
        )}

        {!result && !loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {suggestions.map(s => (
              <button key={s} onClick={() => { setQuery(s); handleSearch() }}
                className={`rounded-xl p-4 text-center text-sm transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>{s}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
