'use client'
import React, { useEffect, useState } from 'react'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { Search, Copy, Check, FileText, Bookmark, BookmarkCheck } from 'lucide-react'

async function getUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data } = await supabase.auth.getUser()
    return data.user?.id || null
  } catch {
    return null
  }
}

async function saveToHistory(query: string, language: string, result: string): Promise<string | null> {
  const userId = await getUserId()
  if (!userId) return null
  try {
    const { data } = await supabase
      .from('search_history')
      .insert({ user_id: userId, query, language, result })
      .select('id')
      .single()
    return (data?.id as string) || null
  } catch {
    return null
  }
}

async function saveFormula(name: string, result: string, sourceId: string | null): Promise<boolean> {
  const userId = await getUserId()
  if (!userId) return false
  try {
    const { error } = await supabase.from('saved_formulas').insert({
      user_id: userId,
      name,
      notes: result,
      source_search_id: sourceId,
    })
    return !error
  } catch {
    return false
  }
}

export default function SearchPage() {
  const { t, language } = useLanguage()
  const { isDark } = useTheme()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    getUserId().then((id) => setSignedIn(!!id))
  }, [])

  const runSearch = async (q: string) => {
    if (!q.trim()) return
    setLoading(true)
    setResult('')
    setHistoryId(null)
    setBookmarked(false)
    try {
      const res = await fetch(`/api/brain?query=${encodeURIComponent(q)}&language=${language}`)
      const data = await res.json()
      const text = data.result || data.error || 'No results'
      setResult(text)
      if (data.result) {
        const id = await saveToHistory(q, language, text)
        setHistoryId(id)
      }
    } catch {
      setResult('Search failed.')
    }
    setLoading(false)
  }

  const handleSearch = () => runSearch(query)

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

  const onBookmark = async () => {
    if (bookmarked) return
    const ok = await saveFormula(query, result, historyId)
    if (ok) setBookmarked(true)
  }

  const suggestions = ['Shampoo', 'Liquid Soap', 'Disinfectant', 'Floor Cleaner', 'Car Shampoo', 'Hand Sanitizer', 'Dish Soap', 'Glass Cleaner']
  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const inputBg = isDark ? 'bg-white/10 text-white border-white/10' : 'bg-white text-gray-900 border-gray-200'
  const btn = isDark
    ? 'bg-white/10 text-gray-300 hover:bg-white/20'
    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'

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
            <div className="flex flex-wrap gap-2">
              <button onClick={copyAll} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${btn}`}>
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={saveAsText}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20">
                <FileText className="w-4 h-4" /> Save as text
              </button>
              {signedIn && (
                <button
                  onClick={onBookmark}
                  disabled={bookmarked}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                    bookmarked
                      ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                      : 'bg-emerald-500 text-gray-900 hover:bg-emerald-400'
                  }`}
                >
                  {bookmarked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                  {bookmarked ? t('save') + 'd' : t('save') + ' to library'}
                </button>
              )}
            </div>
          </div>
        )}

        {!result && !loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {suggestions.map(s => (
              <button key={s} onClick={() => { setQuery(s); runSearch(s) }}
                className={`rounded-xl p-4 text-center text-sm transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>{s}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
