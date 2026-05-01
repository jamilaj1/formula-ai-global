'use client'
import React from 'react'
import Link from 'next/link'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { Globe, Beaker, Factory, Zap } from 'lucide-react'

export default function HomePage() {
  const { t } = useLanguage()

  const stats = [
    { icon: Globe, value: '195', label: t('countries') },
    { icon: Beaker, value: '200K+', label: t('formulas_count') },
    { icon: Factory, value: '40', label: t('industries') },
    { icon: Zap, value: 'AI', label: t('ai_powered') },
  ]

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
      <div className="max-w-6xl mx-auto px-4 py-20 text-center">
        <h1 className="text-5xl md:text-7xl font-bold text-white mb-6">
          {t('welcome')} <span className="text-green-400">Formula AI</span>
        </h1>
        <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto">
          {t('search_placeholder')}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
          {stats.map(({ icon: Icon, value, label }) => (
            <div key={label} className="bg-white/10 rounded-xl p-6">
              <Icon className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{value}</div>
              <div className="text-sm text-gray-400">{label}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-4 justify-center">
          <Link href="/search" className="bg-green-500 text-gray-900 px-8 py-4 rounded-xl text-lg font-bold hover:bg-green-400">
            {t('try_search')}
          </Link>
          <Link href="/pricing" className="bg-white/10 text-white px-8 py-4 rounded-xl text-lg font-bold hover:bg-white/20">
            {t('view_plans')}
          </Link>
        </div>
      </div>
    </main>
  )
}