'use client'
import React, { createContext, useContext, useState, useEffect } from 'react'

export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', dir: 'rtl' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', dir: 'ltr' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', dir: 'ltr' },
]

const translations: Record<string, Record<string, string>> = {
  en: {
    search: 'Search',
    formulas: 'Formulas',
    dashboard: 'Dashboard',
    pricing: 'Pricing',
    login: 'Login',
    logout: 'Logout',
    register: 'Register',
    save: 'Save',
    download_pdf: 'Download PDF',
    download_excel: 'Download Excel',
    share: 'Share',
    print: 'Print',
    dark_mode: 'Dark Mode',
    light_mode: 'Light Mode',
    language: 'Language',
    welcome: 'Welcome',
    search_placeholder: 'Search for any chemical formula...',
    components: 'Components',
    percentage: 'Percentage',
    cas_number: 'CAS Number',
    function: 'Function',
    process: 'Process',
    safety: 'Safety',
    compliance: 'Compliance',
    cost: 'Cost Analysis',
    history: 'Chat History',
    my_formulas: 'My Formulas',
    trust_score: 'Trust Score',
    source: 'Source',
    upload_book: 'Upload Book',
    get_started: 'Get Started',
    try_search: 'Try Search',
    view_plans: 'View Plans',
    countries: 'Countries',
    formulas_count: 'Formulas',
    industries: 'Industries',
    ai_powered: 'AI Powered',
  },
  ar: {
    search: 'بحث',
    formulas: 'فورمولات',
    dashboard: 'لوحة التحكم',
    pricing: 'الأسعار',
    login: 'دخول',
    logout: 'خروج',
    register: 'تسجيل',
    save: 'حفظ',
    download_pdf: 'تحميل PDF',
    download_excel: 'تحميل Excel',
    share: 'مشاركة',
    print: 'طباعة',
    dark_mode: 'الوضع الليلي',
    light_mode: 'الوضع النهاري',
    language: 'اللغة',
    welcome: 'مرحباً',
    search_placeholder: 'ابحث عن أي فورمولا كيميائية...',
    components: 'المكونات',
    percentage: 'النسبة المئوية',
    cas_number: 'رقم CAS',
    function: 'الوظيفة',
    process: 'طريقة التحضير',
    safety: 'السلامة',
    compliance: 'الامتثال التنظيمي',
    cost: 'تحليل التكلفة',
    history: 'سجل المحادثات',
    my_formulas: 'فورمولاتي',
    trust_score: 'درجة الثقة',
    source: 'المصدر',
    upload_book: 'رفع كتاب',
    get_started: 'ابدأ الآن',
    try_search: 'جرب البحث',
    view_plans: 'شاهد الخطط',
    countries: 'دولة',
    formulas_count: 'فورمولا',
    industries: 'صناعة',
    ai_powered: 'ذكاء اصطناعي',
  },
  fr: {
    search: 'Rechercher',
    formulas: 'Formules',
    dashboard: 'Tableau de bord',
    pricing: 'Tarifs',
    login: 'Connexion',
    logout: 'Déconnexion',
    save: 'Sauvegarder',
    download_pdf: 'Télécharger PDF',
    download_excel: 'Télécharger Excel',
    share: 'Partager',
    print: 'Imprimer',
    welcome: 'Bienvenue',
    search_placeholder: 'Rechercher une formule chimique...',
    get_started: 'Commencer',
    try_search: 'Essayer la recherche',
    view_plans: 'Voir les forfaits',
  },
  es: {
    search: 'Buscar',
    formulas: 'Fórmulas',
    dashboard: 'Panel',
    pricing: 'Precios',
    login: 'Iniciar sesión',
    logout: 'Cerrar sesión',
    save: 'Guardar',
    download_pdf: 'Descargar PDF',
    download_excel: 'Descargar Excel',
    share: 'Compartir',
    print: 'Imprimir',
    welcome: 'Bienvenido',
    search_placeholder: 'Buscar una fórmula química...',
    get_started: 'Empezar',
    try_search: 'Probar búsqueda',
    view_plans: 'Ver planes',
  },
}

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
    if (saved) setLanguage(saved)
  }, [])

  useEffect(() => {
    if (!mounted) return
    localStorage.setItem('language', language)
    const langConfig = LANGUAGES.find((l) => l.code === language)
    document.documentElement.dir = langConfig?.dir || 'ltr'
    document.documentElement.lang = language
  }, [language, mounted])

  const t = (key: string): string => {
    return translations[language]?.[key] || translations['en']?.[key] || key
  }

  const dir = LANGUAGES.find((l) => l.code === language)?.dir || 'ltr'

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, dir }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => useContext(LanguageContext)