'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { History as HistoryIcon, Clock, Trash2 } from 'lucide-react'

type SearchRow = {
  id: string
  query: string
  language: string
  result: string
  created_at: string
}

export default function HistoryPage() {
  const { isDark } = useTheme()
  const { t } = useLanguage()
  const [rows, setRows] = useState<SearchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!isSupabaseConfigured) {
        if (mounted) {
          setSignedIn(false)
          setLoading(false)
        }
        return
      }
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        if (mounted) {
          setSignedIn(false)
          setLoading(false)
        }
        return
      }
      if (mounted) setSignedIn(true)

      const { data, error: dbError } = await supabase
        .from('search_history')
        .select('id, query, language, result, created_at')
        .eq('user_id', userData.user.id)
        .order('created_at', { ascending: false })
        .limit(50)

      if (!mounted) return
      if (dbError) setError(dbError.message)
      else setRows((data as SearchRow[]) || [])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const remove = async (id: string) => {
    const { error: dbError } = await supabase.from('search_history').delete().eq('id', id)
    if (!dbError) setRows((r) => r.filter((x) => x.id !== id))
  }

  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const heading = isDark ? 'text-white' : 'text-gray-900'
  const sub = isDark ? 'text-gray-400' : 'text-gray-600'
  const card = isDark ? 'bg-white/5 border border-white/5' : 'bg-white border border-gray-200 shadow-sm'

  return (
    <div className={`min-h-screen p-4 md:p-8 ${bg}`}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <HistoryIcon className="w-8 h-8 text-green-500" />
          <h1 className={`text-3xl font-bold ${heading}`}>{t('history')}</h1>
        </div>

        {loading && <div className={sub}>Loading...</div>}

        {!loading && signedIn === false && (
          <div className={`rounded-2xl p-8 text-center ${card}`}>
            <p className={`mb-4 ${sub}`}>Please sign in to see your search history.</p>
            <Link
              href="/login"
              className="inline-block bg-green-500 text-gray-900 px-6 py-3 rounded-xl font-bold hover:bg-green-400"
            >
              {t('login')}
            </Link>
          </div>
        )}

        {!loading && signedIn && error && (
          <div className="bg-red-500/10 text-red-400 p-4 rounded-xl">
            {error}
            <div className={`text-sm mt-2 ${sub}`}>
              Make sure the <code>search_history</code> table exists. See <code>database/schema.sql</code>.
            </div>
          </div>
        )}

        {!loading && signedIn && !error && rows.length === 0 && (
          <div className={`rounded-2xl p-8 text-center ${card}`}>
            <p className={sub}>No searches yet.</p>
            <Link
              href="/search"
              className="inline-block mt-4 bg-green-500 text-gray-900 px-6 py-3 rounded-xl font-bold hover:bg-green-400"
            >
              {t('try_search')}
            </Link>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className={`rounded-xl p-4 ${card}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className={`font-semibold truncate ${heading}`}>{r.query}</div>
                    <div className={`text-xs flex items-center gap-2 mt-1 ${sub}`}>
                      <Clock className="w-3 h-3" />
                      {new Date(r.created_at).toLocaleString()}
                      <span className="opacity-60">- {r.language}</span>
                    </div>
                    <p className={`text-sm mt-2 line-clamp-2 ${sub}`}>
                      {r.result?.slice(0, 200)}
                    </p>
                  </div>
                  <button
                    onClick={() => remove(r.id)}
                    className={`p-2 rounded-lg ${isDark ? 'text-gray-400 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100'}`}
                    aria-label="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
