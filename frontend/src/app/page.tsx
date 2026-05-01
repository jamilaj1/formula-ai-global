'use client'
import React from 'react'
import Link from 'next/link'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Globe, Beaker, Factory, Zap } from 'lucide-react'

export default function HomePage() {
  const { t } = useLanguage()
  const { isDark } = useTheme()

  const stats = [
    { icon: Globe, value: '195', label: t('countries') },
    { icon: Beaker, value: '200K+', label: t('formulas_count') },
    { icon: Factory, value: '40', label: t('industries') },
    { icon: Zap, value: 'AI', label: t('ai_powered') },
  ]

  const bg = isDark
    ? 'bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900'
    : 'bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50'
  const heading = isDark ? 'text-white' : 'text-gray-900'
  const sub = isDark ? 'text-gray-300' : 'text-gray-700'
  const card = isDark ? 'bg-white/10' : 'bg-white border border-gray-200 shadow-sm'
  const cardValue = isDark ? 'text-white' : 'text-gray-900'
  const cardLabel = isDark ? 'text-gray-400' : 'text-gray-600'
  const secondaryBtn = isDark
    ? 'bg-white/10 text-white hover:bg-white/20'
    : 'bg-gray-900/5 text-gray-900 hover:bg-gray-900/10'

  return (
    <main className={`min-h-screen ${bg}`}>
      <div className="max-w-6xl mx-auto px-4 py-20 text-center">
        <h1 className={`text-5xl md:text-7xl font-bold mb-6 ${heading}`}>
          {t('welcome')} <span className="text-green-500">Formula AI</span>
        </h1>
        <p className={`text-xl mb-8 max-w-3xl mx-auto ${sub}`}>
          {t('search_placeholder')}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
          {stats.map(({ icon: Icon, value, label }) => (
            <div key={label} className={`rounded-xl p-6 ${card}`}>
              <Icon className="w-8 h-8 text-green-500 mx-auto mb-2" />
              <div className={`text-2xl font-bold ${cardValue}`}>{value}</div>
              <div className={`text-sm ${cardLabel}`}>{label}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 justify-center">
          <Link href="/search" className="bg-green-500 text-gray-900 px-8 py-4 rounded-xl text-lg font-bold hover:bg-green-400">
            {t('try_search')}
          </Link>
          <Link href="/pricing" className={`px-8 py-4 rounded-xl text-lg font-bold ${secondaryBtn}`}>
            {t('view_plans')}
          </Link>
        </div>
      </div>
    </main>
  )
}
