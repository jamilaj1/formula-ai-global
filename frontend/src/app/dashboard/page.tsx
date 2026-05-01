'use client'
import React from 'react'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Zap, Search, Book } from 'lucide-react'
import Link from 'next/link'

export default function DashboardPage() {
  const { t } = useLanguage()
  const { isDark } = useTheme()

  const stats = [
    { icon: Zap, label: 'Available Formulas', value: '200,000+', color: 'text-green-400' },
    { icon: Search, label: 'Searches Today', value: '1,247', color: 'text-blue-400' },
    { icon: Book, label: 'Books Processed', value: '12', color: 'text-purple-400' },
    { icon: Zap, label: 'Active Users', value: '3,892', color: 'text-yellow-400' },
  ]

  return (
    <div className={`min-h-screen p-8 ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-6xl mx-auto">
        <h1 className={`text-3xl font-bold mb-8 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('welcome')} 👋</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map(({ icon: Icon, label, value, color }) => (
            <div key={label} className={`rounded-xl p-6 ${isDark ? 'bg-white/5' : 'bg-white border border-gray-200'}`}>
              <Icon className={`w-8 h-8 ${color} mb-3`} />
              <div className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>{value}</div>
              <div className={isDark ? 'text-gray-400' : 'text-gray-600'}>{label}</div>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <Link href="/search" className={`rounded-xl p-8 transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-white hover:bg-gray-50 border border-gray-200'}`}>
            <Search className="w-10 h-10 text-green-400 mb-4" />
            <h3 className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('search')}</h3>
            <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>Search 200,000+ formulas</p>
          </Link>
          <Link href="/upload" className={`rounded-xl p-8 transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10' : 'bg-white hover:bg-gray-50 border border-gray-200'}`}>
            <Book className="w-10 h-10 text-blue-400 mb-4" />
            <h3 className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('upload_book')}</h3>
            <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>Upload a PDF book to extract formulas</p>
          </Link>
        </div>
      </div>
    </div>
  )
}