'use client'
import React, { createContext, useContext, useState, useEffect } from 'react'
import { TRANSLATIONS, LANGUAGES } from '@/i18n/translations'

export { LANGUAGES }

type Language = string

const LanguageContext = createContext<{
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string) => string
  dir: string
}>({
  language: 'en',
  setLanguage: () => {},
  t: (key: string) => key,
  dir: 'ltr',
})

export function LanguageProvider({
  children,
  defaultLanguage = 'en',
}: {
  children: React.ReactNode
  defaultLanguage?: Language
}) {
  const [language, setLanguage] = useState<Language>(defaultLanguage)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem('language')
    if (saved && TRANSLATIONS[saved]) setLanguage(saved)
  }, [])

  useEffect(() => {
    if (!mounted) return
    localStorage.setItem('language', language)
    const langConfig = LANGUAGES.find((l) => l.code === language)
    document.documentElement.dir = langConfig?.dir || 'ltr'
    document.documentElement.lang = language
  }, [language, mounted])

  // English is the base; missing keys fall back to English, then to the key itself.
  const t = (key: string): string => {
    const dict = TRANSLATIONS[language] as Record<string, string> | undefined
    const enDict = TRANSLATIONS['en'] as Record<string, string>
    return dict?.[key] ?? enDict[key] ?? key
  }

  const dir = LANGUAGES.find((l) => l.code === language)?.dir || 'ltr'

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, dir }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => useContext(LanguageContext)
