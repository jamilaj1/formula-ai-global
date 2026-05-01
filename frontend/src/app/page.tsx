'use client'
import React from 'react'
import Link from 'next/link'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { Globe, Beaker, Shield, Zap } from 'lucide-react'

export default function HomePage() {
  const { t } = useLanguage()

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
      <div className="max-w-6xl mx-auto px-4 py-20 text-center">
        <h1 className="text-5xl md:text-7xl font-bold text-white mb-6">
          {t('welcome')} to <span className="text-green-400">Formula AI</span>
        </h1>
        <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto">
          World's First AI-Powered Chemical Formulation Platform
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
          <StatsCard icon={Globe} value="195" label="Countries" />
          <StatsCard icon={Beaker} value="200K+" label="Formulas" />
          <StatsCard icon={Shield} value="40" label="Industries" />
          <StatsCard icon={Zap} value="AI" label="Powered" />
        </div>
        <div className="flex gap-4 justify-center">
          <Link href="/search" className="bg-green-500 text-gray-900 px-8 py-4 rounded-xl text-lg font-bold hover:bg-green-400">
            {t('search')}
          </Link>
          <Link href="/pricing" className="bg-white/10 text-white px-8 py-4 rounded-xl text-lg font-bold hover:bg-white/20">
            {t('pricing')}
          </Link>
        </div>
      </div>
    </main>
  )
}

function StatsCard({ icon: Icon, value, label }: { icon: any, value: string, label: string }) {
  return (
    <div className="bg-white/10 rounded-xl p-6">
      <Icon className="w-8 h-8 text-green-400 mx-auto mb-2" />
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
    </div>
  )
}