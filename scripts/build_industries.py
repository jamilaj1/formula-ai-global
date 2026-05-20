"""build_industries.py — generate 40 industry landing pages.

For each industry: pulls top formulas from Supabase (by category, ordered
by trust_score), renders a self-contained HTML landing page into
`industries/<slug>.html`, and writes `industries/index.html` listing
all 40. Re-run idempotently after data changes.

Env (same as build_sitemap.py):
    SUPABASE_URL, SUPABASE_ANON_KEY  (RLS lets anon SELECT on `formulas`)

Each generated page has:
  • Unique <title>, meta description, canonical, OG tags
  • Schema.org ItemList JSON-LD for the featured formulas
  • Up to 12 formula cards linking to /formula.html?id=...
  • Pricing CTA (members-only positioning, consistent with Phase 3)
"""
from __future__ import annotations
import datetime as _dt
import html
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "industries"
OUT_DIR.mkdir(exist_ok=True)
SITE = "https://jamilformula.com"
TODAY = _dt.date.today().isoformat()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = (os.environ.get("SUPABASE_SERVICE_KEY")
       or os.environ.get("SUPABASE_ANON_KEY") or "")
if not SUPABASE_URL or not KEY:
    print("ERROR: set SUPABASE_URL and SUPABASE_ANON_KEY in env.", file=sys.stderr)
    sys.exit(2)

# (slug, English title, Arabic title, [DB categories], tagline_en, tagline_ar)
INDUSTRIES: list[tuple] = [
    ("hair-care", "Hair Care", "العناية بالشعر", ["hair_care"],
     "Shampoos, conditioners, treatments — verified formulations.",
     "شامبوهات وبلسم وعلاجات — تركيبات موثّقة."),
    ("skin-care", "Skin Care", "العناية بالبشرة", ["skin_care"],
     "Cleansers, serums, moisturizers, treatments.",
     "غسولات، سيرومات، مرطّبات، علاجات."),
    ("anti-aging", "Anti-Aging Skincare", "العناية ضد الشيخوخة", ["skincare_anti_aging"],
     "Targeted formulations for fine lines, firmness and radiance.",
     "تركيبات مستهدفة للخطوط الدقيقة والشدّ والإشراق."),
    ("brightening", "Brightening Skincare", "تفتيح البشرة", ["skincare_brightening"],
     "Niacinamide, vitamin C, kojic acid — verified brightening systems.",
     "النياسيناميد، فيتامين C، حمض الكوجيك — أنظمة تفتيح موثّقة."),
    ("body-care", "Body Care", "العناية بالجسم", ["body_care"],
     "Body washes, lotions, scrubs, butters.",
     "غسولات وكريمات وسكرابات وزبدات الجسم."),
    ("personal-hygiene", "Personal Hygiene", "النظافة الشخصية", ["personal_hygiene"],
     "Hand washes, soaps, sanitizers, intimate care.",
     "غسولات اليدين، الصابون، المعقّمات، العناية الحميمة."),
    ("oral-care", "Oral Care", "العناية بالفم والأسنان", ["oral_care"],
     "Toothpastes, mouthwashes, whitening systems.",
     "معاجين الأسنان، غسولات الفم، أنظمة التبييض."),
    ("lip-care", "Lip Care", "العناية بالشفاه", ["lip_care"],
     "Lip balms, plumpers, treatments.",
     "بلسم الشفاه، مكثّفات، علاجات."),
    ("face-makeup", "Face Makeup", "مكياج الوجه", ["face_makeup"],
     "Foundations, concealers, BB/CC — pigment systems.",
     "فاونديشن، كونسيلر، BB/CC — أنظمة الصبغات."),
    ("face-masks", "Face Masks", "أقنعة الوجه", ["face_mask"],
     "Clay, sheet, peel-off, hydrogel.",
     "طين، شيت، بيل-أوف، هيدروجل."),
    ("color-cosmetics", "Color Cosmetics", "مستحضرات الألوان", ["color_cosmetics"],
     "Lipsticks, eyeliners, mascaras — verified pigment formulations.",
     "أحمر شفاه، أيلاينر، مسكرة — تركيبات صبغات موثّقة."),
    ("hair-removal", "Hair Removal", "إزالة الشعر", ["hair_removal"],
     "Waxes, depilatory creams — safe, verified systems.",
     "شموع، كريمات إزالة — أنظمة آمنة موثّقة."),
    ("cleaning", "Cleaning Products", "منتجات التنظيف", ["cleaning"],
     "All-purpose, surface, floor, glass.",
     "متعدد الأغراض، أسطح، أرضيات، زجاج."),
    ("disinfectants", "Disinfectants", "المطهّرات", ["disinfectants"],
     "Hospital-grade, surface, hand sanitizers.",
     "بدرجة المستشفيات، أسطح، معقّمات يدين."),
    ("laundry", "Laundry Detergents", "منظّفات الغسيل", ["laundry"],
     "Liquid, powder, capsules, fabric softeners.",
     "سائلة، مسحوق، كبسولات، منعّمات."),
    ("dishwashing", "Dishwashing", "غسيل الصحون", ["dishwashing"],
     "Hand and machine dishwashing systems.",
     "غسيل صحون يدوي وآلي."),
    ("household", "Household", "منتجات منزلية", ["household"],
     "Air-fresheners, deodorisers, polishes.",
     "معطّرات جو، مزيلات روائح، ملمّعات."),
    ("home-fragrance", "Home Fragrance", "عطور المنزل", ["home_fragrance"],
     "Diffusers, room sprays, candles.",
     "ديفيوزر، بخاخات غرف، شموع."),
    ("automotive", "Automotive Chemicals", "كيماويات السيارات", ["automotive"],
     "Car wash, polish, coolants, lubricants.",
     "غسيل سيارات، تلميع، مبرّدات، زيوت."),
    ("industrial", "Industrial Chemicals", "كيماويات صناعية", ["industrial"],
     "Process chemistry, machinery, plant operations.",
     "كيمياء العمليات، الماكينات، تشغيل المصانع."),
    ("agriculture", "Agriculture & Agrochemicals", "الزراعة والكيماويات الزراعية", ["agriculture"],
     "Fertilizers, micronutrients, plant-protection.",
     "أسمدة، عناصر صغرى، حماية النبات."),
    ("food-beverage", "Food & Beverage", "الأغذية والمشروبات", ["food_beverage"],
     "Emulsifiers, stabilizers, flavor systems.",
     "مستحلبات، مثبّتات، أنظمة نكهات."),
    ("pet-care", "Pet Care", "العناية بالحيوانات الأليفة", ["pet_care"],
     "Pet shampoos, sprays, hygiene.",
     "شامبوهات حيوانات أليفة، بخاخات، نظافة."),
    ("adhesives", "Adhesives", "اللاصقات", ["adhesives"],
     "Glues, bonding agents, sealants.",
     "غراء، عوامل لصق، حشوات."),
    ("coatings", "Coatings", "الطلاءات", ["coatings"],
     "Protective, decorative, functional coatings.",
     "طلاءات حماية، زخرفية، وظيفية."),
    ("paints", "Paints", "الدهانات", ["paint_coating"],
     "Architectural, industrial, automotive paints.",
     "دهانات معمارية، صناعية، سيارات."),
    ("glass-ceramics", "Glass & Ceramics", "زجاج وسيراميك", ["glass_ceramics"],
     "Cleaners, polishes, surface treatments.",
     "منظّفات، ملمّعات، معالجات أسطح."),
    ("specialty", "Specialty Chemicals", "كيماويات متخصّصة", ["specialty"],
     "Niche, performance-grade formulations.",
     "تركيبات متخصّصة عالية الأداء."),
    ("pool-water", "Pool Water Treatment", "معالجة مياه المسابح", ["pool_water_treatment"],
     "Chlorination, pH balance, algae control.",
     "الكلورة، توازن pH، مكافحة الطحالب."),
    ("water-treatment", "Water Treatment", "معالجة المياه", ["water_treatment"],
     "Coagulants, scale inhibitors, disinfection.",
     "معاملات، مثبّطات الترسّب، التطهير."),
    ("boiler-cooling", "Boiler & Cooling", "الغلايات والتبريد", ["boiler_cooling"],
     "Corrosion inhibitors, scale control, biocides.",
     "مثبّطات تآكل، تحكّم بالترسّب، مبيدات حيوية."),
    ("metal-treatment", "Metal Treatment", "معالجة المعادن", ["metal_treatment"],
     "Pickling, passivation, plating, degreasing.",
     "تخليل، تخميل، طلاء، إزالة شحوم."),
    ("body-treatment", "Body Treatment", "علاجات الجسم", ["body_treatment"],
     "Slimming, firming, massage systems.",
     "تنحيف، شدّ، أنظمة مساج."),
    ("topical-analgesic", "Topical Analgesics", "مسكّنات موضعية", ["topical_analgesic"],
     "Pain-relief gels, balms, patches.",
     "جلّ، بلسم، لاصقات تخفيف الألم."),
    ("massage", "Massage", "المساج", ["massage"],
     "Oils, creams, professional massage systems.",
     "زيوت، كريمات، أنظمة مساج احترافية."),
    ("pest-control", "Pest Control", "مكافحة الآفات", ["pest_control"],
     "Insecticides, rodenticides, repellents.",
     "مبيدات حشرية، قوارض، طاردات."),
    ("stationery", "Stationery", "أدوات مكتبية", ["stationery"],
     "Inks, glues, correction systems.",
     "أحبار، صمغ، أنظمة تصحيح."),
    # cross-category groupings to reach the round 40
    ("personal-care", "Personal Care (All)", "العناية الشخصية (كاملة)",
     ["hair_care", "skin_care", "body_care", "personal_hygiene", "oral_care"],
     "Everything that touches the human body — across all categories.",
     "كل ما يلامس الجسم البشري — عبر جميع الفئات."),
    ("sanitation", "Sanitation & Hygiene", "النظافة والتعقيم",
     ["cleaning", "disinfectants", "personal_hygiene"],
     "End-to-end sanitation: surfaces, hands, healthcare environments.",
     "حلول تعقيم شاملة: أسطح، أيدٍ، بيئات صحية."),
    ("heavy-industry", "Heavy Industry", "الصناعات الثقيلة",
     ["industrial", "metal_treatment", "boiler_cooling", "coatings"],
     "Chemistry that powers refineries, factories and infrastructure.",
     "الكيمياء التي تشغّل المصافي والمصانع والبنية التحتية."),
]
assert len(INDUSTRIES) == 40, f"need exactly 40 industries, have {len(INDUSTRIES)}"


def fetch_formulas_for(cats: list[str], limit: int = 12) -> list[dict]:
    cats_in = ",".join('"' + c.replace('"', '') + '"' for c in cats)
    url = (f"{SUPABASE_URL}/rest/v1/formulas?"
           f"select=id,name,name_en,category,sub_category,form_type,trust_score,components"
           f"&category=in.({cats_in})&order=trust_score.desc&limit={limit}")
    req = urllib.request.Request(url, headers={
        "apikey": KEY, "Authorization": f"Bearer {KEY}",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


NAV_HTML = '''  <nav class="navbar">
    <div class="container nav-inner">
      <a href="../index.html" class="logo">
        <span class="logo-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/></svg></span>
        Formula <span>AI</span>
      </a>
      <ul class="nav-links">
        <li><a href="../index.html" data-i18n-ar="الرئيسية">Home</a></li>
        <li><a href="../encyclopedia.html" data-i18n-ar="مكتبة الفورمولا">Formula Library</a></li>
        <li><a href="../search.html" data-i18n-ar="البحث الذكي">Smart Search</a></li>
        <li><a href="../industries/index.html" class="active" data-i18n-ar="الصناعات">Industries</a></li>
        <li><a href="../pricing.html" data-i18n-ar="الأسعار">Pricing</a></li>
      </ul>
      <div class="nav-tools">
        <button class="icon-btn theme-toggle" aria-label="Toggle theme">
          <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
          <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        </button>
        <div class="lang-dropdown">
          <button class="icon-btn lang-trigger" aria-label="Language">
            <span class="flag">🇺🇸</span><span class="label">EN</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="lang-menu"></div>
        </div>
      </div>
      <div class="nav-cta">
        <a href="../login.html" class="btn btn-ghost" data-i18n-ar="دخول">Sign in</a>
        <a href="../register.html" class="btn btn-primary" data-i18n-ar="ابدأ مجاناً">Get Started Free</a>
      </div>
      <button class="nav-toggle" aria-label="Menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
    </div>
  </nav>'''

FOOTER_HTML = '''  <footer class="footer">
    <div class="container">
      <div class="footer-bottom" style="padding-top: 18px; border-top: 1px solid var(--border);">
        <div>© <span data-year>2026</span> Formula AI Global · Proprietary verified formulations</div>
        <div style="display: flex; gap: 18px;">
          <a href="../privacy.html">Privacy</a>
          <a href="../terms.html">Terms</a>
          <a href="../about.html">About</a>
        </div>
      </div>
    </div>
  </footer>
  <script src="../assets/app.js?v=14"></script>
  <script type="module" src="../assets/auth.js?v=14"></script>
  <script type="module" src="../assets/supabase-client.js?v=14"></script>'''


def card_html(f: dict) -> str:
    fid = html.escape(str(f.get("id") or ""))
    nm = html.escape(f.get("name_en") or f.get("name") or "Untitled")
    cs = f.get("components") or []
    comp_count = len(cs) if isinstance(cs, list) else 0
    sub = html.escape(f.get("sub_category") or f.get("form_type") or "")
    trust = f.get("trust_score") or 0
    return f'''        <a class="card" href="../formula.html?id={fid}" style="padding:18px 20px; display:block; text-decoration:none; color:inherit; transition:transform .15s,border-color .15s;">
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px;">
            <span style="background:rgba(0,255,136,.12); color:var(--primary); padding:4px 10px; border-radius:999px; font-size:.74rem; font-weight:700;">🧪 {html.escape(f.get("category") or "")}</span>
            {f'<span style="background:var(--bg-glass); color:var(--text-3); padding:4px 10px; border-radius:999px; font-size:.74rem;">{sub}</span>' if sub else ''}
            <span style="margin-inline-start:auto; color:var(--primary); font-weight:800; font-size:.8rem;">{trust}%</span>
          </div>
          <div style="font-weight:800; font-size:1.02rem; line-height:1.35; margin-bottom:6px;" dir="auto">{nm}</div>
          <div style="color:var(--text-3); font-size:.82rem;">{comp_count} ingredients</div>
        </a>'''


def industry_page(slug: str, title_en: str, title_ar: str, cats: list[str],
                  tag_en: str, tag_ar: str, formulas: list[dict]) -> str:
    desc = f"{tag_en} {len(formulas)} verified formulations in {title_en} on Formula AI Global."
    desc = desc[:160]
    url = f"{SITE}/industries/{slug}.html"
    cards = "\n".join(card_html(f) for f in formulas) or \
        '<div style="color:var(--text-3); padding:30px; text-align:center;">No formulas indexed in this category yet. Check back soon.</div>'
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "CollectionPage",
                "name": title_en,
                "description": desc,
                "url": url,
                "inLanguage": "en",
                "isPartOf": {"@type": "WebSite", "name": "Formula AI Global", "url": SITE},
                "mainEntity": {
                    "@type": "ItemList",
                    "numberOfItems": len(formulas),
                    "itemListElement": [
                        {"@type": "ListItem", "position": i+1,
                         "url": f"{SITE}/formula.html?id={f.get('id')}",
                         "name": f.get("name_en") or f.get("name") or ""}
                        for i, f in enumerate(formulas[:12])
                    ],
                },
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home",
                     "item": SITE + "/"},
                    {"@type": "ListItem", "position": 2, "name": "Industries",
                     "item": SITE + "/industries/index.html"},
                    {"@type": "ListItem", "position": 3, "name": title_en,
                     "item": url},
                ],
            },
        ],
    }
    return f'''<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>{html.escape(title_en)} — Formula AI Global</title>
  <meta name="description" content="{html.escape(desc)}" />
  <link rel="canonical" href="{url}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Formula AI Global" />
  <meta property="og:title" content="{html.escape(title_en)} — Formula AI Global" />
  <meta property="og:description" content="{html.escape(desc)}" />
  <meta property="og:url" content="{url}" />
  <meta name="theme-color" content="#00ff88" />
  <link rel="manifest" href="../manifest.json" />
  <link rel="icon" type="image/svg+xml" href="../assets/icon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/styles.css?v=14" />
  <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body>
{NAV_HTML}

  <section class="hero" style="padding: 130px 0 60px;">
    <div class="hero-bg">
      <div class="hero-orb green" style="opacity:.3;"></div>
      <div class="hero-orb purple" style="opacity:.25;"></div>
    </div>
    <div class="container" style="position:relative; z-index:2;">
      <div style="max-width: 860px; margin: 0 auto; text-align:center;">
        <span class="eyebrow reveal" data-i18n-ar="صناعة موثّقة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/></svg> Verified industry</span>
        <h1 class="reveal" data-i18n-ar="{html.escape(title_ar)}">{html.escape(title_en)}</h1>
        <p class="reveal delay-1" style="color: var(--text-2); font-size: 1.1rem; margin-top: 18px; line-height: 1.8;" data-i18n-ar="{html.escape(tag_ar)}">{html.escape(tag_en)}</p>
        <div class="reveal delay-2" style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-top: 24px;">
          <a href="../pricing.html" class="btn btn-primary btn-lg" data-i18n-ar="افتح المكتبة الكاملة">Unlock full library</a>
          <a href="../encyclopedia.html" class="btn btn-outline btn-lg" data-i18n-ar="استعرض كل الفورمولا">Browse all formulas</a>
        </div>
      </div>
    </div>
  </section>

  <section class="section" style="padding: 30px 0 60px;">
    <div class="container">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom: 18px;">
        <h2 style="margin:0; font-size:1.4rem;" data-i18n-ar="أبرز الفورمولا في هذه الصناعة">Top formulas in this industry</h2>
        <a href="../search.html?q={urllib.parse.quote(title_en)}" class="btn btn-ghost btn-sm" data-i18n-ar="بحث المزيد">Search more</a>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px;">
{cards}
      </div>
    </div>
  </section>

  <section class="section" style="padding: 40px 0 80px; background: linear-gradient(180deg, transparent, rgba(0,255,136,.05), transparent);">
    <div class="container" style="max-width: 760px; text-align:center;">
      <h2 data-i18n-ar="هل تعمل في {html.escape(title_ar)}؟">Working in {html.escape(title_en)}?</h2>
      <p style="color: var(--text-2); font-size: 1.05rem; margin: 16px 0 24px; line-height: 1.75;" data-i18n-ar="افتح المكتبة الكاملة: تركيبات كاملة، حاسبة دفعات، تحليل سلامة، وأدوات AI للاستبدال والتنبّؤ.">Unlock the full library: complete formulations, batch scaling, safety analysis, and AI tools for substitution and prediction.</p>
      <a href="../pricing.html" class="btn btn-primary btn-lg" data-i18n-ar="اعرض خطط العضوية">View membership plans</a>
    </div>
  </section>

{FOOTER_HTML}
</body>
</html>'''


def index_page(rows: list[tuple]) -> str:
    items = "\n".join(
        f'        <a class="card" href="./{slug}.html" style="padding:18px 20px; text-decoration:none; color:inherit; display:block;">'
        f'<div style="font-weight:800; font-size:1.02rem; margin-bottom:6px;" dir="auto">{html.escape(title_en)}</div>'
        f'<div style="color:var(--text-3); font-size:.85rem; line-height:1.55;">{html.escape(tag_en)}</div></a>'
        for (slug, title_en, _ta, _c, tag_en, _tg) in rows
    )
    return f'''<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Industries — Formula AI Global</title>
  <meta name="description" content="Browse 40 chemical-formulation industries on Formula AI Global — from hair care to heavy industry, with verified formulas in each." />
  <link rel="canonical" href="{SITE}/industries/index.html" />
  <link rel="manifest" href="../manifest.json" />
  <link rel="icon" type="image/svg+xml" href="../assets/icon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/styles.css?v=14" />
</head>
<body>
{NAV_HTML}
  <section style="padding: 130px 0 40px; text-align:center;">
    <div class="container">
      <span class="eyebrow" data-i18n-ar="40 صناعة">40 industries</span>
      <h1 style="margin-top: 14px;" data-i18n-ar="جميع الصناعات">All industries</h1>
      <p style="color: var(--text-2); max-width: 700px; margin: 16px auto 0; line-height: 1.75;" data-i18n-ar="تصفّح فورمولا موثّقة في كل صناعة كيميائية رئيسية.">Browse verified formulas in every major chemical industry.</p>
    </div>
  </section>
  <section class="section" style="padding-top: 20px;">
    <div class="container">
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px;">
{items}
      </div>
    </div>
  </section>
{FOOTER_HTML}
</body>
</html>'''


def main() -> int:
    total_formulas = 0
    print(f"Generating {len(INDUSTRIES)} industry pages...")
    for slug, te, ta, cats, tg_en, tg_ar in INDUSTRIES:
        try:
            forms = fetch_formulas_for(cats, limit=12)
        except Exception as e:
            print(f"  [{slug}] ERROR: {e}")
            forms = []
        total_formulas += len(forms)
        html_doc = industry_page(slug, te, ta, cats, tg_en, tg_ar, forms)
        (OUT_DIR / f"{slug}.html").write_text(html_doc, encoding="utf-8", newline="\n")
        print(f"  [{slug:22s}] {len(forms):2d} formulas -> industries/{slug}.html")
    (OUT_DIR / "index.html").write_text(index_page(INDUSTRIES), encoding="utf-8", newline="\n")
    print(f"\nWrote industries/index.html  +  {len(INDUSTRIES)} pages.")
    print(f"Total formulas referenced across industries: {total_formulas}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
