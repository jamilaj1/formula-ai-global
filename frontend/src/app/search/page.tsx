'use client'
import React from 'react'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { Beaker, Book, Search, Activity, TrendingUp } from 'lucide-react'
import Link from 'next/link'

export default function DashboardPage() {
  const { t } = useLanguage()
  const stats = [
    { icon: Beaker, label: 'Available Formulas', value: '200,000+', color: 'text-green-400', bg: 'bg-green-400/10' },
    { icon: Search, label: 'Searches Today', value: '1,247', color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { icon: Book, label: 'Books Processed', value: '12', color: 'text-purple-400', bg: 'bg-purple-400/10' },
    { icon: TrendingUp, label: 'Active Users', value: '3,892', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  ]

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">{t('welcome')} 👋</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map(({ icon: Icon, label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-xl p-6`}>
              <Icon className={`w-8 h-8 ${color} mb-3`} />
              <div className="text-2xl font-bold text-white mb-1">{value}</div>
              <div className="text-gray-400 text-sm">{label}</div>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <Link href="/search" className="bg-white/5 rounded-xl p-8 hover:bg-white/10 transition-colors group">
            <Search className="w-10 h-10 text-green-400 mb-4 group-hover:scale-110 transition-transform" />
            <h3 className="text-xl font-bold text-white mb-2">{t('search')}</h3>
            <p className="text-gray-400">Search 200,000+ formulas</p>
          </Link>
          <Link href="/upload" className="bg-white/5 rounded-xl p-8 hover:bg-white/10 transition-colors group">
            <Book className="w-10 h-10 text-blue-400 mb-4 group-hover:scale-110 transition-transform" />
            <h3 className="text-xl font-bold text-white mb-2">{t('upload_book')}</h3>
            <p className="text-gray-400">Upload a PDF book to extract formulas</p>
          </Link>
        </div>
      </div>
    </div>
  )
}