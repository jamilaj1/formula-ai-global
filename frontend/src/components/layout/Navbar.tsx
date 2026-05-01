'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage, LANGUAGES } from '@/components/providers/LanguageProvider'
import { Sun, Moon, Globe, Search, Flask, LayoutDashboard, CreditCard } from 'lucide-react'

export default function Navbar() {
  const { theme, toggleTheme, isDark } = useTheme()
  const { language, setLanguage, t } = useLanguage()
  const [showLangMenu, setShowLangMenu] = useState(false)

  const bgClass = isDark ? 'bg-gray-900/90 border-gray-800' : 'bg-white/90 border-gray-200'
  const textClass = isDark ? 'text-gray-300' : 'text-gray-700'
  const hoverClass = isDark ? 'hover:bg-gray-800 hover:text-white' : 'hover:bg-gray-100 hover:text-gray-900'

  return (
    <nav className={`sticky top-0 z-50 backdrop-blur-lg border-b ${bgClass}`}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span className="text-2xl">🧪</span>
            <span className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Formula <span className="text-emerald-500">AI</span>
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            <Link href="/search" className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${textClass} ${hoverClass}`}>
              <Search className="w-4 h-4" /> {t('search')}
            </Link>
            <Link href="/dashboard" className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${textClass} ${hoverClass}`}>
              <LayoutDashboard className="w-4 h-4" /> {t('dashboard')}
            </Link>
            <Link href="/pricing" className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${textClass} ${hoverClass}`}>
              <CreditCard className="w-4 h-4" /> {t('pricing')}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setShowLangMenu(!showLangMenu)} className={`flex items-center gap-1 px-2 py-2 rounded-lg text-sm ${textClass} ${hoverClass}`} title={t('language')}>
                <Globe className="w-4 h-4" />
                <span>{LANGUAGES.find(l => l.code === language)?.flag}</span>
              </button>
              {showLangMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowLangMenu(false)} />
                  <div className={`absolute top-full right-0 mt-2 w-56 rounded-xl shadow-xl z-50 overflow-hidden border ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                    {LANGUAGES.map((lang) => (
                      <button key={lang.code} onClick={() => { setLanguage(lang.code); setShowLangMenu(false) }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm ${language === lang.code ? 'bg-emerald-500/10 text-emerald-400' : isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'}`}>
                        <span className="text-lg">{lang.flag}</span>
                        <span className="flex-1">{lang.nativeName}</span>
                        {language === lang.code && <span className="text-emerald-500">✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button onClick={toggleTheme} className={`p-2 rounded-lg ${textClass} ${hoverClass}`} title={isDark ? t('light_mode') : t('dark_mode')}>
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <Link href="/login" className={`px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600`}>{t('login')}</Link>
          </div>
        </div>
      </div>
    </nav>
  )
}