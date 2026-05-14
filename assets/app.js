/* ============================================
   Formula AI Global - Interactive Scripts
   ============================================ */

// Navigation scroll effect
const navbar = document.querySelector('.navbar');
if (navbar) {
  const onScroll = () => {
    if (window.scrollY > 30) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Mobile nav toggle
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('open');
  });
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => navLinks.classList.remove('open'));
  });
}

// Scroll reveal animations
const revealItems = document.querySelectorAll('.reveal');
if (revealItems.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });
  revealItems.forEach(item => io.observe(item));
}

// Animated counters
const counters = document.querySelectorAll('[data-counter]');
if (counters.length) {
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseFloat(el.dataset.counter);
      const suffix = el.dataset.suffix || '';
      const prefix = el.dataset.prefix || '';
      const duration = 1800;
      const start = performance.now();
      const startVal = 0;
      const animate = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const value = startVal + (target - startVal) * ease;
        let displayed;
        if (target >= 1000) {
          displayed = Math.round(value).toLocaleString('en-US');
        } else if (Number.isInteger(target)) {
          displayed = Math.round(value);
        } else {
          displayed = value.toFixed(1);
        }
        el.textContent = `${prefix}${displayed}${suffix}`;
        if (progress < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
      counterObserver.unobserve(el);
    });
  }, { threshold: 0.4 });
  counters.forEach(c => counterObserver.observe(c));
}

// FAQ accordion
document.querySelectorAll('.faq-item').forEach(item => {
  const q = item.querySelector('.faq-q');
  if (q) {
    q.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(o => o.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  }
});

// Pricing toggle
const billingMonthly = document.getElementById('billing-monthly');
const billingYearly = document.getElementById('billing-yearly');
if (billingMonthly && billingYearly) {
  const updateBilling = (yearly) => {
    billingMonthly.classList.toggle('active', !yearly);
    billingYearly.classList.toggle('active', yearly);
    document.querySelectorAll('[data-monthly]').forEach(el => {
      el.style.display = yearly ? 'none' : '';
    });
    document.querySelectorAll('[data-yearly]').forEach(el => {
      el.style.display = yearly ? '' : 'none';
    });
  };
  billingMonthly.addEventListener('click', () => updateBilling(false));
  billingYearly.addEventListener('click', () => updateBilling(true));
  updateBilling(false);
}

// Tabs (formula detail)
document.querySelectorAll('[data-tabs]').forEach(group => {
  const tabs = group.querySelectorAll('.tab');
  const contents = document.querySelectorAll(`[data-tab-content="${group.dataset.tabs}"]`);
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.querySelector(`[data-tab-content="${group.dataset.tabs}"][data-key="${tab.dataset.tab}"]`);
      if (target) target.classList.add('active');
    });
  });
});

// Grade tabs (formula detail)
document.querySelectorAll('.grade-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.grade-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});

// Country selector (compliance)
document.querySelectorAll('.country-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.country-item').forEach(c => c.classList.remove('active'));
    item.classList.add('active');
    const country = item.dataset.country;
    if (country && window.updateCompliance) window.updateCompliance(country);
  });
});

// NOTE: search and chat demos have been moved to dedicated live modules:
//   - assets/search-live.js (real DB search via Worker)
//   - assets/chat-live.js   (real conversational AI)
//   - assets/learn-live.js  (PDF upload + extraction)
//   - assets/discover-live.js (papers + patents)
//   - assets/library-live.js (saved formulas + cost + scale)
// The old static demo arrays were removed in May 2026.

// Compliance demo data
const COMPLIANCE_DATA = {
  'SA': { compliant: 12, warning: 2, violation: 0, body: 'SFDA - Saudi Food & Drug Authority',
    standards: [
      { name: 'SFDA-Cos-001', desc: 'Chemical Product Safety Requirements' },
      { name: 'SASO 1786', desc: 'Shampoo & Personal Cleansing Specification' },
      { name: 'GSO 1943', desc: 'Chemical Substances Maximum Limits' },
      { name: 'SASO/IEC 60', desc: 'Arabic Labeling Requirements' }
    ]},
  'US': { compliant: 14, warning: 1, violation: 0, body: 'FDA - Food and Drug Administration',
    standards: [
      { name: 'FDA 21 CFR 700', desc: 'Cosmetics Compliance Requirements' },
      { name: 'EPA FIFRA', desc: 'Pesticide & Disinfectant Regulation' },
      { name: 'OSHA HCS', desc: 'Hazard Communication Standard' },
      { name: 'CPSC FHSA', desc: 'Federal Hazardous Substances Act' }
    ]},
  'EU': { compliant: 13, warning: 3, violation: 0, body: 'ECHA - European Chemicals Agency',
    standards: [
      { name: 'EC 1223/2009', desc: 'Cosmetic Products Regulation' },
      { name: 'REACH', desc: 'Chemical Substance Registration' },
      { name: 'CLP', desc: 'Classification, Labelling, Packaging' },
      { name: 'BPR EU 528/2012', desc: 'Biocidal Products Regulation' }
    ]},
  'AE': { compliant: 11, warning: 2, violation: 1, body: 'ESMA - UAE Standards & Metrology Authority',
    standards: [
      { name: 'UAE.S 5009', desc: 'Liquid Detergents Specification' },
      { name: 'ESMA Cosmetics', desc: 'Cosmetic Products Regulation' },
      { name: 'GSO 1943', desc: 'Chemical Substances Maximum Limits' }
    ]},
  'GH': { compliant: 10, warning: 4, violation: 0, body: 'GSA - Ghana Standards Authority',
    standards: [
      { name: 'GS 1066', desc: 'Toilet Soap & Detergent Specification' },
      { name: 'FDA Ghana', desc: 'Cosmetics Registration Guidelines' },
      { name: 'EPA Ghana', desc: 'Industrial Chemical Permits' }
    ]},
  'NG': { compliant: 9, warning: 5, violation: 1, body: 'NAFDAC - National Agency for Food & Drug',
    standards: [
      { name: 'NAFDAC C001', desc: 'Cosmetics Registration Guidelines' },
      { name: 'SON NIS 423', desc: 'Detergent Specification' },
      { name: 'NESREA', desc: 'Environmental Compliance' }
    ]},
  'CN': { compliant: 13, warning: 2, violation: 0, body: 'NMPA - National Medical Products Administration',
    standards: [
      { name: 'CSAR 2021', desc: 'Cosmetic Supervision & Administration' },
      { name: 'GB 7916', desc: 'Hygienic Standard for Cosmetics' },
      { name: 'GB/T 26396', desc: 'Detergent Safety Technical Specification' }
    ]},
  'EG': { compliant: 11, warning: 2, violation: 0, body: 'EDA - Egyptian Drug Authority',
    standards: [
      { name: 'EOS 4994', desc: 'Liquid Detergents Specification' },
      { name: 'EDA Cosmetics', desc: 'Cosmetic Products Registration' },
      { name: 'EOS 1559', desc: 'Liquid Soap Specification' }
    ]}
};

window.updateCompliance = function(country) {
  const data = COMPLIANCE_DATA[country];
  if (!data) return;
  const result = document.getElementById('compliance-result');
  if (!result) return;

  result.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; flex-wrap: wrap; gap: 14px;">
      <div>
        <h3 style="margin-bottom: 6px;" data-i18n-ar="نتائج فحص الامتثال">Compliance check results</h3>
        <div style="color: var(--text-3); font-size: 0.92rem;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="display: inline; vertical-align: middle; margin-inline-end: 4px;"><circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/></svg>
          ${data.body}
        </div>
      </div>
      <span class="confidence-badge" data-i18n-ar='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9 9 4 9 9z"/></svg> تم الفحص خلال 0.4s'>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9 9 4 9 9z"/></svg>
        Checked in 0.4s
      </span>
    </div>

    <div class="compliance-stats">
      <div class="comp-stat success">
        <div class="value">${data.compliant}</div>
        <div class="label" data-i18n-ar="متوافق">Compliant</div>
      </div>
      <div class="comp-stat warning">
        <div class="value">${data.warning}</div>
        <div class="label" data-i18n-ar="تحذيرات">Warnings</div>
      </div>
      <div class="comp-stat danger">
        <div class="value">${data.violation}</div>
        <div class="label" data-i18n-ar="مخالفات">Violations</div>
      </div>
    </div>

    <h4 style="margin-bottom: 14px;" data-i18n-ar="المعايير المطبقة">Applicable standards</h4>
    ${data.standards.map(s => `
      <div class="standard-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9 9 4 9 9z"/></svg>
        <div>
          <div class="standard-name">${s.name}</div>
          <div class="standard-desc">${s.desc}</div>
        </div>
      </div>
    `).join('')}
  `;
  // Re-apply current language to the freshly-injected nodes
  if (typeof window.applyLang === 'function') {
    try { window.applyLang(); } catch (_) { /* noop */ }
  }
};

// Initialize compliance with default country if on page
if (document.getElementById('compliance-result')) {
  const initialCountry = document.querySelector('.country-item.active')?.dataset.country || 'SA';
  window.updateCompliance(initialCountry);
}

// Service Worker registration + auto-upgrade.
// When a new SW takes over (controllerchange), reload the page once so the
// fresh JS/CSS/HTML take effect without the user having to hard-refresh.
if ('serviceWorker' in navigator) {
  let didReload = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (didReload) return;
    didReload = true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'fai-force-reload' && !didReload) {
      didReload = true;
      location.reload();
    }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Year for footer
document.querySelectorAll('[data-year]').forEach(el => {
  el.textContent = new Date().getFullYear();
});

/* ============================================
   Theme Toggle (Dark default, Light optional)
   ============================================ */
(function initTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem('fai_theme');
  if (saved === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme'); // default = dark

  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const cur = root.getAttribute('data-theme');
      if (cur === 'light') {
        root.removeAttribute('data-theme');
        localStorage.setItem('fai_theme', 'dark');
      } else {
        root.setAttribute('data-theme', 'light');
        localStorage.setItem('fai_theme', 'light');
      }
    });
  });
})();

/* ============================================
   Language Switcher (20 languages)
   ============================================ */
const FAI_LANGUAGES = [
  { code: 'en', name: 'English',     flag: '🇺🇸', dir: 'ltr' },
  { code: 'ar', name: 'العربية',      flag: '🇸🇦', dir: 'rtl' },
  { code: 'fr', name: 'Français',    flag: '🇫🇷', dir: 'ltr' },
  { code: 'es', name: 'Español',     flag: '🇪🇸', dir: 'ltr' },
  { code: 'pt', name: 'Português',   flag: '🇵🇹', dir: 'ltr' },
  { code: 'tr', name: 'Türkçe',      flag: '🇹🇷', dir: 'ltr' },
  { code: 'de', name: 'Deutsch',     flag: '🇩🇪', dir: 'ltr' },
  { code: 'it', name: 'Italiano',    flag: '🇮🇹', dir: 'ltr' },
  { code: 'zh', name: '中文',          flag: '🇨🇳', dir: 'ltr' },
  { code: 'ja', name: '日本語',        flag: '🇯🇵', dir: 'ltr' },
  { code: 'ko', name: '한국어',        flag: '🇰🇷', dir: 'ltr' },
  { code: 'ru', name: 'Русский',     flag: '🇷🇺', dir: 'ltr' },
  { code: 'hi', name: 'हिन्दी',         flag: '🇮🇳', dir: 'ltr' },
  { code: 'ur', name: 'اردو',         flag: '🇵🇰', dir: 'rtl' },
  { code: 'fa', name: 'فارسی',        flag: '🇮🇷', dir: 'rtl' },
  { code: 'ms', name: 'Bahasa Melayu',flag: '🇲🇾', dir: 'ltr' },
  { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩', dir: 'ltr' },
  { code: 'sw', name: 'Kiswahili',   flag: '🇰🇪', dir: 'ltr' },
  { code: 'ha', name: 'Hausa',       flag: '🇳🇬', dir: 'ltr' },
  { code: 'am', name: 'አማርኛ',         flag: '🇪🇹', dir: 'ltr' }
];

// Central dictionary for the most common UI strings, in all 20 languages.
// Keyed by the Arabic source (which lives in data-i18n-ar on every translatable
// element). When the user picks a language other than en/ar and the element has
// no inline data-i18n-<code>, we fall back to this dictionary.
const FAI_DICT = {
  'الرئيسية':            { fr:'Accueil', es:'Inicio', pt:'Início', tr:'Ana Sayfa', de:'Startseite', it:'Home', zh:'首页', ja:'ホーム', ko:'홈', ru:'Главная', hi:'होम', ur:'ہوم', fa:'خانه', ms:'Laman Utama', id:'Beranda', sw:'Nyumbani', ha:'Gida', am:'ቤት' },
  'البحث الذكي':         { fr:'Recherche intelligente', es:'Búsqueda inteligente', pt:'Pesquisa inteligente', tr:'Akıllı Arama', de:'Intelligente Suche', it:'Ricerca intelligente', zh:'智能搜索', ja:'スマート検索', ko:'스마트 검색', ru:'Умный поиск', hi:'स्मार्ट खोज', ur:'سمارٹ تلاش', fa:'جستجوی هوشمند', ms:'Carian Pintar', id:'Pencarian Pintar', sw:'Utafutaji Mahiri', ha:'Bincike Mai Hankali', am:'ብልጥ ፍለጋ' },
  'الصناعات':            { fr:'Industries', es:'Industrias', pt:'Indústrias', tr:'Sektörler', de:'Branchen', it:'Settori', zh:'行业', ja:'業界', ko:'산업', ru:'Отрасли', hi:'उद्योग', ur:'صنعتیں', fa:'صنایع', ms:'Industri', id:'Industri', sw:'Viwanda', ha:"Masana'antu", am:'ኢንዱስትሪዎች' },
  'الفورمولات':          { fr:'Formules', es:'Fórmulas', pt:'Fórmulas', tr:'Formüller', de:'Formeln', it:'Formule', zh:'配方', ja:'配合', ko:'공식', ru:'Формулы', hi:'फ़ॉर्मूले', ur:'فارمولے', fa:'فرمول‌ها', ms:'Formula', id:'Formula', sw:'Fomula', ha:'Tsare-tsaren Sinadarai', am:'ቀመሮች' },
  'الامتثال':            { fr:'Conformité', es:'Cumplimiento', pt:'Conformidade', tr:'Uyumluluk', de:'Compliance', it:'Conformità', zh:'合规', ja:'コンプライアンス', ko:'규정 준수', ru:'Соответствие', hi:'अनुपालन', ur:'تعمیل', fa:'انطباق', ms:'Pematuhan', id:'Kepatuhan', sw:'Ufuasi', ha:"Bin Ka'ida", am:'ተገዢነት' },
  'الأسعار':             { fr:'Tarifs', es:'Precios', pt:'Preços', tr:'Fiyatlandırma', de:'Preise', it:'Prezzi', zh:'价格', ja:'料金', ko:'요금', ru:'Цены', hi:'मूल्य', ur:'قیمتیں', fa:'قیمت‌گذاری', ms:'Harga', id:'Harga', sw:'Bei', ha:'Farashi', am:'ዋጋ' },
  'من نحن':              { fr:'À propos', es:'Acerca de', pt:'Sobre', tr:'Hakkında', de:'Über uns', it:'Chi siamo', zh:'关于', ja:'会社概要', ko:'소개', ru:'О нас', hi:'हमारे बारे में', ur:'ہمارے بارے میں', fa:'درباره', ms:'Tentang', id:'Tentang', sw:'Kuhusu', ha:'Game da Mu', am:'ስለ እኛ' },
  'تواصل':               { fr:'Contact', es:'Contacto', pt:'Contato', tr:'İletişim', de:'Kontakt', it:'Contatti', zh:'联系', ja:'お問い合わせ', ko:'연락처', ru:'Контакты', hi:'संपर्क', ur:'رابطہ', fa:'تماس', ms:'Hubungi', id:'Kontak', sw:'Mawasiliano', ha:'Tuntuɓi', am:'አግኙን' },
  'التوثيق':             { fr:'Documentation', es:'Documentación', pt:'Documentação', tr:'Belgeler', de:'Dokumentation', it:'Documentazione', zh:'文档', ja:'ドキュメント', ko:'문서', ru:'Документация', hi:'दस्तावेज़', ur:'دستاویزات', fa:'مستندات', ms:'Dokumentasi', id:'Dokumentasi', sw:'Hati', ha:'Takardu', am:'ሰነዶች' },
  'دخول':                { fr:'Connexion', es:'Iniciar sesión', pt:'Entrar', tr:'Giriş', de:'Anmelden', it:'Accedi', zh:'登录', ja:'ログイン', ko:'로그인', ru:'Войти', hi:'साइन इन', ur:'سائن ان', fa:'ورود', ms:'Log Masuk', id:'Masuk', sw:'Ingia', ha:'Shiga', am:'ግባ' },
  'حساب جديد':           { fr:"S'inscrire", es:'Registrarse', pt:'Cadastrar-se', tr:'Kayıt Ol', de:'Registrieren', it:'Registrati', zh:'注册', ja:'新規登録', ko:'가입하기', ru:'Регистрация', hi:'साइन अप', ur:'سائن اپ', fa:'ثبت‌نام', ms:'Daftar', id:'Daftar', sw:'Jisajili', ha:'Yi Rajista', am:'ይመዝገቡ' },
  'ابدأ مجاناً':          { fr:'Commencer gratuitement', es:'Empezar gratis', pt:'Começar grátis', tr:'Ücretsiz Başla', de:'Kostenlos starten', it:'Inizia gratis', zh:'免费开始', ja:'無料で始める', ko:'무료로 시작', ru:'Начать бесплатно', hi:'मुफ़्त शुरू करें', ur:'مفت شروع کریں', fa:'شروع رایگان', ms:'Mula Percuma', id:'Mulai Gratis', sw:'Anza Bure', ha:'Fara Kyauta', am:'በነፃ ጀምር' },
  'لوحة التحكم':          { fr:'Tableau de bord', es:'Panel', pt:'Painel', tr:'Kontrol Paneli', de:'Dashboard', it:'Dashboard', zh:'控制台', ja:'ダッシュボード', ko:'대시보드', ru:'Панель', hi:'डैशबोर्ड', ur:'ڈیش بورڈ', fa:'داشبورد', ms:'Papan Pemuka', id:'Dasbor', sw:'Dashibodi', ha:'Dashboard', am:'ዳሽቦርድ' },
  'بحث سريع':            { fr:'Recherche rapide', es:'Búsqueda rápida', pt:'Pesquisa rápida', tr:'Hızlı Arama', de:'Schnellsuche', it:'Ricerca rapida', zh:'快速搜索', ja:'クイック検索', ko:'빠른 검색', ru:'Быстрый поиск', hi:'त्वरित खोज', ur:'فوری تلاش', fa:'جستجوی سریع', ms:'Carian Pantas', id:'Pencarian Cepat', sw:'Tafuta Haraka', ha:'Bincike Mai Sauri', am:'ፈጣን ፍለጋ' },
  'احصل على API key':    { fr:'Obtenir une clé API', es:'Obtener clave API', pt:'Obter chave API', tr:'API Anahtarı Al', de:'API-Schlüssel holen', it:'Ottieni chiave API', zh:'获取 API 密钥', ja:'APIキーを取得', ko:'API 키 받기', ru:'Получить ключ API', hi:'API कुंजी प्राप्त करें', ur:'API key حاصل کریں', fa:'دریافت کلید API', ms:'Dapatkan Kunci API', id:'Dapatkan Kunci API', sw:'Pata Ufunguo wa API', ha:'Sami API key', am:'API ቁልፍ ያግኙ' },
  'تبديل الوضع':          { fr:'Changer de thème', es:'Cambiar tema', pt:'Alternar tema', tr:'Temayı Değiştir', de:'Design wechseln', it:'Cambia tema', zh:'切换主题', ja:'テーマを切替', ko:'테마 전환', ru:'Сменить тему', hi:'थीम बदलें', ur:'تھیم تبدیل کریں', fa:'تغییر تم', ms:'Tukar Tema', id:'Ganti Tema', sw:'Badili Mandhari', ha:'Sauya Jigo', am:'ገጽታ ቀይር' },
  'اشترك الآن':           { fr:'S’abonner', es:'Suscribirse', pt:'Assinar', tr:'Abone Ol', de:'Abonnieren', it:'Abbonati', zh:'订阅', ja:'登録する', ko:'구독하기', ru:'Подписаться', hi:'सदस्यता लें', ur:'سبسکرائب کریں', fa:'اشتراک', ms:'Langgan', id:'Berlangganan', sw:'Jiunge', ha:'Biyan Kuɗi', am:'ይመዝገቡ' },
  'تواصل مع المبيعات':    { fr:'Contacter les ventes', es:'Contactar ventas', pt:'Falar com vendas', tr:'Satışla İletişim', de:'Vertrieb kontaktieren', it:'Contatta vendite', zh:'联系销售', ja:'営業に問合わせ', ko:'영업팀 문의', ru:'Связаться с отделом продаж', hi:'सेल्स से संपर्क', ur:'سیلز سے رابطہ', fa:'تماس با فروش', ms:'Hubungi Jualan', id:'Hubungi Penjualan', sw:'Wasiliana na Mauzo', ha:'Tuntuɓi Sashen Sayarwa', am:'የሽያጭ ቡድንን አግኙ' },
  'شهري':                { fr:'Mensuel', es:'Mensual', pt:'Mensal', tr:'Aylık', de:'Monatlich', it:'Mensile', zh:'月度', ja:'月額', ko:'월간', ru:'Ежемесячно', hi:'मासिक', ur:'ماہانہ', fa:'ماهانه', ms:'Bulanan', id:'Bulanan', sw:'Kwa Mwezi', ha:'Wata-wata', am:'ወርሃዊ' },
  'سنوي\n          <span class="save-badge">وفر 20%</span>': { fr:'Annuel\n          <span class="save-badge">Économisez 20%</span>', es:'Anual\n          <span class="save-badge">Ahorra 20%</span>', pt:'Anual\n          <span class="save-badge">Poupe 20%</span>', tr:'Yıllık\n          <span class="save-badge">%20 Tasarruf</span>', de:'Jährlich\n          <span class="save-badge">20% sparen</span>', it:'Annuale\n          <span class="save-badge">Risparmia 20%</span>', zh:'年度\n          <span class="save-badge">节省 20%</span>', ja:'年額\n          <span class="save-badge">20% お得</span>', ko:'연간\n          <span class="save-badge">20% 할인</span>', ru:'Ежегодно\n          <span class="save-badge">Экономия 20%</span>', hi:'वार्षिक\n          <span class="save-badge">20% बचाएं</span>', ur:'سالانہ\n          <span class="save-badge">20% بچت</span>', fa:'سالانه\n          <span class="save-badge">۲۰٪ صرفه‌جویی</span>', ms:'Tahunan\n          <span class="save-badge">Jimat 20%</span>', id:'Tahunan\n          <span class="save-badge">Hemat 20%</span>', sw:'Kila Mwaka\n          <span class="save-badge">Okoa 20%</span>', ha:'Shekara-shekara\n          <span class="save-badge">Riba 20%</span>', am:'ዓመታዊ\n          <span class="save-badge">20% ቁጠባ</span>' },
  'شهرياً':              { fr:'/mois', es:'/mes', pt:'/mês', tr:'/ay', de:'/Monat', it:'/mese', zh:'/月', ja:'/月', ko:'/월', ru:'/мес.', hi:'/माह', ur:'/ماہ', fa:'/ماه', ms:'/bulan', id:'/bulan', sw:'/mwezi', ha:'/wata', am:'/ወር' },
  'شهرياً (يُدفع سنوياً)':  { fr:'/mois (facturé annuellement)', es:'/mes (facturación anual)', pt:'/mês (cobrado anualmente)', tr:'/ay (yıllık faturalandırılır)', de:'/Monat (jährlich abgerechnet)', it:'/mese (fatturato annualmente)', zh:'/月（按年计费）', ja:'/月（年額請求）', ko:'/월 (연간 청구)', ru:'/мес. (ежегодное списание)', hi:'/माह (वार्षिक बिल)', ur:'/ماہ (سالانہ بل)', fa:'/ماه (پرداخت سالانه)', ms:'/bulan (dibilkan setahun)', id:'/bulan (ditagih per tahun)', sw:'/mwezi (kulipwa kila mwaka)', ha:'/wata (a biya shekara-shekara)', am:'/ወር (በዓመት ይከፈላል)' },
  'إلى الأبد · مجاناً':   { fr:'Gratuit pour toujours', es:'Gratis para siempre', pt:'Grátis para sempre', tr:'Sonsuza dek ücretsiz', de:'Für immer kostenlos', it:'Gratis per sempre', zh:'永久免费', ja:'永久無料', ko:'영원히 무료', ru:'Бесплатно навсегда', hi:'हमेशा मुफ़्त', ur:'ہمیشہ مفت', fa:'همیشه رایگان', ms:'Percuma selamanya', id:'Gratis selamanya', sw:'Bure milele', ha:'Kyauta har abada', am:'ለዘላለም በነፃ' },
  '★ الأكثر شعبية':       { fr:'★ Le plus populaire', es:'★ Más popular', pt:'★ Mais popular', tr:'★ En Popüler', de:'★ Am beliebtesten', it:'★ Più popolare', zh:'★ 最受欢迎', ja:'★ 一番人気', ko:'★ 가장 인기', ru:'★ Самый популярный', hi:'★ सबसे लोकप्रिय', ur:'★ سب سے مقبول', fa:'★ پرطرفدارترین', ms:'★ Paling Popular', id:'★ Paling Populer', sw:'★ Maarufu Zaidi', ha:'★ Mafi Shahara', am:'★ ተወዳጅ' },
  'المبتدئ Starter':     { fr:'Débutant', es:'Inicial', pt:'Inicial', tr:'Başlangıç', de:'Starter', it:'Starter', zh:'入门版', ja:'スターター', ko:'스타터', ru:'Стартовый', hi:'स्टार्टर', ur:'اسٹارٹر', fa:'شروع', ms:'Pemula', id:'Pemula', sw:'Anzilishi', ha:'Mafarki', am:'መነሻ' },
  'المحترف Professional': { fr:'Professionnel', es:'Profesional', pt:'Profissional', tr:'Profesyonel', de:'Professional', it:'Professionale', zh:'专业版', ja:'プロフェッショナル', ko:'프로페셔널', ru:'Профессиональный', hi:'प्रोफेशनल', ur:'پروفیشنل', fa:'حرفه‌ای', ms:'Profesional', id:'Profesional', sw:'Mtaalamu', ha:'Ƙwararru', am:'ፕሮፌሽናል' },
  'الأعمال Business':    { fr:'Entreprise', es:'Negocio', pt:'Negócios', tr:'İşletme', de:'Business', it:'Business', zh:'企业版', ja:'ビジネス', ko:'비즈니스', ru:'Бизнес', hi:'बिज़नेस', ur:'بزنس', fa:'کسب‌وکار', ms:'Perniagaan', id:'Bisnis', sw:'Biashara', ha:'Kasuwanci', am:'ቢዝነስ' },
  'المؤسسات Enterprise': { fr:'Entreprise', es:'Empresarial', pt:'Empresarial', tr:'Kurumsal', de:'Enterprise', it:'Enterprise', zh:'企业级', ja:'エンタープライズ', ko:'엔터프라이즈', ru:'Корпоративный', hi:'एंटरप्राइज़', ur:'انٹرپرائز', fa:'سازمانی', ms:'Korporat', id:'Korporat', sw:'Shirika', ha:'Kungiyoyi', am:'ድርጅት' },
  'فورمولا جاهزة':        { fr:'Formules prêtes', es:'Fórmulas listas', pt:'Fórmulas prontas', tr:'Hazır formüller', de:'Fertige Formeln', it:'Formule pronte', zh:'现成配方', ja:'既製配合', ko:'준비된 공식', ru:'Готовые формулы', hi:'तैयार फ़ॉर्मूले', ur:'تیار فارمولے', fa:'فرمول‌های آماده', ms:'Formula sedia', id:'Formula siap', sw:'Fomula tayari', ha:'Daidaitawa a shirye', am:'ዝግጁ ቀመሮች' },
  'صناعة كيميائية':       { fr:'Industries chimiques', es:'Industrias químicas', pt:'Indústrias químicas', tr:'Kimya sektörü', de:'Chemiebranchen', it:'Settori chimici', zh:'化学行业', ja:'化学業界', ko:'화학 산업', ru:'Химические отрасли', hi:'रासायनिक उद्योग', ur:'کیمیائی صنعتیں', fa:'صنایع شیمیایی', ms:'Industri kimia', id:'Industri kimia', sw:'Viwanda vya kemikali', ha:"Masana'antun sinadarai", am:'የኬሚካል ኢንዱስትሪ' },
  'دولة مغطاة':          { fr:'Pays couverts', es:'Países cubiertos', pt:'Países cobertos', tr:'Kapsanan ülkeler', de:'Abgedeckte Länder', it:'Paesi coperti', zh:'覆盖国家', ja:'対応国', ko:'지원 국가', ru:'Покрытые страны', hi:'कवर किए देश', ur:'احاطہ کردہ ممالک', fa:'کشورهای تحت پوشش', ms:'Negara dilindungi', id:'Negara tercakup', sw:'Nchi zilizopo', ha:'Ƙasashen da aka rufe', am:'የተሸፈኑ አገሮች' },
  'دقة الفورمولات':       { fr:'Précision des formules', es:'Precisión de fórmulas', pt:'Precisão das fórmulas', tr:'Formül doğruluğu', de:'Formelgenauigkeit', it:'Precisione delle formule', zh:'配方精度', ja:'配合精度', ko:'공식 정확도', ru:'Точность формул', hi:'फ़ॉर्मूला सटीकता', ur:'فارمولا کی درستگی', fa:'دقت فرمول‌ها', ms:'Ketepatan formula', id:'Akurasi formula', sw:'Usahihi wa fomula', ha:'Tsayuwar daidai', am:'የቀመር ትክክለኛነት' },

  // Hero eyebrow (contains an inline SVG icon, preserved in every translation)
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> مدعوم بأحدث نماذج الذكاء الاصطناعي': {
    fr:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> Propulsé par les derniers modèles IA',
    es:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> Impulsado por los últimos modelos de IA',
    pt:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> Impulsionado pelos modelos de IA mais recentes',
    tr:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> En son AI modelleri tarafından desteklenir',
    de:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> Angetrieben von den neuesten KI-Modellen',
    it:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> Alimentato dai più recenti modelli AI',
    zh:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> 由最新 AI 模型驱动',
    ja:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> 最新の AI モデルを搭載',
    ko:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> 최신 AI 모델로 구동',
    ru:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> На основе новейших ИИ-моделей',
    hi:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> नवीनतम AI मॉडल द्वारा संचालित',
    ur:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> جدید ترین AI ماڈلز سے چلتا ہے',
    fa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> مبتنی بر آخرین مدل‌های هوش مصنوعی',
    ms:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> Dikuasakan oleh model AI terkini',
    id:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> Didukung oleh model AI terbaru',
    sw:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> Inawezeshwa na mifano ya AI ya hivi karibuni',
    ha:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> Tana aiki da sabbin ƙirar AI',
    am:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> በቅርብ ጊዜ AI ሞዴሎች የተደገፈ'
  },

  // Hero h1 (with gradient-text span + line break preserved in every translation)
  'أول منصة <span class="gradient-text">ذكاء اصطناعي كيميائي</span><br/>عالمية على الإطلاق': {
    fr:'La première <span class="gradient-text">plateforme chimique IA</span><br/>jamais créée au monde',
    es:'La primera <span class="gradient-text">plataforma química con IA</span><br/>jamás creada',
    pt:'A primeira <span class="gradient-text">plataforma química com IA</span><br/>já criada',
    tr:'Dünyanın ilk <span class="gradient-text">AI Kimya Platformu</span><br/>',
    de:'Die weltweit erste <span class="gradient-text">KI-Chemieplattform</span>',
    it:'La prima <span class="gradient-text">piattaforma chimica AI</span><br/>al mondo',
    zh:'全球首个<br/><span class="gradient-text">AI 化学平台</span>',
    ja:'世界初の<br/><span class="gradient-text">AI 化学プラットフォーム</span>',
    ko:'세계 최초의<br/><span class="gradient-text">AI 화학 플랫폼</span>',
    ru:'Первая в мире<br/><span class="gradient-text">AI-платформа химии</span>',
    hi:'दुनिया का पहला<br/><span class="gradient-text">AI केमिकल प्लेटफ़ॉर्म</span>',
    ur:'دنیا کا پہلا<br/><span class="gradient-text">AI کیمیائی پلیٹ فارم</span>',
    fa:'اولین <span class="gradient-text">پلتفرم شیمیایی هوش مصنوعی</span><br/>در جهان',
    ms:'<span class="gradient-text">Platform Kimia AI</span><br/>pertama di dunia',
    id:'<span class="gradient-text">Platform Kimia AI</span><br/>pertama di dunia',
    sw:'<span class="gradient-text">Jukwaa la Kemia la AI</span><br/>la kwanza duniani',
    ha:'<span class="gradient-text">Dandalin Sinadarai na AI</span><br/>na farko a duniya',
    am:'የዓለም የመጀመሪያ<br/><span class="gradient-text">AI ኬሚካል መድረክ</span>'
  },

  // Hero subtitle (long paragraph)
  'منصة Formula AI Global لاستخراج وتركيب وتدقيق الفورمولات الكيميائية، تغطي 40 صناعة، مع آلاف الفورمولات المُتحقَّق منها وقاعدة تنمو يوميًا، وذكاء اصطناعي يبحث ويقترح ويعدّل ويتعلّم من كتبك.': {
    fr:"Formula AI Global — extrayez, générez et validez des formulations chimiques dans 40 secteurs, avec des milliers de formules vérifiées et une IA qui recherche, suggère, modifie et apprend de vos propres livres.",
    es:'Formula AI Global — extrae, genera y valida formulaciones químicas en 40 industrias, con miles de fórmulas verificadas y una IA que busca, sugiere, modifica y aprende de tus propios libros.',
    pt:'Formula AI Global — extraia, gere e valide formulações químicas em 40 indústrias, com milhares de fórmulas verificadas e uma IA que pesquisa, sugere, modifica e aprende dos seus próprios livros.',
    tr:'Formula AI Global — 40 sektörde kimyasal formülasyonları çıkarın, üretin ve doğrulayın; binlerce doğrulanmış formül ve sizin kitaplarınızdan öğrenip arayan, öneren, değiştiren bir AI.',
    de:'Formula AI Global – extrahieren, erstellen und validieren Sie chemische Formulierungen in 40 Branchen, mit Tausenden verifizierten Formeln und einer KI, die sucht, vorschlägt, anpasst und aus Ihren Büchern lernt.',
    it:"Formula AI Global — estrai, genera e convalida formulazioni chimiche in 40 settori, con migliaia di formule verificate e un'IA che cerca, suggerisce, modifica e impara dai tuoi libri.",
    zh:'Formula AI Global — 在 40 个行业中提取、生成和验证化学配方，拥有数千个经过验证的配方，AI 可搜索、建议、修改并从您的书籍中学习。',
    ja:'Formula AI Global — 40 業界の化学配合を抽出・生成・検証。数千の検証済み配合と、あなたの本から学ぶ AI を備えています。',
    ko:'Formula AI Global — 40개 산업의 화학 제형을 추출, 생성, 검증. 검증된 수천 개의 공식과 책에서 학습하는 AI.',
    ru:'Formula AI Global — извлекайте, создавайте и проверяйте химические рецептуры в 40 отраслях, с тысячами проверенных формул и ИИ, который ищет, предлагает, изменяет и учится на ваших книгах.',
    hi:'Formula AI Global — 40 उद्योगों में रासायनिक फ़ॉर्मूलेशन निकालें, बनाएं और मान्य करें, हज़ारों सत्यापित फ़ॉर्मूलों और आपकी किताबों से सीखने वाली AI के साथ।',
    ur:'Formula AI Global — 40 صنعتوں میں کیمیائی فارمولیشنز نکالیں، بنائیں اور تصدیق کریں، ہزاروں تصدیق شدہ فارمولوں اور آپ کی کتابوں سے سیکھنے والی AI کے ساتھ۔',
    fa:'Formula AI Global — استخراج، تولید و اعتبارسنجی فرمولاسیون‌های شیمیایی در ۴۰ صنعت با هزاران فرمول تایید‌شده و هوش مصنوعی که از کتاب‌های شما یاد می‌گیرد.',
    ms:'Formula AI Global — ekstrak, jana, dan sahkan formulasi kimia dalam 40 industri, dengan beribu-ribu formula disahkan dan AI yang mencari, mencadang, mengubah suai dan belajar dari buku anda.',
    id:'Formula AI Global — ekstrak, buat, dan validasi formulasi kimia di 40 industri, dengan ribuan formula terverifikasi dan AI yang mencari, menyarankan, memodifikasi, dan belajar dari buku Anda.',
    sw:'Formula AI Global — toa, tengeneza, na uthibitishe mifumo ya kemikali katika viwanda 40, na maelfu ya fomula zilizothibitishwa na AI inayotafuta, kupendekeza, kubadilisha, na kujifunza kutoka kwa vitabu vyako.',
    ha:"Formula AI Global — fitar, ƙirƙira, da tabbatar da tsarukan sinadarai a masana'antu 40, tare da dubban tsare-tsare da aka tabbatar da AI da ke nemowa, ba da shawara, gyara, da koyo daga littattafanku.",
    am:'Formula AI Global — በ40 ኢንዱስትሪዎች ውስጥ የኬሚካል ቀመሮችን ያውጡ፣ ያመንጩ እና ያረጋግጡ፣ በሺዎች የተረጋገጡ ቀመሮች እና ከመጻሕፍትዎ የሚማር AI ጋር።'
  },

  // Hero CTAs
  'جرّب البحث الذكي': { fr:'Essayer la recherche intelligente', es:'Probar búsqueda inteligente', pt:'Experimentar pesquisa inteligente', tr:'Akıllı aramayı deneyin', de:'Intelligente Suche ausprobieren', it:'Prova la ricerca intelligente', zh:'试用智能搜索', ja:'スマート検索を試す', ko:'스마트 검색 시도', ru:'Попробовать умный поиск', hi:'स्मार्ट खोज आज़माएं', ur:'سمارٹ تلاش آزمائیں', fa:'جستجوی هوشمند را امتحان کنید', ms:'Cuba carian pintar', id:'Coba pencarian pintar', sw:'Jaribu utafutaji mahiri', ha:'Gwada bincike mai hankali', am:'ብልጥ ፍለጋን ይሞክሩ' },
  'شاهد الخطط':       { fr:'Voir les forfaits', es:'Ver planes', pt:'Ver planos', tr:'Planları görüntüle', de:'Pläne ansehen', it:'Vedi i piani', zh:'查看方案', ja:'プランを見る', ko:'요금제 보기', ru:'Посмотреть тарифы', hi:'योजनाएं देखें', ur:'منصوبے دیکھیں', fa:'مشاهده پلن‌ها', ms:'Lihat pelan', id:'Lihat paket', sw:'Tazama mipango', ha:'Duba tsare-tsare', am:'ፕላኖችን ይመልከቱ' },

  // Section: Features
  'المميزات الجوهرية': { fr:'Capacités essentielles', es:'Capacidades esenciales', pt:'Capacidades principais', tr:'Temel yetenekler', de:'Kernfunktionen', it:'Capacità principali', zh:'核心能力', ja:'主要機能', ko:'핵심 기능', ru:'Ключевые возможности', hi:'मुख्य क्षमताएं', ur:'بنیادی صلاحیتیں', fa:'قابلیت‌های اصلی', ms:'Keupayaan teras', id:'Kemampuan inti', sw:'Uwezo wa msingi', ha:'Manyan abubuwa', am:'ዋና ችሎታዎች' },
  'لماذا <span class="gradient-text">Formula AI</span>؟': { fr:'Pourquoi <span class="gradient-text">Formula AI</span> ?', es:'¿Por qué <span class="gradient-text">Formula AI</span>?', pt:'Por que <span class="gradient-text">Formula AI</span>?', tr:'Neden <span class="gradient-text">Formula AI</span>?', de:'Warum <span class="gradient-text">Formula AI</span>?', it:'Perché <span class="gradient-text">Formula AI</span>?', zh:'为什么选 <span class="gradient-text">Formula AI</span>？', ja:'なぜ <span class="gradient-text">Formula AI</span> ?', ko:'왜 <span class="gradient-text">Formula AI</span>?', ru:'Почему <span class="gradient-text">Formula AI</span>?', hi:'<span class="gradient-text">Formula AI</span> क्यों?', ur:'<span class="gradient-text">Formula AI</span> کیوں؟', fa:'چرا <span class="gradient-text">Formula AI</span>؟', ms:'Mengapa <span class="gradient-text">Formula AI</span>?', id:'Mengapa <span class="gradient-text">Formula AI</span>?', sw:'Kwa nini <span class="gradient-text">Formula AI</span>?', ha:'Me ya sa <span class="gradient-text">Formula AI</span>?', am:'ለምን <span class="gradient-text">Formula AI</span>?' },
  'ثماني قدرات استثنائية تجعل المنصة الأقوى في عالم الكيمياء الصناعية': { fr:'Huit capacités exceptionnelles qui font de cette plateforme la plus puissante de la chimie industrielle', es:'Ocho capacidades excepcionales que hacen de esta plataforma la más poderosa de la química industrial', pt:'Oito capacidades excepcionais que tornam esta plataforma a mais poderosa da química industrial', tr:'Bu platformu endüstriyel kimyada en güçlü kılan sekiz olağanüstü yetenek', de:'Acht außergewöhnliche Fähigkeiten machen diese Plattform zur stärksten in der industriellen Chemie', it:'Otto capacità eccezionali che rendono questa piattaforma la più potente nella chimica industriale', zh:'让这个平台成为工业化学领域最强大的八项卓越能力', ja:'このプラットフォームを工業化学で最も強力にする 8 つの優れた機能', ko:'이 플랫폼을 산업 화학에서 가장 강력하게 만드는 8가지 뛰어난 기능', ru:'Восемь исключительных возможностей делают эту платформу самой мощной в промышленной химии', hi:'आठ असाधारण क्षमताएं जो इस प्लेटफ़ॉर्म को औद्योगिक रसायन विज्ञान में सबसे शक्तिशाली बनाती हैं', ur:'آٹھ غیر معمولی صلاحیتیں جو اس پلیٹ فارم کو صنعتی کیمسٹری میں سب سے طاقتور بناتی ہیں', fa:'هشت قابلیت استثنایی که این پلتفرم را قدرتمندترین در شیمی صنعتی می‌سازد', ms:'Lapan keupayaan luar biasa yang menjadikan platform ini paling berkuasa dalam kimia industri', id:'Delapan kemampuan luar biasa yang menjadikan platform ini paling kuat dalam kimia industri', sw:'Uwezo nane wa kipekee unaofanya jukwaa hili kuwa lenye nguvu zaidi katika kemia ya viwanda', ha:"Manyan iyawa takwas da ke sa wannan dandali ya zama mafi ƙarfi a sinadarai na masana'antu", am:'ይህን መድረክ በኢንዱስትሪ ኬሚስትሪ ውስጥ በጣም ኃይለኛ የሚያደርጉ ስምንት ልዩ ችሎታዎች' },

  // ─── Pricing page hero ──────────────────────────────────────────────
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> خطط مرنة لكل مرحلة': {
    fr:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> Forfaits flexibles à chaque étape',
    es:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> Planes flexibles para cada etapa',
    pt:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> Planos flexíveis para cada fase',
    tr:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> Her aşama için esnek planlar',
    de:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> Flexible Pläne für jede Phase',
    it:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> Piani flessibili per ogni fase',
    zh:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> 每个阶段都有灵活方案',
    ja:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> あらゆる段階に対応する柔軟なプラン',
    ko:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> 모든 단계를 위한 유연한 요금제',
    ru:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> Гибкие тарифы для любого этапа',
    hi:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> हर चरण के लिए लचीले प्लान',
    ur:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> ہر مرحلے کے لیے لچکدار منصوبے',
    fa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> پلن‌های انعطاف‌پذیر برای هر مرحله',
    ms:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> Pelan fleksibel untuk setiap peringkat',
    id:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> Paket fleksibel untuk setiap tahap',
    sw:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> Mipango rahisi kwa kila hatua',
    ha:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> Tsare-tsare masu sauƙi ga kowane mataki',
    am:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M16 8L8 16M8 8l8 8"/></svg> ለእያንዳንዱ ደረጃ ተለዋዋጭ ፕላኖች'
  },

  'اختر خطتك <span class="gradient-text">المثالية</span>': {
    fr:'Choisissez votre <span class="gradient-text">plan idéal</span>',
    es:'Elige tu <span class="gradient-text">plan ideal</span>',
    pt:'Escolha o seu <span class="gradient-text">plano ideal</span>',
    tr:'<span class="gradient-text">İdeal planınızı</span> seçin',
    de:'Wählen Sie Ihren <span class="gradient-text">perfekten Plan</span>',
    it:'Scegli il tuo <span class="gradient-text">piano perfetto</span>',
    zh:'选择您的<span class="gradient-text">完美方案</span>',
    ja:'<span class="gradient-text">最適なプラン</span>を選択',
    ko:'<span class="gradient-text">완벽한 요금제</span>를 선택하세요',
    ru:'Выберите ваш <span class="gradient-text">идеальный тариф</span>',
    hi:'अपना <span class="gradient-text">परफेक्ट प्लान</span> चुनें',
    ur:'اپنا <span class="gradient-text">بہترین منصوبہ</span> منتخب کریں',
    fa:'<span class="gradient-text">پلن ایده‌آل</span> خود را انتخاب کنید',
    ms:'Pilih <span class="gradient-text">pelan sempurna</span> anda',
    id:'Pilih <span class="gradient-text">paket sempurna</span> Anda',
    sw:'Chagua <span class="gradient-text">mpango wako kamili</span>',
    ha:'Zaɓi <span class="gradient-text">tsarinka mafi kyau</span>',
    am:'<span class="gradient-text">ፍጹም ፕላንዎን</span> ይምረጡ'
  },

  'ابدأ مجاناً وارتقِ مع نمو أعمالك - بدون رسوم خفية، بدون التزامات طويلة الأمد. ألغِ في أي وقت.': {
    fr:"Commencez gratuitement et évoluez avec votre entreprise — aucun frais caché, aucun engagement à long terme. Annulez à tout moment.",
    es:'Empieza gratis y crece con tu negocio — sin tarifas ocultas, sin compromisos a largo plazo. Cancela cuando quieras.',
    pt:'Comece grátis e cresça com seu negócio — sem taxas ocultas, sem compromissos de longo prazo. Cancele a qualquer momento.',
    tr:'Ücretsiz başlayın ve işletmenizle birlikte büyüyün — gizli ücret yok, uzun vadeli taahhüt yok. İstediğiniz zaman iptal edin.',
    de:'Kostenlos starten und mit Ihrem Unternehmen skalieren — keine versteckten Gebühren, keine langfristigen Verpflichtungen. Jederzeit kündbar.',
    it:'Inizia gratis e cresci con la tua attività — nessun costo nascosto, nessun impegno a lungo termine. Annulla in qualsiasi momento.',
    zh:'免费开始并随业务增长扩展 — 无隐藏费用，无长期承诺。随时取消。',
    ja:'無料で始めて事業の成長に合わせて拡張 — 隠れた費用なし、長期契約なし。いつでもキャンセル可能。',
    ko:'무료로 시작하고 비즈니스 성장에 맞춰 확장 — 숨은 비용 없음, 장기 약정 없음. 언제든 취소 가능.',
    ru:'Начните бесплатно и масштабируйтесь по мере роста бизнеса — без скрытых платежей, без долгосрочных обязательств. Отменяйте в любой момент.',
    hi:'मुफ़्त शुरू करें और अपने व्यवसाय के साथ बढ़ें — कोई छिपी फ़ीस नहीं, कोई दीर्घकालिक प्रतिबद्धता नहीं। कभी भी रद्द करें।',
    ur:'مفت شروع کریں اور اپنے کاروبار کے ساتھ ترقی کریں — کوئی پوشیدہ فیس نہیں، کوئی طویل مدتی عہد نہیں۔ کسی بھی وقت منسوخ کریں۔',
    fa:'رایگان شروع کنید و با رشد کسب‌وکارتان مقیاس دهید — بدون هزینه‌های پنهان، بدون تعهدات بلندمدت. هر زمان لغو کنید.',
    ms:'Mula percuma dan kembang dengan perniagaan anda — tiada bayaran tersembunyi, tiada komitmen jangka panjang. Batal bila-bila masa.',
    id:'Mulai gratis dan kembangkan seiring bisnis Anda — tanpa biaya tersembunyi, tanpa komitmen jangka panjang. Batalkan kapan saja.',
    sw:'Anza bure na ukue pamoja na biashara yako — hakuna ada za siri, hakuna ahadi za muda mrefu. Ghairi wakati wowote.',
    ha:'Fara kyauta kuma yi girma tare da kasuwancin ka — babu kuɗin ɓoye, babu alkawura na dogon lokaci. Soke a kowane lokaci.',
    am:'በነጻ ይጀምሩ እና ከንግድዎ ጋር ያስፋፉ — ምንም ድብቅ ክፍያ የለም፣ ምንም የረጅም ጊዜ ቃል ኪዳን የለም። በማንኛውም ጊዜ መሰረዝ ይችላሉ።'
  },

  // Feature card titles (8)
  'ذاكرة دردشة أبدية':              { fr:'Mémoire de chat éternelle', es:'Memoria de chat eterna', pt:'Memória de chat eterna', tr:'Sonsuz sohbet hafızası', de:'Ewiges Chat-Gedächtnis', it:'Memoria chat eterna', zh:'永久聊天记忆', ja:'永久チャットメモリ', ko:'영원한 채팅 기억', ru:'Вечная память чата', hi:'हमेशा की चैट मेमोरी', ur:'ہمیشہ کی چیٹ میموری', fa:'حافظه چت همیشگی', ms:'Memori sembang kekal', id:'Memori obrolan abadi', sw:'Kumbukumbu ya gumzo la milele', ha:'Tunatarwar tattaunawa har abada', am:'ለዘላለም የሚቆይ ቻት ማህደረ ትውስታ' },
  'آلاف الفورمولا مع المصدر':     { fr:'Milliers de formules avec source', es:'Miles de fórmulas con fuente', pt:'Milhares de fórmulas com fonte', tr:'Kaynaklı binlerce formül', de:'Tausende Formeln mit Quelle', it:'Migliaia di formule con fonte', zh:'数千个含来源的配方', ja:'数千の出典付き配合', ko:'출처 포함 수천 개 공식', ru:'Тысячи формул с источником', hi:'स्रोत सहित हज़ारों फ़ॉर्मूले', ur:'ماخذ کے ساتھ ہزاروں فارمولے', fa:'هزاران فرمول با منبع', ms:'Ribuan formula dengan sumber', id:'Ribuan formula dengan sumber', sw:'Maelfu ya fomula zenye chanzo', ha:'Dubban tsare-tsare tare da tushe', am:'ሺዎች ምንጭ ያላቸው ቀመሮች' },
  'امتثال تنظيمي عالمي':            { fr:'Conformité réglementaire mondiale', es:'Cumplimiento normativo mundial', pt:'Conformidade regulatória global', tr:'Küresel mevzuat uyumu', de:'Globale Regulierungs-Compliance', it:'Conformità normativa globale', zh:'全球合规', ja:'グローバル規制遵守', ko:'글로벌 규정 준수', ru:'Глобальное соответствие нормам', hi:'वैश्विक नियामक अनुपालन', ur:'عالمی ریگولیٹری تعمیل', fa:'انطباق با مقررات جهانی', ms:'Pematuhan kawal selia global', id:'Kepatuhan regulasi global', sw:'Utii wa kanuni za kimataifa', ha:"Bin ka'idoji na duniya", am:'ዓለም አቀፍ የቁጥጥር ተገዢነት' },
  '4 درجات اقتصادية لكل فورمولا':    { fr:'4 niveaux économiques par formule', es:'4 niveles económicos por fórmula', pt:'4 níveis econômicos por fórmula', tr:'Formül başına 4 ekonomik seviye', de:'4 Wirtschaftsstufen pro Formel', it:'4 livelli economici per formula', zh:'每个配方 4 个经济等级', ja:'配合あたり 4 つの経済グレード', ko:'공식당 4가지 경제 등급', ru:'4 экономических класса на формулу', hi:'प्रति फ़ॉर्मूला 4 आर्थिक ग्रेड', ur:'فی فارمولا 4 معاشی درجے', fa:'۴ سطح اقتصادی برای هر فرمول', ms:'4 gred ekonomi setiap formula', id:'4 tingkat ekonomi per formula', sw:'Madaraja 4 ya kiuchumi kwa kila fomula', ha:'Matakai 4 na tattalin arziki kowane tsari', am:'በቀመር 4 ኢኮኖሚያዊ ደረጃዎች' },
  'كاشف التعارضات':                  { fr:'Détecteur de conflits', es:'Detector de conflictos', pt:'Detector de conflitos', tr:'Çatışma dedektörü', de:'Konflikterkennung', it:'Rilevatore di conflitti', zh:'冲突检测器', ja:'競合検出器', ko:'충돌 감지기', ru:'Детектор конфликтов', hi:'संघर्ष डिटेक्टर', ur:'تنازع کا پتہ لگانے والا', fa:'تشخیص‌دهنده تداخل', ms:'Pengesan konflik', id:'Pendeteksi konflik', sw:'Kigunduzi cha mgongano', ha:'Mai gano sabani', am:'የግጭት መለያ' },
  'صديقة للبيئة بالضرورة':           { fr:"Écologique par conception", es:'Ecológico por diseño', pt:'Ecológico por design', tr:'Tasarım gereği çevre dostu', de:'Umweltfreundlich konzipiert', it:'Ecologico per design', zh:'环保设计', ja:'設計から環境に優しい', ko:'설계상 친환경', ru:'Экологичный по дизайну', hi:'डिज़ाइन से पर्यावरण अनुकूल', ur:'ڈیزائن سے ماحول دوست', fa:'سازگار با محیط زیست', ms:'Mesra alam secara reka bentuk', id:'Ramah lingkungan secara desain', sw:'Rafiki wa mazingira kwa muundo', ha:'Mai dacewa da muhalli', am:'በንድፍ ለአካባቢ ተስማሚ' },
  '20 لغة + ذكاء يفهم لغتك':         { fr:'20 langues + IA qui parle la vôtre', es:'20 idiomas + IA que habla el tuyo', pt:'20 idiomas + IA que fala o seu', tr:'20 dil + sizin dilinizi konuşan AI', de:'20 Sprachen + KI, die Ihre spricht', it:'20 lingue + IA che parla la tua', zh:'20 种语言 + 懂你语言的 AI', ja:'20 言語 + あなたの言語を話す AI', ko:'20개 언어 + 당신의 언어를 하는 AI', ru:'20 языков + ИИ, говорящий на вашем', hi:'20 भाषाएं + आपकी भाषा बोलने वाला AI', ur:'20 زبانیں + آپ کی زبان بولنے والا AI', fa:'۲۰ زبان + هوش مصنوعی که زبان شما را می‌فهمد', ms:'20 bahasa + AI yang bercakap bahasa anda', id:'20 bahasa + AI yang berbicara bahasa Anda', sw:'Lugha 20 + AI inayozungumza yako', ha:'Harsuna 20 + AI da ke magana harshenku', am:'20 ቋንቋዎች + የእርስዎን የሚናገር AI' },
  'تعلم مستمر ذاتي':                  { fr:'Auto-apprentissage continu', es:'Auto-aprendizaje continuo', pt:'Auto-aprendizagem contínua', tr:'Sürekli kendi kendine öğrenme', de:'Kontinuierliches Selbstlernen', it:'Auto-apprendimento continuo', zh:'持续自我学习', ja:'継続的な自己学習', ko:'지속적인 자기 학습', ru:'Непрерывное самообучение', hi:'निरंतर स्व-शिक्षण', ur:'مسلسل خود سیکھنا', fa:'یادگیری مستمر خودکار', ms:'Pembelajaran kendiri berterusan', id:'Pembelajaran mandiri berkelanjutan', sw:'Kujifunza mwenyewe kuendelea', ha:'Koyon kai mai ci gaba', am:'ቀጣይ ራስን ማስተማር' }
};

function faiLookupDict(arabic, code) {
  if (!arabic) return null;
  const entry = FAI_DICT[arabic];
  return entry ? (entry[code] || null) : null;
}

// Apply translation to all elements with a data-i18n-XX attribute (other than en).
// English is the canonical source: text in HTML innerHTML is the English version,
// which we cache on first run. Inline data-i18n-<code> wins; if missing for a given
// language, we consult FAI_DICT keyed by the Arabic source. data-i18n-attr swaps
// attribute values via data-i18n-<attr>-<lang> with the same fallback chain.
function faiApplyLang(code) {
  const lang = FAI_LANGUAGES.find(l => l.code === code) || FAI_LANGUAGES[0];
  const dir = lang.dir;

  document.documentElement.setAttribute('lang', code);
  document.documentElement.setAttribute('dir', dir);

  // Find every element that has at least one data-i18n-XX (non-en) attribute.
  const sel = FAI_LANGUAGES
    .filter(l => l.code !== 'en')
    .map(l => `[data-i18n-${l.code}]`)
    .join(',');

  document.querySelectorAll(sel).forEach(el => {
    if (!el.hasAttribute('data-i18n-en-cache')) {
      el.setAttribute('data-i18n-en-cache', el.innerHTML);
    }
    if (code === 'en') {
      el.innerHTML = el.getAttribute('data-i18n-en-cache');
      return;
    }
    const inline = el.getAttribute(`data-i18n-${code}`);
    const arabic = el.getAttribute('data-i18n-ar');
    const fromDict = faiLookupDict(arabic, code);
    el.innerHTML = inline || fromDict || el.getAttribute('data-i18n-en-cache');
  });

  // Translate attribute values (placeholder / title / aria-label)
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const attrs = el.getAttribute('data-i18n-attr').split('|');
    attrs.forEach(a => {
      const cacheKey = `data-i18n-${a}-en-cache`;
      if (!el.hasAttribute(cacheKey)) {
        el.setAttribute(cacheKey, el.getAttribute(a) || '');
      }
      if (code === 'en') {
        el.setAttribute(a, el.getAttribute(cacheKey));
        return;
      }
      const inline = el.getAttribute(`data-i18n-${a}-${code}`);
      const arabic = el.getAttribute(`data-i18n-${a}-ar`);
      const fromDict = faiLookupDict(arabic, code);
      el.setAttribute(a, inline || fromDict || el.getAttribute(cacheKey));
    });
  });
}

(function initLangSwitcher() {
  const trigger = document.querySelector('.lang-trigger');
  const menu = document.querySelector('.lang-menu');

  // Build menu (only if widget present on page)
  if (trigger && menu) {
    menu.innerHTML = FAI_LANGUAGES.map(l => `
      <div class="lang-item" data-code="${l.code}" data-dir="${l.dir}">
        <span class="flag">${l.flag}</span>
        <span class="name">${l.name}</span>
        <span class="code">${l.code}</span>
      </div>
    `).join('');
  }

  // Default = English. Load saved choice if any.
  const saved = localStorage.getItem('fai_lang') || 'en';

  const setActive = (code) => {
    if (menu) menu.querySelectorAll('.lang-item').forEach(it => it.classList.toggle('active', it.dataset.code === code));
    const lang = FAI_LANGUAGES.find(l => l.code === code) || FAI_LANGUAGES[0];
    if (trigger) {
      trigger.querySelector('.flag').textContent = lang.flag;
      trigger.querySelector('.label').textContent = lang.code.toUpperCase();
    }
  };

  // Apply saved (or default) language on page load BEFORE user interaction
  faiApplyLang(saved);
  setActive(saved);

  if (!trigger || !menu) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });

  document.addEventListener('click', () => menu.classList.remove('open'));

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.lang-item');
    if (!item) return;
    const code = item.dataset.code;
    localStorage.setItem('fai_lang', code);
    setActive(code);
    faiApplyLang(code);
    menu.classList.remove('open');
  });
})();

/* ============================================
   Dashboard Chat Demo (Forever Memory)
   ============================================ */
(function initChat() {
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  if (!chatMessages || !chatInput) return;

  const SAMPLE_REPLIES = {
    default: 'سأبحث في آلاف الفورمولا… وجدت أفضل تركيبة بدرجة ثقة 96%. هل تريد عرض المكونات بالنسب أم تصدير PDF؟',
    شامبو: 'فورمولا شامبو طبيعي للشعر الجاف · 9 مكونات · 100% متوازنة · مصدر: Solverchem Encyclopedia 2023 · امتثال FDA + ECHA + SFDA · صديقة للبيئة ✓',
    كريم: 'فورمولا كريم مرطب للبشرة الحساسة · 9 مكونات · مصدر: US Patent 9,234,567 · حالة: متوافق مع 195 دولة',
    منظف: 'منظف أرضيات صناعي · 8 مكونات · درجة اقتصادية متاحة بسعر 1.2$/كغ · مصدر: ResearchGate paper 2024',
    مطهر: 'مطهر مستشفيات واسع الطيف · معتمد من WHO · حالة: مخالف بـ 1 دولة، تعديل التركيز ينقل لـ متوافق'
  };

  function append(role, text) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.innerHTML = `
      <div class="avatar">${role === 'user' ? 'أنت' : 'AI'}</div>
      <div class="bubble">${text}</div>
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function reply(query) {
    const q = query.toLowerCase();
    let answer = SAMPLE_REPLIES.default;
    for (const k of Object.keys(SAMPLE_REPLIES)) {
      if (k !== 'default' && q.includes(k)) { answer = SAMPLE_REPLIES[k]; break; }
    }
    setTimeout(() => append('ai', answer), 600);
  }

  function send() {
    const v = chatInput.value.trim();
    if (!v) return;
    append('user', v);
    chatInput.value = '';
    reply(v);
  }

  chatSend?.addEventListener('click', send);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // Click on chat history loads a pseudo-conversation
  document.querySelectorAll('.chat-history-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.chat-history-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      // No actual reload — demo only
    });
  });
})();
