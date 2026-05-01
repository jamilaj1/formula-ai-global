'use client'
import React, { useState } from 'react'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Search } from 'lucide-react'
import FormulaResult from '@/components/formulas/FormulaResult'

export default function SearchPage() {
  const { t, language } = useLanguage()
  const { isDark } = useTheme()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true)
    setResult('')
    try {
      const res = await fetch(`/api/brain?query=${encodeURIComponent(query)}&language=${language}`)
      const data = await res.json()
      setResult(data.result || data.error || 'No results')
    } catch (err) {
      setResult('Search failed.')
    }
    setLoading(false)
  }

  const suggestions = ['Shampoo', 'Liquid Soap', 'Disinfectant', 'Floor Cleaner', 'Car Shampoo', 'Hand Sanitizer', 'Dish Soap', 'Glass Cleaner']

  return (
    <div className={`min-h-screen p-8 ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-5xl mx-auto">
        <h1 className={`text-3xl font-bold mb-8 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('search')}</h1>

        <div className="flex gap-4 mb-8">
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={t('search_placeholder')}
            className={`flex-1 p-4 rounded-xl text-lg border outline-none focus:border-green-400 ${isDark ? 'bg-white/10 text-white border-white/10' : 'bg-white text-gray-900 border-gray-200'}`} />
          <button onClick={handleSearch} disabled={loading}
            className="bg-green-500 text-white px-8 py-4 rounded-xl font-bold hover:bg-green-600 disabled:opacity-50">
            {loading ? '...' : <Search className="w-5 h-5" />}
          </button>
        </div>

        {result && <FormulaResult rawText={result} />}

        {!result && !loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {suggestions.map(s => (
              <button key={s} onClick={() => { setQuery(s); handleSearch() }}
                className={`rounded-xl p-4 text-center transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>{s}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}