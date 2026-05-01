'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { Beaker, Trash2, Eye } from 'lucide-react'

type Saved = {
  id: string
  name: string
  category: string | null
  notes: string | null
  source_search_id: string | null
  created_at: string
}

export default function MyFormulasPage() {
  const { isDark } = useTheme()
  const { t } = useLanguage()
  const [rows, setRows] = useState<Saved[]>([])
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
        .from('saved_formulas')
        .select('id, name, category, notes, source_search_id, created_at')
        .eq('user_id', userData.user.id)
        .order('created_at', { ascending: false })
      if (!mounted) return
      if (dbError) setError(dbError.message)
      else setRows((data as Saved[]) || [])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const remove = async (id: string) => {
    const { error: dbError } = await supabase.from('saved_formulas').delete().eq('id', id)
    if (!dbError) setRows((r) => r.filter((x) => x.id !== id))
  }

  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const heading = isDark ? 'text-white' : 'text-gray-900'
  const sub = isDark ? 'text-gray-400' : 'text-gray-600'
  const card = isDark ? 'bg-white/5 border border-white/5' : 'bg-white border border-gray-200 shadow-sm'

  return (
    <div className={`min-h-screen p-4 md:p-8 ${bg}`}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Beaker className="w-8 h-8 text-green-500" />
          <h1 className={`text-3xl font-bold ${heading}`}>{t('my_formulas')}</h1>
        </div>

        {loading && <div className={sub}>Loading...</div>}

        {!loading && signedIn === false && (
          <div className={`rounded-2xl p-8 text-center ${card}`}>
            <p className={`mb-4 ${sub}`}>Sign in to save and revisit your favourite formulas.</p>
            <Link href="/login" className="inline-block bg-green-500 text-gray-900 px-6 py-3 rounded-xl font-bold hover:bg-green-400">
              {t('login')}
            </Link>
          </div>
        )}

        {!loading && signedIn && error && (
          <div className="bg-red-500/10 text-red-400 p-4 rounded-xl">
            {error}
            <div className={`text-sm mt-2 ${sub}`}>
              Make sure the <code>saved_formulas</code> table exists. See <code>database/schema.sql</code>.
            </div>
          </div>
        )}

        {!loading && signedIn && !error && rows.length === 0 && (
          <div className={`rounded-2xl p-8 text-center ${card}`}>
            <Beaker className={`w-16 h-16 mx-auto mb-4 ${sub}`} />
            <p className={sub}>You haven&apos;t saved any formulas yet.</p>
            <Link href="/search" className="inline-block mt-4 bg-green-500 text-gray-900 px-6 py-3 rounded-xl font-bold hover:bg-green-400">
              {t('try_search')}
            </Link>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map((r) => (
              <div key={r.id} className={`rounded-xl p-5 ${card}`}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-bold truncate ${heading}`}>{r.name}</h3>
                    {r.category && <div className={`text-xs ${sub}`}>{r.category}</div>}
                  </div>
                  <button
                    onClick={() => remove(r.id)}
                    className={`p-1.5 rounded-lg ${isDark ? 'text-gray-400 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100'}`}
                    aria-label="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {r.notes && (
                  <p className={`text-sm line-clamp-3 mb-3 ${sub}`}>{r.notes.slice(0, 200)}</p>
                )}
                <div className={`text-xs ${sub} flex items-center justify-between`}>
                  <span>{new Date(r.created_at).toLocaleDateString()}</span>
                  {r.source_search_id && (
                    <Link
                      href={`/formulas/${r.source_search_id}`}
                      className="flex items-center gap-1 text-green-500 hover:underline"
                    >
                      <Eye className="w-3 h-3" /> View
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
