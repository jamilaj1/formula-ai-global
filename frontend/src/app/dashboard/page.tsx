'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { Zap, Search, Book, History as HistoryIcon, Upload as UploadIcon, LogIn } from 'lucide-react'

export default function DashboardPage() {
  const { t } = useLanguage()
  const { isDark } = useTheme()
  const [searches, setSearches] = useState<number | null>(null)
  const [books, setBooks] = useState<number | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState<boolean>(false)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!isSupabaseConfigured) return
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) return
      if (mounted) {
        setSignedIn(true)
        setName((userData.user.user_metadata?.full_name as string) || userData.user.email || null)
      }
      const [{ count: sc }, { count: bc }] = await Promise.all([
        supabase.from('search_history').select('*', { count: 'exact', head: true }).eq('user_id', userData.user.id),
        supabase.from('uploaded_books').select('*', { count: 'exact', head: true }).eq('user_id', userData.user.id),
      ])
      if (!mounted) return
      setSearches(sc ?? 0)
      setBooks(bc ?? 0)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const stats = [
    { icon: Zap, label: 'Available Formulas', value: '200,000+', color: 'text-green-400' },
    { icon: Search, label: 'Your Searches', value: searches !== null ? String(searches) : '-', color: 'text-blue-400' },
    { icon: Book, label: 'Books Processed', value: books !== null ? String(books) : '-', color: 'text-purple-400' },
    { icon: Zap, label: 'Plan', value: 'Starter', color: 'text-yellow-400' },
  ]

  const tile = isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-white hover:bg-gray-50 border border-gray-200'
  const card = isDark ? 'bg-white/5' : 'bg-white border border-gray-200'

  return (
    <div className={`min-h-screen p-8 ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-6xl mx-auto">
        <h1 className={`text-3xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {t('welcome')}{name ? `, ${name}` : ''}
        </h1>
        <p className={`mb-8 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          Your formulation workspace
        </p>

        {!signedIn && (
          <div className={`rounded-xl p-4 mb-6 flex items-center gap-3 ${card}`}>
            <LogIn className="w-5 h-5 text-green-500" />
            <div className={`flex-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              Sign in to track your searches and save formulas.
            </div>
            <Link href="/login" className="bg-green-500 text-gray-900 px-4 py-2 rounded-lg font-bold hover:bg-green-400">
              {t('login')}
            </Link>
            <Link
              href="/register"
              className={`px-4 py-2 rounded-lg ${isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              Sign up
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map(({ icon: Icon, label, value, color }) => (
            <div key={label} className={`rounded-xl p-6 ${card}`}>
              <Icon className={`w-8 h-8 ${color} mb-3`} />
              <div className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>{value}</div>
              <div className={isDark ? 'text-gray-400' : 'text-gray-600'}>{label}</div>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <Link href="/search" className={`rounded-xl p-8 transition-colors ${tile}`}>
            <Search className="w-10 h-10 text-green-400 mb-4" />
            <h3 className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('search')}</h3>
            <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>Search 200,000+ formulas</p>
          </Link>
          <Link href="/upload" className={`rounded-xl p-8 transition-colors ${tile}`}>
            <UploadIcon className="w-10 h-10 text-blue-400 mb-4" />
            <h3 className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('upload_book')}</h3>
            <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>Upload a PDF book to extract formulas</p>
          </Link>
          <Link href="/history" className={`rounded-xl p-8 transition-colors ${tile}`}>
            <HistoryIcon className="w-10 h-10 text-purple-400 mb-4" />
            <h3 className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('history')}</h3>
            <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>Your past searches</p>
          </Link>
        </div>
      </div>
    </div>
  )
}
