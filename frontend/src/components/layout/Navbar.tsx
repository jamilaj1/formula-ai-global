'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage, LANGUAGES } from '@/components/providers/LanguageProvider'
import { useAuth } from '@/components/providers/AuthProvider'
import {
  Sun, Moon, Globe, Search, LayoutDashboard, CreditCard,
  History as HistoryIcon, Upload, LogOut, User, Beaker,
  Menu as MenuIcon, X as CloseIcon,
} from 'lucide-react'

export default function Navbar() {
  const router = useRouter()
  const { toggleTheme, isDark } = useTheme()
  const { language, setLanguage, t } = useLanguage()
  const { user, signOut } = useAuth()
  const [showLangMenu, setShowLangMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const email = user?.email || null

  const handleLogout = async () => {
    await signOut()
    setShowUserMenu(false)
    setShowMobileMenu(false)
    router.push('/')
  }
  const closeAll = () => {
    setShowLangMenu(false)
    setShowUserMenu(false)
    setShowMobileMenu(false)
  }

  const linkBase = isDark
    ? 'text-gray-300 hover:bg-gray-800 hover:text-white'
    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
  const iconBtn = isDark ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'
  const menuPanel = isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
  const menuItem = isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'

  const mainLinks = (
    <>
      <Link href="/search" onClick={closeAll} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${linkBase}`}>
        <Search className="w-4 h-4" /> {t('search')}
      </Link>
      <Link href="/upload" onClick={closeAll} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${linkBase}`}>
        <Upload className="w-4 h-4" /> {t('upload_book')}
      </Link>
      <Link href="/dashboard" onClick={closeAll} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${linkBase}`}>
        <LayoutDashboard className="w-4 h-4" /> {t('dashboard')}
      </Link>
      {email && (
        <Link href="/formulas" onClick={closeAll} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${linkBase}`}>
          <Beaker className="w-4 h-4" /> {t('my_formulas')}
        </Link>
      )}
      {email && (
        <Link href="/history" onClick={closeAll} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${linkBase}`}>
          <HistoryIcon className="w-4 h-4" /> {t('history')}
        </Link>
      )}
      <Link href="/pricing" onClick={closeAll} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${linkBase}`}>
        <CreditCard className="w-4 h-4" /> {t('pricing')}
      </Link>
    </>
  )

  return (
    <nav className={`sticky top-0 z-50 backdrop-blur-lg border-b ${
      isDark ? 'bg-gray-900/90 border-gray-800' : 'bg-white/90 border-gray-200'
    }`}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo + mobile menu toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowMobileMenu(!showMobileMenu); setShowLangMenu(false); setShowUserMenu(false) }}
              className={`md:hidden p-2 rounded-lg ${iconBtn}`}
              aria-label="Toggle navigation menu"
            >
              {showMobileMenu ? <CloseIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
            </button>
            <Link href="/" onClick={closeAll} className="flex items-center gap-2 shrink-0">
              <span className="text-2xl">🧪</span>
              <span className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Formula <span className="text-emerald-500">AI</span>
              </span>
            </Link>
          </div>

          {/* Desktop main nav */}
          <div className="hidden md:flex items-center gap-1">{mainLinks}</div>

          {/* Right side: language, theme, auth */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => { setShowLangMenu(!showLangMenu); setShowUserMenu(false); setShowMobileMenu(false) }}
                className={`flex items-center gap-1 px-2 py-2 rounded-lg text-sm ${iconBtn}`}
                aria-label="Change language"
              >
                <Globe className="w-4 h-4" />
                <span>{LANGUAGES.find((l) => l.code === language)?.flag}</span>
              </button>
              {showLangMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowLangMenu(false)} />
                  <div className={`absolute top-full right-0 mt-2 w-56 max-h-96 overflow-y-auto rounded-xl shadow-xl z-50 border ${menuPanel}`}>
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => { setLanguage(lang.code); setShowLangMenu(false) }}
                        className={`w-full flex items-center gap-2 px-4 py-2 text-sm ${
                          language === lang.code ? 'bg-emerald-500/10 text-emerald-400' : menuItem
                        }`}
                      >
                        <span>{lang.flag}</span>
                        <span>{lang.nativeName}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={toggleTheme}
              className={`p-2 rounded-lg ${
                isDark ? 'text-yellow-400 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'
              }`}
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {email ? (
              <div className="relative">
                <button
                  onClick={() => { setShowUserMenu(!showUserMenu); setShowLangMenu(false); setShowMobileMenu(false) }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${iconBtn}`}
                  aria-label="Account menu"
                >
                  <User className="w-4 h-4" />
                  <span className="hidden sm:inline max-w-[140px] truncate">{email}</span>
                </button>
                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                    <div className={`absolute top-full right-0 mt-2 w-56 rounded-xl shadow-xl z-50 overflow-hidden border ${menuPanel}`}>
                      <div className={`px-4 py-3 text-xs border-b ${
                        isDark ? 'text-gray-400 border-gray-700' : 'text-gray-500 border-gray-100'
                      }`}>
                        Signed in as
                        <div className={`mt-0.5 truncate ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>{email}</div>
                      </div>
                      <Link href="/dashboard" onClick={() => setShowUserMenu(false)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm ${menuItem}`}>
                        <LayoutDashboard className="w-4 h-4" /> {t('dashboard')}
                      </Link>
                      <Link href="/formulas" onClick={() => setShowUserMenu(false)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm ${menuItem}`}>
                        <Beaker className="w-4 h-4" /> {t('my_formulas')}
                      </Link>
                      <Link href="/history" onClick={() => setShowUserMenu(false)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm ${menuItem}`}>
                        <HistoryIcon className="w-4 h-4" /> {t('history')}
                      </Link>
                      <Link href="/settings" onClick={() => setShowUserMenu(false)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm ${menuItem}`}>
                        <User className="w-4 h-4" /> Settings
                      </Link>
                      <button onClick={handleLogout}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10">
                        <LogOut className="w-4 h-4" /> {t('logout')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link href="/login"
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600">
                  {t('login')}
                </Link>
                <Link href="/register"
                  className={`hidden sm:inline-block px-3 py-2 rounded-lg text-sm font-medium ${
                    isDark ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'
                  }`}>
                  {t('register')}
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {showMobileMenu && (
          <div className={`md:hidden border-t pb-3 pt-2 ${
            isDark ? 'border-gray-800' : 'border-gray-200'
          }`}>
            <div className="flex flex-col gap-1">{mainLinks}</div>
          </div>
        )}
      </div>
    </nav>
  )
}
