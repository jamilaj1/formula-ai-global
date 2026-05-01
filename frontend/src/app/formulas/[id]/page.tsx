'use client'
import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { ArrowLeft, Printer, Copy, Check, Clock } from 'lucide-react'

type Row = {
  id: string
  query: string
  language: string
  result: string
  created_at: string
}

export default function FormulaDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { isDark } = useTheme()
  const { t } = useLanguage()
  const [row, setRow] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!isSupabaseConfigured) {
        if (mounted) {
          setError('Supabase is not configured')
          setLoading(false)
        }
        return
      }
      const { data, error: dbError } = await supabase
        .from('search_history')
        .select('id, query, language, result, created_at')
        .eq('id', params.id)
        .single()
      if (!mounted) return
      if (dbError) setError(dbError.message)
      else setRow(data as Row)
      setLoading(false)
    }
    if (params.id) load()
    return () => {
      mounted = false
    }
  }, [params.id])

  const copyAll = async () => {
    if (!row) return
    await navigator.clipboard.writeText(row.result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const print = () => window.print()

  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const heading = isDark ? 'text-white' : 'text-gray-900'
  const sub = isDark ? 'text-gray-400' : 'text-gray-600'
  const card = isDark ? 'bg-white/5 border border-white/5' : 'bg-white border border-gray-200 shadow-sm'
  const btn = isDark
    ? 'bg-white/10 text-gray-200 hover:bg-white/20'
    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'

  return (
    <div className={`min-h-screen p-4 md:p-8 ${bg} print:bg-white print:p-0`}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6 print:hidden">
          <button onClick={() => router.back()} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${btn}`}>
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          {row && (
            <div className="flex gap-2">
              <button onClick={copyAll} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${btn}`}>
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={print} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${btn}`}>
                <Printer className="w-4 h-4" /> {t('print')}
              </button>
            </div>
          )}
        </div>

        {loading && <div className={sub}>Loading...</div>}

        {!loading && error && (
          <div className="bg-red-500/10 text-red-400 p-4 rounded-xl">
            <div className="font-semibold mb-1">Could not load formula</div>
            <div className="text-sm">{error}</div>
            <Link href="/search" className="inline-block mt-3 text-green-500 hover:underline text-sm">
              Try a new search
            </Link>
          </div>
        )}

        {!loading && row && (
          <article className={`rounded-2xl p-6 md:p-8 ${card} print:shadow-none print:border-0`}>
            <h1 className={`text-2xl md:text-3xl font-bold mb-2 ${heading}`}>{row.query}</h1>
            <div className={`text-sm flex items-center gap-2 mb-6 ${sub}`}>
              <Clock className="w-4 h-4" />
              {new Date(row.created_at).toLocaleString()}
              <span className="opacity-70">- {row.language}</span>
            </div>
            <div className="formula-card !bg-transparent !border-0 !p-0">
              <pre className="table-result">{row.result}</pre>
            </div>
          </article>
        )}
      </div>
    </div>
  )
}
