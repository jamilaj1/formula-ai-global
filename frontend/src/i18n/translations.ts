// =============================================================================
// Formula AI Global - i18n translations
// English is the base. Missing keys in any language fall back to English.
// Add languages by extending LANGUAGES + TRANSLATIONS.
// =============================================================================

export type LanguageMeta = {
  code: string
  name: string         // English name of the language
  nativeName: string   // The language's own name in its own script
  flag: string         // Emoji flag (best-effort)
  dir: 'ltr' | 'rtl'
}

export const LANGUAGES: LanguageMeta[] = [
  // English & European
  { code: 'en', name: 'English',     nativeName: 'English',    flag: '🇺🇸', dir: 'ltr' },
  { code: 'fr', name: 'French',      nativeName: 'Français',   flag: '🇫🇷', dir: 'ltr' },
  { code: 'es', name: 'Spanish',     nativeName: 'Español',    flag: '🇪🇸', dir: 'ltr' },
  { code: 'de', name: 'German',      nativeName: 'Deutsch',    flag: '🇩🇪', dir: 'ltr' },
  { code: 'it', name: 'Italian',     nativeName: 'Italiano',   flag: '🇮🇹', dir: 'ltr' },
  { code: 'pt', name: 'Portuguese',  nativeName: 'Português',  flag: '🇵🇹', dir: 'ltr' },
  { code: 'nl', name: 'Dutch',       nativeName: 'Nederlands', flag: '🇳🇱', dir: 'ltr' },
  { code: 'pl', name: 'Polish',      nativeName: 'Polski',     flag: '🇵🇱', dir: 'ltr' },
  { code: 'sv', name: 'Swedish',     nativeName: 'Svenska',    flag: '🇸🇪', dir: 'ltr' },
  { code: 'el', name: 'Greek',       nativeName: 'Ελληνικά',   flag: '🇬🇷', dir: 'ltr' },
  { code: 'ro', name: 'Romanian',    nativeName: 'Română',     flag: '🇷🇴', dir: 'ltr' },
  { code: 'cs', name: 'Czech',       nativeName: 'Čeština',    flag: '🇨🇿', dir: 'ltr' },
  { code: 'tr', name: 'Turkish',     nativeName: 'Türkçe',     flag: '🇹🇷', dir: 'ltr' },
  { code: 'ru', name: 'Russian',     nativeName: 'Русский',    flag: '🇷🇺', dir: 'ltr' },
  { code: 'uk', name: 'Ukrainian',   nativeName: 'Українська', flag: '🇺🇦', dir: 'ltr' },
  // Asian
  { code: 'zh', name: 'Chinese',     nativeName: '中文',        flag: '🇨🇳', dir: 'ltr' },
  { code: 'ja', name: 'Japanese',    nativeName: '日本語',      flag: '🇯🇵', dir: 'ltr' },
  { code: 'ko', name: 'Korean',      nativeName: '한국어',      flag: '🇰🇷', dir: 'ltr' },
  { code: 'hi', name: 'Hindi',       nativeName: 'हिन्दी',       flag: '🇮🇳', dir: 'ltr' },
  { code: 'bn', name: 'Bengali',     nativeName: 'বাংলা',        flag: '🇧🇩', dir: 'ltr' },
  { code: 'id', name: 'Indonesian',  nativeName: 'Indonesia',  flag: '🇮🇩', dir: 'ltr' },
  { code: 'vi', name: 'Vietnamese',  nativeName: 'Tiếng Việt', flag: '🇻🇳', dir: 'ltr' },
  { code: 'th', name: 'Thai',        nativeName: 'ไทย',         flag: '🇹🇭', dir: 'ltr' },
  // RTL (Right-to-left)
  { code: 'ar', name: 'Arabic',      nativeName: 'العربية',    flag: '🇸🇦', dir: 'rtl' },
  { code: 'fa', name: 'Persian',     nativeName: 'فارسی',      flag: '🇮🇷', dir: 'rtl' },
  { code: 'he', name: 'Hebrew',      nativeName: 'עברית',      flag: '🇮🇱', dir: 'rtl' },
  { code: 'ur', name: 'Urdu',        nativeName: 'اردو',       flag: '🇵🇰', dir: 'rtl' },
]

// Type-safe set of translation keys (English defines the canonical set).
type Keys =
  | 'search' | 'formulas' | 'dashboard' | 'pricing'
  | 'login' | 'logout' | 'register'
  | 'save' | 'download_pdf' | 'download_excel' | 'share' | 'print'
  | 'dark_mode' | 'light_mode' | 'language'
  | 'welcome' | 'search_placeholder'
  | 'components' | 'percentage' | 'cas_number' | 'function' | 'process'
  | 'safety' | 'compliance' | 'cost'
  | 'history' | 'my_formulas' | 'trust_score' | 'source'
  | 'upload_book' | 'get_started' | 'try_search' | 'view_plans'
  | 'countries' | 'formulas_count' | 'industries' | 'ai_powered'

type Dict = Partial<Record<Keys, string>>

export const TRANSLATIONS: Record<string, Dict> = {
  en: {
    search: 'Search', formulas: 'Formulas', dashboard: 'Dashboard', pricing: 'Pricing',
    login: 'Login', logout: 'Logout', register: 'Register',
    save: 'Save', download_pdf: 'Download PDF', download_excel: 'Download Excel', share: 'Share', print: 'Print',
    dark_mode: 'Dark Mode', light_mode: 'Light Mode', language: 'Language',
    welcome: 'Welcome', search_placeholder: 'Search for any chemical formula...',
    components: 'Components', percentage: 'Percentage', cas_number: 'CAS Number',
    function: 'Function', process: 'Process', safety: 'Safety',
    compliance: 'Compliance', cost: 'Cost Analysis',
    history: 'Chat History', my_formulas: 'My Formulas', trust_score: 'Trust Score', source: 'Source',
    upload_book: 'Upload Book', get_started: 'Get Started', try_search: 'Try Search', view_plans: 'View Plans',
    countries: 'Countries', formulas_count: 'Formulas', industries: 'Industries', ai_powered: 'AI Powered',
  },

  // -- ARABIC ---------------------------------------------------------------
  ar: {
    search: 'بحث', formulas: 'فورمولات', dashboard: 'لوحة التحكم', pricing: 'الأسعار',
    login: 'دخول', logout: 'خروج', register: 'تسجيل',
    save: 'حفظ', download_pdf: 'تحميل PDF', download_excel: 'تحميل Excel', share: 'مشاركة', print: 'طباعة',
    dark_mode: 'الوضع الليلي', light_mode: 'الوضع النهاري', language: 'اللغة',
    welcome: 'مرحباً', search_placeholder: 'ابحث عن أي فورمولا كيميائية...',
    components: 'المكونات', percentage: 'النسبة المئوية', cas_number: 'رقم CAS',
    function: 'الوظيفة', process: 'طريقة التحضير', safety: 'السلامة',
    compliance: 'الامتثال التنظيمي', cost: 'تحليل التكلفة',
    history: 'سجل المحادثات', my_formulas: 'فورمولاتي', trust_score: 'درجة الثقة', source: 'المصدر',
    upload_book: 'رفع كتاب', get_started: 'ابدأ الآن', try_search: 'جرّب البحث', view_plans: 'شاهد الخطط',
    countries: 'دولة', formulas_count: 'فورمولا', industries: 'صناعة', ai_powered: 'ذكاء اصطناعي',
  },

  // -- FRENCH ---------------------------------------------------------------
  fr: {
    search: 'Rechercher', formulas: 'Formules', dashboard: 'Tableau de bord', pricing: 'Tarifs',
    login: 'Connexion', logout: 'Déconnexion', register: "S'inscrire",
    save: 'Sauvegarder', download_pdf: 'Télécharger PDF', download_excel: 'Télécharger Excel', share: 'Partager', print: 'Imprimer',
    dark_mode: 'Mode sombre', light_mode: 'Mode clair', language: 'Langue',
    welcome: 'Bienvenue', search_placeholder: 'Rechercher une formule chimique...',
    components: 'Composants', percentage: 'Pourcentage', cas_number: 'Numéro CAS',
    function: 'Fonction', process: 'Procédé', safety: 'Sécurité',
    compliance: 'Conformité', cost: 'Analyse des coûts',
    history: 'Historique', my_formulas: 'Mes formules', trust_score: 'Score de confiance', source: 'Source',
    upload_book: 'Téléverser un livre', get_started: 'Commencer', try_search: 'Essayer la recherche', view_plans: 'Voir les forfaits',
    countries: 'Pays', formulas_count: 'Formules', industries: 'Industries', ai_powered: "Propulsé par l'IA",
  },

  // -- SPANISH --------------------------------------------------------------
  es: {
    search: 'Buscar', formulas: 'Fórmulas', dashboard: 'Panel', pricing: 'Precios',
    login: 'Iniciar sesión', logout: 'Cerrar sesión', register: 'Registrarse',
    save: 'Guardar', download_pdf: 'Descargar PDF', download_excel: 'Descargar Excel', share: 'Compartir', print: 'Imprimir',
    dark_mode: 'Modo oscuro', light_mode: 'Modo claro', language: 'Idioma',
    welcome: 'Bienvenido', search_placeholder: 'Buscar una fórmula química...',
    components: 'Componentes', percentage: 'Porcentaje', cas_number: 'Número CAS',
    function: 'Función', process: 'Proceso', safety: 'Seguridad',
    compliance: 'Cumplimiento', cost: 'Análisis de costes',
    history: 'Historial', my_formulas: 'Mis fórmulas', trust_score: 'Puntuación de confianza', source: 'Fuente',
    upload_book: 'Subir libro', get_started: 'Empezar', try_search: 'Probar búsqueda', view_plans: 'Ver planes',
    countries: 'Países', formulas_count: 'Fórmulas', industries: 'Industrias', ai_powered: 'Impulsado por IA',
  },

  // -- GERMAN ---------------------------------------------------------------
  de: {
    search: 'Suchen', formulas: 'Formeln', dashboard: 'Dashboard', pricing: 'Preise',
    login: 'Anmelden', logout: 'Abmelden', register: 'Registrieren',
    save: 'Speichern', download_pdf: 'PDF herunterladen', download_excel: 'Excel herunterladen', share: 'Teilen', print: 'Drucken',
    dark_mode: 'Dunkelmodus', light_mode: 'Hellmodus', language: 'Sprache',
    welcome: 'Willkommen', search_placeholder: 'Nach einer chemischen Formel suchen...',
    components: 'Komponenten', percentage: 'Prozentsatz', cas_number: 'CAS-Nummer',
    function: 'Funktion', process: 'Prozess', safety: 'Sicherheit',
    compliance: 'Konformität', cost: 'Kostenanalyse',
    history: 'Verlauf', my_formulas: 'Meine Formeln', trust_score: 'Vertrauenswert', source: 'Quelle',
    upload_book: 'Buch hochladen', get_started: 'Loslegen', try_search: 'Suche testen', view_plans: 'Pläne ansehen',
    countries: 'Länder', formulas_count: 'Formeln', industries: 'Branchen', ai_powered: 'KI-gestützt',
  },

  // -- ITALIAN --------------------------------------------------------------
  it: {
    search: 'Cerca', formulas: 'Formule', dashboard: 'Dashboard', pricing: 'Prezzi',
    login: 'Accedi', logout: 'Esci', register: 'Registrati',
    save: 'Salva', download_pdf: 'Scarica PDF', download_excel: 'Scarica Excel', share: 'Condividi', print: 'Stampa',
    dark_mode: 'Modalità scura', light_mode: 'Modalità chiara', language: 'Lingua',
    welcome: 'Benvenuto', search_placeholder: 'Cerca una formula chimica...',
    components: 'Componenti', percentage: 'Percentuale', cas_number: 'Numero CAS',
    function: 'Funzione', process: 'Processo', safety: 'Sicurezza',
    compliance: 'Conformità', cost: 'Analisi dei costi',
    history: 'Cronologia', my_formulas: 'Le mie formule', trust_score: 'Punteggio di affidabilità', source: 'Fonte',
    upload_book: 'Carica libro', get_started: 'Inizia', try_search: 'Prova la ricerca', view_plans: 'Vedi piani',
    countries: 'Paesi', formulas_count: 'Formule', industries: 'Industrie', ai_powered: 'Basato su IA',
  },

  // -- PORTUGUESE -----------------------------------------------------------
  pt: {
    search: 'Pesquisar', formulas: 'Fórmulas', dashboard: 'Painel', pricing: 'Preços',
    login: 'Entrar', logout: 'Sair', register: 'Registar',
    save: 'Guardar', download_pdf: 'Baixar PDF', download_excel: 'Baixar Excel', share: 'Partilhar', print: 'Imprimir',
    dark_mode: 'Modo escuro', light_mode: 'Modo claro', language: 'Idioma',
    welcome: 'Bem-vindo', search_placeholder: 'Pesquisar uma fórmula química...',
    components: 'Componentes', percentage: 'Percentagem', cas_number: 'Número CAS',
    function: 'Função', process: 'Processo', safety: 'Segurança',
    compliance: 'Conformidade', cost: 'Análise de custos',
    history: 'Histórico', my_formulas: 'As minhas fórmulas', trust_score: 'Pontuação de confiança', source: 'Fonte',
    upload_book: 'Enviar livro', get_started: 'Começar', try_search: 'Experimentar a pesquisa', view_plans: 'Ver planos',
    countries: 'Países', formulas_count: 'Fórmulas', industries: 'Indústrias', ai_powered: 'Alimentado por IA',
  },

  // -- DUTCH ----------------------------------------------------------------
  nl: {
    search: 'Zoeken', formulas: 'Formules', dashboard: 'Dashboard', pricing: 'Prijzen',
    login: 'Inloggen', logout: 'Uitloggen', register: 'Registreren',
    save: 'Opslaan', download_pdf: 'PDF downloaden', download_excel: 'Excel downloaden', share: 'Delen', print: 'Afdrukken',
    dark_mode: 'Donkere modus', light_mode: 'Lichte modus', language: 'Taal',
    welcome: 'Welkom', search_placeholder: 'Zoek een chemische formule...',
    components: 'Bestanddelen', percentage: 'Percentage', cas_number: 'CAS-nummer',
    function: 'Functie', process: 'Proces', safety: 'Veiligheid',
    compliance: 'Naleving', cost: 'Kostenanalyse',
    history: 'Geschiedenis', my_formulas: 'Mijn formules', trust_score: 'Vertrouwensscore', source: 'Bron',
    upload_book: 'Boek uploaden', get_started: 'Beginnen', try_search: 'Probeer zoeken', view_plans: 'Bekijk plannen',
    countries: 'Landen', formulas_count: 'Formules', industries: 'Industrieën', ai_powered: 'AI-aangedreven',
  },

  // -- POLISH ---------------------------------------------------------------
  pl: {
    search: 'Szukaj', formulas: 'Formuły', dashboard: 'Panel', pricing: 'Cennik',
    login: 'Zaloguj się', logout: 'Wyloguj się', register: 'Zarejestruj się',
    save: 'Zapisz', download_pdf: 'Pobierz PDF', download_excel: 'Pobierz Excel', share: 'Udostępnij', print: 'Drukuj',
    dark_mode: 'Tryb ciemny', light_mode: 'Tryb jasny', language: 'Język',
    welcome: 'Witaj', search_placeholder: 'Wyszukaj formułę chemiczną...',
    components: 'Składniki', percentage: 'Procent', cas_number: 'Numer CAS',
    function: 'Funkcja', process: 'Proces', safety: 'Bezpieczeństwo',
    compliance: 'Zgodność', cost: 'Analiza kosztów',
    history: 'Historia', my_formulas: 'Moje formuły', trust_score: 'Wskaźnik zaufania', source: 'Źródło',
    upload_book: 'Prześlij książkę', get_started: 'Rozpocznij', try_search: 'Wypróbuj wyszukiwanie', view_plans: 'Zobacz plany',
    countries: 'Krajów', formulas_count: 'Formuł', industries: 'Branż', ai_powered: 'Zasilane przez AI',
  },

  // -- SWEDISH --------------------------------------------------------------
  sv: {
    search: 'Sök', formulas: 'Formler', dashboard: 'Översikt', pricing: 'Priser',
    login: 'Logga in', logout: 'Logga ut', register: 'Registrera',
    save: 'Spara', download_pdf: 'Ladda ner PDF', download_excel: 'Ladda ner Excel', share: 'Dela', print: 'Skriv ut',
    dark_mode: 'Mörkt läge', light_mode: 'Ljust läge', language: 'Språk',
    welcome: 'Välkommen', search_placeholder: 'Sök en kemisk formel...',
    components: 'Komponenter', percentage: 'Procent', cas_number: 'CAS-nummer',
    function: 'Funktion', process: 'Process', safety: 'Säkerhet',
    compliance: 'Efterlevnad', cost: 'Kostnadsanalys',
    history: 'Historik', my_formulas: 'Mina formler', trust_score: 'Förtroendepoäng', source: 'Källa',
    upload_book: 'Ladda upp bok', get_started: 'Kom igång', try_search: 'Prova sökning', view_plans: 'Visa planer',
    countries: 'Länder', formulas_count: 'Formler', industries: 'Branscher', ai_powered: 'AI-driven',
  },

  // -- GREEK ----------------------------------------------------------------
  el: {
    search: 'Αναζήτηση', formulas: 'Φόρμουλες', dashboard: 'Πίνακας', pricing: 'Τιμές',
    login: 'Σύνδεση', logout: 'Αποσύνδεση', register: 'Εγγραφή',
    save: 'Αποθήκευση', download_pdf: 'Λήψη PDF', download_excel: 'Λήψη Excel', share: 'Κοινοποίηση', print: 'Εκτύπωση',
    dark_mode: 'Σκοτεινή λειτουργία', light_mode: 'Φωτεινή λειτουργία', language: 'Γλώσσα',
    welcome: 'Καλώς ήρθατε', search_placeholder: 'Αναζήτηση χημικής φόρμουλας...',
    components: 'Συστατικά', percentage: 'Ποσοστό', cas_number: 'Αριθμός CAS',
    function: 'Λειτουργία', process: 'Διαδικασία', safety: 'Ασφάλεια',
    compliance: 'Συμμόρφωση', cost: 'Ανάλυση κόστους',
    history: 'Ιστορικό', my_formulas: 'Οι φόρμουλές μου', trust_score: 'Βαθμός εμπιστοσύνης', source: 'Πηγή',
    upload_book: 'Μεταφόρτωση βιβλίου', get_started: 'Ξεκινήστε', try_search: 'Δοκιμάστε αναζήτηση', view_plans: 'Δείτε τα πλάνα',
    countries: 'Χώρες', formulas_count: 'Φόρμουλες', industries: 'Βιομηχανίες', ai_powered: 'Με AI',
  },

  // -- ROMANIAN -------------------------------------------------------------
  ro: {
    search: 'Căutare', formulas: 'Formule', dashboard: 'Tablou de bord', pricing: 'Prețuri',
    login: 'Autentificare', logout: 'Deconectare', register: 'Înregistrare',
    save: 'Salvează', download_pdf: 'Descarcă PDF', download_excel: 'Descarcă Excel', share: 'Partajează', print: 'Imprimă',
    dark_mode: 'Mod întunecat', light_mode: 'Mod luminos', language: 'Limbă',
    welcome: 'Bine ați venit', search_placeholder: 'Căutați o formulă chimică...',
    components: 'Componente', percentage: 'Procent', cas_number: 'Număr CAS',
    function: 'Funcție', process: 'Proces', safety: 'Siguranță',
    compliance: 'Conformitate', cost: 'Analiza costurilor',
    history: 'Istoric', my_formulas: 'Formulele mele', trust_score: 'Scor de încredere', source: 'Sursă',
    upload_book: 'Încarcă carte', get_started: 'Începe', try_search: 'Încearcă căutarea', view_plans: 'Vezi planurile',
    countries: 'Țări', formulas_count: 'Formule', industries: 'Industrii', ai_powered: 'Alimentat de AI',
  },

  // -- CZECH ----------------------------------------------------------------
  cs: {
    search: 'Hledat', formulas: 'Vzorce', dashboard: 'Přehled', pricing: 'Ceny',
    login: 'Přihlásit', logout: 'Odhlásit', register: 'Registrovat',
    save: 'Uložit', download_pdf: 'Stáhnout PDF', download_excel: 'Stáhnout Excel', share: 'Sdílet', print: 'Tisk',
    dark_mode: 'Tmavý režim', light_mode: 'Světlý režim', language: 'Jazyk',
    welcome: 'Vítejte', search_placeholder: 'Vyhledat chemický vzorec...',
    components: 'Složky', percentage: 'Procento', cas_number: 'CAS číslo',
    function: 'Funkce', process: 'Proces', safety: 'Bezpečnost',
    compliance: 'Soulad', cost: 'Analýza nákladů',
    history: 'Historie', my_formulas: 'Moje vzorce', trust_score: 'Skóre důvěry', source: 'Zdroj',
    upload_book: 'Nahrát knihu', get_started: 'Začít', try_search: 'Vyzkoušet hledání', view_plans: 'Zobrazit plány',
    countries: 'Zemí', formulas_count: 'Vzorců', industries: 'Odvětví', ai_powered: 'Poháněno AI',
  },

  // -- TURKISH --------------------------------------------------------------
  tr: {
    search: 'Ara', formulas: 'Formüller', dashboard: 'Kontrol paneli', pricing: 'Fiyatlandırma',
    login: 'Giriş yap', logout: 'Çıkış yap', register: 'Kayıt ol',
    save: 'Kaydet', download_pdf: 'PDF indir', download_excel: 'Excel indir', share: 'Paylaş', print: 'Yazdır',
    dark_mode: 'Koyu mod', light_mode: 'Açık mod', language: 'Dil',
    welcome: 'Hoş geldiniz', search_placeholder: 'Bir kimyasal formül arayın...',
    components: 'Bileşenler', percentage: 'Yüzde', cas_number: 'CAS Numarası',
    function: 'İşlev', process: 'İşlem', safety: 'Güvenlik',
    compliance: 'Uyumluluk', cost: 'Maliyet analizi',
    history: 'Geçmiş', my_formulas: 'Formüllerim', trust_score: 'Güven puanı', source: 'Kaynak',
    upload_book: 'Kitap yükle', get_started: 'Başla', try_search: 'Aramayı dene', view_plans: 'Planları gör',
    countries: 'Ülke', formulas_count: 'Formül', industries: 'Sektör', ai_powered: 'AI destekli',
  },

  // -- RUSSIAN --------------------------------------------------------------
  ru: {
    search: 'Поиск', formulas: 'Формулы', dashboard: 'Панель', pricing: 'Тарифы',
    login: 'Войти', logout: 'Выйти', register: 'Регистрация',
    save: 'Сохранить', download_pdf: 'Скачать PDF', download_excel: 'Скачать Excel', share: 'Поделиться', print: 'Печать',
    dark_mode: 'Тёмная тема', light_mode: 'Светлая тема', language: 'Язык',
    welcome: 'Добро пожаловать', search_placeholder: 'Найти химическую формулу...',
    components: 'Компоненты', percentage: 'Процент', cas_number: 'Номер CAS',
    function: 'Функция', process: 'Процесс', safety: 'Безопасность',
    compliance: 'Соответствие', cost: 'Анализ затрат',
    history: 'История', my_formulas: 'Мои формулы', trust_score: 'Рейтинг доверия', source: 'Источник',
    upload_book: 'Загрузить книгу', get_started: 'Начать', try_search: 'Попробовать поиск', view_plans: 'Тарифы',
    countries: 'Стран', formulas_count: 'Формул', industries: 'Отраслей', ai_powered: 'На базе ИИ',
  },

  // -- UKRAINIAN ------------------------------------------------------------
  uk: {
    search: 'Пошук', formulas: 'Формули', dashboard: 'Панель', pricing: 'Ціни',
    login: 'Увійти', logout: 'Вийти', register: 'Реєстрація',
    save: 'Зберегти', download_pdf: 'Завантажити PDF', download_excel: 'Завантажити Excel', share: 'Поділитися', print: 'Друк',
    dark_mode: 'Темна тема', light_mode: 'Світла тема', language: 'Мова',
    welcome: 'Ласкаво просимо', search_placeholder: 'Шукати хімічну формулу...',
    components: 'Компоненти', percentage: 'Відсоток', cas_number: 'Номер CAS',
    function: 'Функція', process: 'Процес', safety: 'Безпека',
    compliance: 'Відповідність', cost: 'Аналіз витрат',
    history: 'Історія', my_formulas: 'Мої формули', trust_score: 'Рівень довіри', source: 'Джерело',
    upload_book: 'Завантажити книгу', get_started: 'Почати', try_search: 'Спробувати пошук', view_plans: 'Переглянути тарифи',
    countries: 'Країн', formulas_count: 'Формул', industries: 'Галузей', ai_powered: 'На базі ШІ',
  },

  // -- CHINESE (Simplified) -------------------------------------------------
  zh: {
    search: '搜索', formulas: '配方', dashboard: '控制台', pricing: '价格',
    login: '登录', logout: '登出', register: '注册',
    save: '保存', download_pdf: '下载 PDF', download_excel: '下载 Excel', share: '分享', print: '打印',
    dark_mode: '深色模式', light_mode: '浅色模式', language: '语言',
    welcome: '欢迎', search_placeholder: '搜索任何化学配方...',
    components: '成分', percentage: '百分比', cas_number: 'CAS 号',
    function: '功能', process: '工艺', safety: '安全',
    compliance: '合规性', cost: '成本分析',
    history: '历史记录', my_formulas: '我的配方', trust_score: '可信度', source: '来源',
    upload_book: '上传书籍', get_started: '开始使用', try_search: '试试搜索', view_plans: '查看套餐',
    countries: '国家', formulas_count: '配方', industries: '行业', ai_powered: 'AI 驱动',
  },

  // -- JAPANESE -------------------------------------------------------------
  ja: {
    search: '検索', formulas: '配合', dashboard: 'ダッシュボード', pricing: '料金',
    login: 'ログイン', logout: 'ログアウト', register: '登録',
    save: '保存', download_pdf: 'PDFをダウンロード', download_excel: 'Excelをダウンロード', share: '共有', print: '印刷',
    dark_mode: 'ダークモード', light_mode: 'ライトモード', language: '言語',
    welcome: 'ようこそ', search_placeholder: '化学配合を検索...',
    components: '成分', percentage: '割合', cas_number: 'CAS番号',
    function: '機能', process: '工程', safety: '安全性',
    compliance: '規制適合', cost: 'コスト分析',
    history: '履歴', my_formulas: 'マイ配合', trust_score: '信頼スコア', source: '出典',
    upload_book: '書籍をアップロード', get_started: '始める', try_search: '検索を試す', view_plans: 'プランを見る',
    countries: 'カ国', formulas_count: '配合', industries: '業界', ai_powered: 'AI搭載',
  },

  // -- KOREAN ---------------------------------------------------------------
  ko: {
    search: '검색', formulas: '제형', dashboard: '대시보드', pricing: '요금제',
    login: '로그인', logout: '로그아웃', register: '회원가입',
    save: '저장', download_pdf: 'PDF 다운로드', download_excel: 'Excel 다운로드', share: '공유', print: '인쇄',
    dark_mode: '다크 모드', light_mode: '라이트 모드', language: '언어',
    welcome: '환영합니다', search_placeholder: '화학 제형 검색...',
    components: '성분', percentage: '비율', cas_number: 'CAS 번호',
    function: '기능', process: '공정', safety: '안전',
    compliance: '규정 준수', cost: '비용 분석',
    history: '기록', my_formulas: '내 제형', trust_score: '신뢰 점수', source: '출처',
    upload_book: '책 업로드', get_started: '시작하기', try_search: '검색 해보기', view_plans: '요금제 보기',
    countries: '국가', formulas_count: '제형', industries: '산업', ai_powered: 'AI 기반',
  },

  // -- HINDI ----------------------------------------------------------------
  hi: {
    search: 'खोजें', formulas: 'सूत्र', dashboard: 'डैशबोर्ड', pricing: 'मूल्य निर्धारण',
    login: 'लॉगिन', logout: 'लॉगआउट', register: 'पंजीकरण',
    save: 'सहेजें', download_pdf: 'PDF डाउनलोड करें', download_excel: 'Excel डाउनलोड करें', share: 'साझा करें', print: 'प्रिंट करें',
    dark_mode: 'डार्क मोड', light_mode: 'लाइट मोड', language: 'भाषा',
    welcome: 'स्वागत है', search_placeholder: 'कोई रासायनिक सूत्र खोजें...',
    components: 'घटक', percentage: 'प्रतिशत', cas_number: 'CAS संख्या',
    function: 'कार्य', process: 'प्रक्रिया', safety: 'सुरक्षा',
    compliance: 'अनुपालन', cost: 'लागत विश्लेषण',
    history: 'इतिहास', my_formulas: 'मेरे सूत्र', trust_score: 'विश्वास स्कोर', source: 'स्रोत',
    upload_book: 'किताब अपलोड करें', get_started: 'शुरू करें', try_search: 'खोज आज़माएं', view_plans: 'योजनाएं देखें',
    countries: 'देश', formulas_count: 'सूत्र', industries: 'उद्योग', ai_powered: 'AI द्वारा संचालित',
  },

  // -- BENGALI --------------------------------------------------------------
  bn: {
    search: 'অনুসন্ধান', formulas: 'সূত্র', dashboard: 'ড্যাশবোর্ড', pricing: 'মূল্য',
    login: 'লগইন', logout: 'লগআউট', register: 'নিবন্ধন',
    save: 'সংরক্ষণ', download_pdf: 'PDF ডাউনলোড', download_excel: 'Excel ডাউনলোড', share: 'শেয়ার', print: 'মুদ্রণ',
    dark_mode: 'ডার্ক মোড', light_mode: 'লাইট মোড', language: 'ভাষা',
    welcome: 'স্বাগতম', search_placeholder: 'যেকোনো রাসায়নিক সূত্র খুঁজুন...',
    components: 'উপাদান', percentage: 'শতাংশ', cas_number: 'CAS নম্বর',
    function: 'কার্য', process: 'প্রক্রিয়া', safety: 'নিরাপত্তা',
    compliance: 'সম্মতি', cost: 'খরচ বিশ্লেষণ',
    history: 'ইতিহাস', my_formulas: 'আমার সূত্র', trust_score: 'বিশ্বাস স্কোর', source: 'উৎস',
    upload_book: 'বই আপলোড', get_started: 'শুরু করুন', try_search: 'অনুসন্ধান চেষ্টা করুন', view_plans: 'প্ল্যান দেখুন',
    countries: 'দেশ', formulas_count: 'সূত্র', industries: 'শিল্প', ai_powered: 'AI চালিত',
  },

  // -- INDONESIAN -----------------------------------------------------------
  id: {
    search: 'Cari', formulas: 'Formula', dashboard: 'Dasbor', pricing: 'Harga',
    login: 'Masuk', logout: 'Keluar', register: 'Daftar',
    save: 'Simpan', download_pdf: 'Unduh PDF', download_excel: 'Unduh Excel', share: 'Bagikan', print: 'Cetak',
    dark_mode: 'Mode gelap', light_mode: 'Mode terang', language: 'Bahasa',
    welcome: 'Selamat datang', search_placeholder: 'Cari formula kimia...',
    components: 'Komponen', percentage: 'Persentase', cas_number: 'Nomor CAS',
    function: 'Fungsi', process: 'Proses', safety: 'Keamanan',
    compliance: 'Kepatuhan', cost: 'Analisis biaya',
    history: 'Riwayat', my_formulas: 'Formula saya', trust_score: 'Skor kepercayaan', source: 'Sumber',
    upload_book: 'Unggah buku', get_started: 'Mulai', try_search: 'Coba pencarian', view_plans: 'Lihat paket',
    countries: 'Negara', formulas_count: 'Formula', industries: 'Industri', ai_powered: 'Didukung AI',
  },

  // -- VIETNAMESE -----------------------------------------------------------
  vi: {
    search: 'Tìm kiếm', formulas: 'Công thức', dashboard: 'Bảng điều khiển', pricing: 'Bảng giá',
    login: 'Đăng nhập', logout: 'Đăng xuất', register: 'Đăng ký',
    save: 'Lưu', download_pdf: 'Tải PDF', download_excel: 'Tải Excel', share: 'Chia sẻ', print: 'In',
    dark_mode: 'Chế độ tối', light_mode: 'Chế độ sáng', language: 'Ngôn ngữ',
    welcome: 'Chào mừng', search_placeholder: 'Tìm kiếm công thức hóa học...',
    components: 'Thành phần', percentage: 'Phần trăm', cas_number: 'Số CAS',
    function: 'Chức năng', process: 'Quy trình', safety: 'An toàn',
    compliance: 'Tuân thủ', cost: 'Phân tích chi phí',
    history: 'Lịch sử', my_formulas: 'Công thức của tôi', trust_score: 'Điểm tin cậy', source: 'Nguồn',
    upload_book: 'Tải sách lên', get_started: 'Bắt đầu', try_search: 'Thử tìm kiếm', view_plans: 'Xem gói',
    countries: 'Quốc gia', formulas_count: 'Công thức', industries: 'Ngành', ai_powered: 'Hỗ trợ AI',
  },

  // -- THAI -----------------------------------------------------------------
  th: {
    search: 'ค้นหา', formulas: 'สูตร', dashboard: 'แดชบอร์ด', pricing: 'ราคา',
    login: 'เข้าสู่ระบบ', logout: 'ออกจากระบบ', register: 'สมัคร',
    save: 'บันทึก', download_pdf: 'ดาวน์โหลด PDF', download_excel: 'ดาวน์โหลด Excel', share: 'แชร์', print: 'พิมพ์',
    dark_mode: 'โหมดมืด', light_mode: 'โหมดสว่าง', language: 'ภาษา',
    welcome: 'ยินดีต้อนรับ', search_placeholder: 'ค้นหาสูตรเคมี...',
    components: 'ส่วนประกอบ', percentage: 'เปอร์เซ็นต์', cas_number: 'หมายเลข CAS',
    function: 'หน้าที่', process: 'กระบวนการ', safety: 'ความปลอดภัย',
    compliance: 'การปฏิบัติตามกฎ', cost: 'การวิเคราะห์ต้นทุน',
    history: 'ประวัติ', my_formulas: 'สูตรของฉัน', trust_score: 'คะแนนความน่าเชื่อถือ', source: 'แหล่งที่มา',
    upload_book: 'อัปโหลดหนังสือ', get_started: 'เริ่มต้น', try_search: 'ลองค้นหา', view_plans: 'ดูแพ็กเกจ',
    countries: 'ประเทศ', formulas_count: 'สูตร', industries: 'อุตสาหกรรม', ai_powered: 'ขับเคลื่อนด้วย AI',
  },

  // -- PERSIAN (FARSI) ------------------------------------------------------
  fa: {
    search: 'جستجو', formulas: 'فرمول‌ها', dashboard: 'داشبورد', pricing: 'قیمت‌گذاری',
    login: 'ورود', logout: 'خروج', register: 'ثبت‌نام',
    save: 'ذخیره', download_pdf: 'دانلود PDF', download_excel: 'دانلود Excel', share: 'اشتراک‌گذاری', print: 'چاپ',
    dark_mode: 'حالت تاریک', light_mode: 'حالت روشن', language: 'زبان',
    welcome: 'خوش آمدید', search_placeholder: 'جستجوی فرمول شیمیایی...',
    components: 'اجزا', percentage: 'درصد', cas_number: 'شماره CAS',
    function: 'عملکرد', process: 'فرآیند', safety: 'ایمنی',
    compliance: 'انطباق', cost: 'تحلیل هزینه',
    history: 'تاریخچه', my_formulas: 'فرمول‌های من', trust_score: 'امتیاز اعتماد', source: 'منبع',
    upload_book: 'بارگذاری کتاب', get_started: 'شروع کنید', try_search: 'جستجو را امتحان کنید', view_plans: 'مشاهده پلان‌ها',
    countries: 'کشور', formulas_count: 'فرمول', industries: 'صنعت', ai_powered: 'مبتنی بر هوش مصنوعی',
  },

  // -- HEBREW ---------------------------------------------------------------
  he: {
    search: 'חיפוש', formulas: 'נוסחאות', dashboard: 'לוח בקרה', pricing: 'תמחור',
    login: 'התחבר', logout: 'התנתק', register: 'הרשמה',
    save: 'שמור', download_pdf: 'הורד PDF', download_excel: 'הורד Excel', share: 'שתף', print: 'הדפס',
    dark_mode: 'מצב כהה', light_mode: 'מצב בהיר', language: 'שפה',
    welcome: 'ברוך הבא', search_placeholder: 'חפש נוסחה כימית...',
    components: 'רכיבים', percentage: 'אחוז', cas_number: 'מספר CAS',
    function: 'תפקיד', process: 'תהליך', safety: 'בטיחות',
    compliance: 'תאימות', cost: 'ניתוח עלויות',
    history: 'היסטוריה', my_formulas: 'הנוסחאות שלי', trust_score: 'ציון אמון', source: 'מקור',
    upload_book: 'העלה ספר', get_started: 'התחל', try_search: 'נסה חיפוש', view_plans: 'הצג תוכניות',
    countries: 'מדינות', formulas_count: 'נוסחאות', industries: 'תעשיות', ai_powered: 'מופעל בבינה מלאכותית',
  },

  // -- URDU -----------------------------------------------------------------
  ur: {
    search: 'تلاش', formulas: 'فارمولے', dashboard: 'ڈیش بورڈ', pricing: 'قیمتیں',
    login: 'لاگ ان', logout: 'لاگ آؤٹ', register: 'رجسٹر',
    save: 'محفوظ کریں', download_pdf: 'PDF ڈاؤن لوڈ', download_excel: 'Excel ڈاؤن لوڈ', share: 'شیئر کریں', print: 'پرنٹ',
    dark_mode: 'ڈارک موڈ', light_mode: 'لائٹ موڈ', language: 'زبان',
    welcome: 'خوش آمدید', search_placeholder: 'کوئی کیمیائی فارمولا تلاش کریں...',
    components: 'اجزاء', percentage: 'فیصد', cas_number: 'CAS نمبر',
    function: 'فعل', process: 'عمل', safety: 'حفاظت',
    compliance: 'تعمیل', cost: 'لاگت کا تجزیہ',
    history: 'تاریخ', my_formulas: 'میرے فارمولے', trust_score: 'اعتماد سکور', source: 'ماخذ',
    upload_book: 'کتاب اپ لوڈ', get_started: 'شروع کریں', try_search: 'تلاش آزمائیں', view_plans: 'منصوبے دیکھیں',
    countries: 'ممالک', formulas_count: 'فارمولے', industries: 'صنعتیں', ai_powered: 'AI پر مبنی',
  },
}
