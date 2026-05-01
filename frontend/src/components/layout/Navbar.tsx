'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage, LANGUAGES } from '@/components/providers/LanguageProvider'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import {
  Sun,
  Moon,
  Globe,
  Search,
  LayoutDashboard,
  CreditCard,
  History as HistoryIcon,
  Upload,
  LogOut,
  User,
} from 'lucide-react'

export default function Navbar() {
  const router = useRouter()
  const { toggleTheme, isDark } = useTheme()
  const { language, setLanguage, t } = useLanguage()
  const [showLangMenu, setShowLangMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let mounted = true
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setEmail(data.user?.email || null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setEmail(session?.user?.email || null)
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const logout = async () => {
    await supabase.auth.signOut()
    setShowUserMenu(false)
    setEmail(null)
    router.push('/')
  }

  const linkBase = isDark
    ? 'text-gray-300 hover:bg-gray-800 hover:text-white'
    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
  const iconBtn = isDark
    ? 'text-gray-300 hover:bg-gray-800'
    : 'text-gray-700 hover:bg-gray-100'
  const menuPanel = isDark
    ? 'bg-gray-800 border-gray-700'
    : 'bg-white border-gray-200'

  return (
    <nav
      className={`sticky top-0 z-50 backdrop-blur-lg border-b ${
        isDark ? 'bg-gray-900/90 border-gray-800' : 'bg-white/90 border-gray-200'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span className="text-2xl">🧪</span>
            <span className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Formula <span className="text-emerald-500">AI</span>
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            <Link href="/search" className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${linkBase}`}>
              <Search className="w-4 h-4" /> {t('search')}
            </Link>
            <Link href="/upload" className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${linkBase}`}>
              <Upload className="w-4 h-4" /> {t('upload_book')}
            </Link>
            <Link href="/dashboard" className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${linkBase}`}>
              <LayoutDashboard className="w-4 h-4" /> {t('dashboard')}
            </Link>
            {email && (
              <Link href="/history" className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${linkBase}`}>
                <HistoryIcon className="w-4 h-4" /> {t('history')}
              </Link>
            )}
            <Link href="/pricing" className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${linkBase}`}>
              <CreditCard className="w-4 h-4" /> {t('pricing')}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            {/* Language picker */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowLangMenu(!showLangMenu)
                  setShowUserMenu(false)
                }}
                className={`flex items-center gap-1 px-2 py-2 rounded-lg text-sm ${iconBtn}`}
                aria-label="Change language"
              >
                <Globe className="w-4 h-4" />
                <span>{LANGUAGES.find((l) => l.code === language)?.flag}</span>
              </button>
              {showLangMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowLangMenu(false)} />
                  <div
                    className={`absolute top-full right-0 mt-2 w-48 rounded-xl shadow-xl z-50 overflow-hidden border ${menuPanel}`}
                  >
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          setLanguage(lang.code)
                          setShowLangMenu(false)
                        }}
                        className={`w-full flex items-center gap-2 px-4 py-2 text-sm ${
                          language === lang.code
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : isDark
                              ? 'text-gray-300 hover:bg-gray-700'
                              : 'text-gray-700 hover:bg-gray-50'
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

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className={`p-2 rounded-lg ${
                isDark ? 'text-yellow-400 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'
              }`}
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Auth area */}
            {email ? (
              <div className="relative">
                <button
                  onClick={() => {
                    setShowUserMenu(!showUserMenu)
                    setShowLangMenu(false)
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${iconBtn}`}
                >
                  <User className="w-4 h-4" />
                  <span className="hidden sm:inline max-w-[140px] truncate">{email}</span>
                </button>
                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                    <div
                      className={`absolute top-full right-0 mt-2 w-56 rounded-xl shadow-xl z-50 overflow-hidden border ${menuPanel}`}
                    >
                      <div
                        className={`px-4 py-3 text-xs border-b ${
                          isDark ? 'text-gray-400 border-gray-700' : 'text-gray-500 border-gray-100'
                        }`}
                      >
                        Signed in as
                        <div className={`mt-0.5 truncate ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>
                          {email}
                        </div>
                      </div>
                      <Link
                        href="/dashboard"
                        onClick={() => setShowUserMenu(false)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm ${
                          isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <LayoutDashboard className="w-4 h-4" /> {t('dashboard')}
                      </Link>
                      <Link
                        href="/history"
                        onClick={() => setShowUserMenu(false)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm ${
                          isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <HistoryIcon className="w-4 h-4" /> {t('history')}
                      </Link>
                      <button
                        onClick={logout}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
                      >
                        <LogOut className="w-4 h-4" /> {t('logout')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/login"
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600"
                >
                  {t('login')}
                </Link>
                <Link
                  href="/register"
                  className={`hidden sm:inline-block px-3 py-2 rounded-lg text-sm font-medium ${
                    isDark ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {t('register')}
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
