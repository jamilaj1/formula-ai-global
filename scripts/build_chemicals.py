"""build_chemicals.py — generate data-backed SEO pages, one per chemical.

Phase C1 of ROADMAP_TO_10.md. The opportunity (per the strategic review)
is SEO at scale; the GUARDRAIL (per BUILD_ROADMAP's DO-NOT list) is: NO
thin AI-generated pages — Google penalises them. So every page here is
backed by REAL data from `chemicals_database` (CAS, formula, MW, IUPAC,
SMILES, applications, hazards, price, eco flag). A row without enough
real data is SKIPPED, not padded with filler.

Usage:
    python scripts/build_chemicals.py            # safe sample (24 pages)
    python scripts/build_chemicals.py 100        # first 100 quality rows
    python scripts/build_chemicals.py all        # every quality row

Env (loaded from repo-root .env if present):
    SUPABASE_URL, SUPABASE_SERVICE_KEY  (chemicals_database may be RLS-locked)

Output: chemicals/<slug>.html  +  chemicals/index.html
Each page: unique title/description/canonical/OG, schema.org
ChemicalSubstance JSON-LD, real property table, applications, hazards,
internal links (search + register), members CTA.
"""
from __future__ import annotations
import datetime as _dt
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Load .env at repo root (so SUPABASE_* are available without exporting).
_envf = ROOT / ".env"
if _envf.exists():
    for _line in _envf.read_text(encoding="utf-8", errors="ignore").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            k, _, v = _line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

OUT_DIR = ROOT / "chemicals"
OUT_DIR.mkdir(exist_ok=True)
SITE = "https://jamilformula.com"
TODAY = _dt.date.today().isoformat()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = (os.environ.get("SUPABASE_SERVICE_KEY")
       or os.environ.get("SUPABASE_ANON_KEY") or "")
if not SUPABASE_URL or not KEY:
    print("ERROR: set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env or env.", file=sys.stderr)
    sys.exit(2)

PAGE_FIELDS = (
    "id,name,name_en,iupac_name,cas_number,molecular_formula,molecular_weight,"
    "smiles,inchi,category,function_category,physical_properties,synonyms,"
    "hazards,common_applications,typical_percentage_range,average_price_per_kg,"
    "is_eco_friendly"
)

_used_slugs: set[str] = set()


def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "chemical"


def unique_slug(base: str) -> str:
    s = slugify(base)
    if s not in _used_slugs:
        _used_slugs.add(s)
        return s
    i = 2
    while f"{s}-{i}" in _used_slugs:
        i += 1
    s = f"{s}-{i}"
    _used_slugs.add(s)
    return s


def fetch_chemicals(limit, offset=0):
    """Page through chemicals_database. limit=None → fetch in 1000 chunks."""
    rows = []
    chunk = 1000 if limit is None else min(limit, 1000)
    while True:
        url = (f"{SUPABASE_URL}/rest/v1/chemicals_database?"
               f"select={PAGE_FIELDS}&order=name_en.asc&limit={chunk}&offset={offset}")
        req = urllib.request.Request(url, headers={
            "apikey": KEY, "Authorization": f"Bearer {KEY}", "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=40) as r:
            batch = json.loads(r.read())
        rows.extend(batch)
        offset += len(batch)
        if limit is not None and len(rows) >= limit:
            return rows[:limit]
        if len(batch) < chunk:
            return rows


def quality_ok(c: dict) -> bool:
    """A page is worth indexing only if it carries real, distinct data.
    Require a name + at least TWO substantive fields."""
    if not (c.get("name_en") or c.get("name")):
        return False
    substantive = 0
    if c.get("cas_number"):           substantive += 1
    if c.get("molecular_formula"):    substantive += 1
    if c.get("molecular_weight"):     substantive += 1
    if c.get("iupac_name"):           substantive += 1
    apps = c.get("common_applications")
    if isinstance(apps, list) and apps: substantive += 1
    if c.get("function_category"):    substantive += 1
    return substantive >= 2


def _as_list(v):
    if isinstance(v, list):
        return [str(x) for x in v if str(x).strip()]
    return []


def _as_dict(v):
    return v if isinstance(v, dict) else {}


NAV = '''  <nav class="navbar">
    <div class="container nav-inner">
      <a href="../index.html" class="logo">
        <span class="logo-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/></svg></span>
        Formula <span>AI</span>
      </a>
      <ul class="nav-links">
        <li><a href="../index.html" data-i18n-ar="الرئيسية">Home</a></li>
        <li><a href="../search.html" data-i18n-ar="البحث الذكي">Smart Search</a></li>
        <li><a href="../chemicals/index.html" class="active" data-i18n-ar="المواد الكيميائية">Chemicals</a></li>
        <li><a href="../industries/index.html" data-i18n-ar="الصناعات">Industries</a></li>
        <li><a href="../pricing.html" data-i18n-ar="الأسعار">Pricing</a></li>
      </ul>
      <div class="nav-tools">
        <button class="icon-btn theme-toggle" aria-label="Toggle theme">
          <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
          <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        </button>
      </div>
      <div class="nav-cta">
        <a href="../register.html" class="btn btn-primary" data-i18n-ar="ابدأ مجاناً">Get Started Free</a>
      </div>
      <button class="nav-toggle" aria-label="Menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
    </div>
  </nav>'''

FOOTER = '''  <footer class="footer">
    <div class="container">
      <div class="footer-bottom" style="padding-top: 18px; border-top: 1px solid var(--border);">
        <div>© <span data-year>2026</span> Formula AI Global · Verified chemical data</div>
        <div style="display:flex; gap:18px;"><a href="../privacy.html">Privacy</a><a href="../terms.html">About</a><a href="../about.html">About</a></div>
      </div>
    </div>
  </footer>
  <script src="../assets/app.js?v=49"></script>'''


def prop_row(label, value):
    if value is None or value == "" or value == []:
        return ""
    return (f'<tr><td style="padding:8px 12px; color:var(--text-3); width:200px;">{html.escape(label)}</td>'
            f'<td style="padding:8px 12px; font-weight:600;">{html.escape(str(value))}</td></tr>')


def chemical_page(c: dict, slug: str) -> str:
    name = c.get("name_en") or c.get("name") or "Chemical"
    name_ar = c.get("name") if (c.get("name") and c.get("name") != name) else name
    func = c.get("function_category") or c.get("category") or ""
    cas = c.get("cas_number") or ""
    formula = c.get("molecular_formula") or ""
    apps = _as_list(c.get("common_applications"))
    syns = _as_list(c.get("synonyms"))
    hazards = _as_dict(c.get("hazards"))
    phys = _as_dict(c.get("physical_properties"))
    pct = _as_dict(c.get("typical_percentage_range"))
    url = f"{SITE}/chemicals/{slug}.html"

    # Honest, data-derived description (no filler).
    desc_bits = [name]
    if cas: desc_bits.append(f"CAS {cas}")
    if formula: desc_bits.append(formula)
    if func: desc_bits.append(func)
    desc = (", ".join(desc_bits)
            + (f". Common uses: {', '.join(apps[:3])}." if apps else ".")
            + " Properties, uses and formulation data on Formula AI Global.")
    desc = desc[:300]

    rows = "".join([
        prop_row("Name", name),
        prop_row("IUPAC name", c.get("iupac_name")),
        prop_row("CAS number", cas),
        prop_row("Molecular formula", formula),
        prop_row("Molecular weight", c.get("molecular_weight")),
        prop_row("Function", func),
        prop_row("SMILES", c.get("smiles")),
        prop_row("Average price (USD/kg)", c.get("average_price_per_kg")),
        prop_row("Eco-friendly", "Yes" if c.get("is_eco_friendly") else None),
    ])
    for k, v in list(phys.items())[:8]:
        rows += prop_row(str(k).replace("_", " ").title(), v)

    apps_html = ""
    if apps:
        apps_html = ('<h2 style="font-size:1.2rem; margin:28px 0 10px;">Common applications</h2>'
                     '<ul style="line-height:1.9; color:var(--text-2);">'
                     + "".join(f"<li>{html.escape(a)}</li>" for a in apps[:12]) + "</ul>")

    pct_html = ""
    if pct:
        pct_html = ('<h2 style="font-size:1.2rem; margin:28px 0 10px;">Typical use level</h2>'
                    '<ul style="line-height:1.9; color:var(--text-2);">'
                    + "".join(f"<li>{html.escape(str(k))}: {html.escape(str(v))}</li>" for k, v in list(pct.items())[:8])
                    + "</ul>")

    haz_html = ""
    if hazards:
        haz_html = ('<h2 style="font-size:1.2rem; margin:28px 0 10px;">Safety & hazards</h2>'
                    '<ul style="line-height:1.9; color:var(--text-2);">'
                    + "".join(f"<li>{html.escape(str(k).replace('_',' ').title())}: {html.escape(str(v))}</li>" for k, v in list(hazards.items())[:8])
                    + "</ul><p style="
                    + '"color:var(--text-3); font-size:0.85rem;"'
                    + ">Always consult the official SDS before handling. Data shown is for guidance.</p>")

    syns_html = ""
    if syns:
        syns_html = (f'<p style="color:var(--text-3); font-size:0.9rem; margin-top:10px;">'
                     f'<strong>Also known as:</strong> {html.escape(", ".join(syns[:8]))}</p>')

    ld = {
        "@context": "https://schema.org",
        "@type": "ChemicalSubstance",
        "name": name,
        "url": url,
        "description": desc,
    }
    if c.get("iupac_name"): ld["iupacName"] = c["iupac_name"]
    if formula: ld["molecularFormula"] = formula
    if c.get("molecular_weight"): ld["molecularWeight"] = str(c["molecular_weight"])
    if cas: ld["identifier"] = f"CAS {cas}"

    return f'''<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>{html.escape(name)}{f" ({html.escape(formula)})" if formula else ""} — properties & uses | Formula AI Global</title>
  <meta name="description" content="{html.escape(desc)}" />
  <link rel="canonical" href="{url}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Formula AI Global" />
  <meta property="og:title" content="{html.escape(name)} — properties & uses" />
  <meta property="og:description" content="{html.escape(desc)}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:image" content="{SITE}/assets/icon.svg" />
  <meta name="twitter:card" content="summary" />
  <meta name="theme-color" content="#00ff88" />
  <link rel="manifest" href="../manifest.json" />
  <link rel="icon" type="image/svg+xml" href="../assets/icon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/styles.css?v=49" />
  <script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body>
{NAV}
  <section style="padding: 120px 0 30px;">
    <div class="container" style="max-width: 880px;">
      <nav style="font-size:0.82rem; color:var(--text-3); margin-bottom:14px;">
        <a href="../index.html" style="color:var(--text-3);">Home</a> ·
        <a href="../chemicals/index.html" style="color:var(--text-3);">Chemicals</a> ·
        <span>{html.escape(name)}</span>
      </nav>
      <h1 style="font-size:2rem; margin:0 0 6px;" dir="auto">{html.escape(name)}</h1>
      {f'<div style="color:var(--text-2); font-size:1.05rem;" dir="auto">{html.escape(name_ar)}</div>' if name_ar != name else ''}
      {syns_html}

      <div class="card" style="padding:8px; margin:22px 0; overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.92rem;">
          <tbody>{rows}</tbody>
        </table>
      </div>

      {apps_html}
      {pct_html}
      {haz_html}

      <div class="card" style="padding:24px; margin:34px 0; text-align:center; background:linear-gradient(135deg, rgba(0,255,136,.06), rgba(0,212,255,.04));">
        <h2 style="font-size:1.15rem; margin:0 0 8px;">Build a formula with {html.escape(name)}</h2>
        <p style="color:var(--text-2); margin:0 0 16px;">Search verified formulations that use {html.escape(name)}, or ask the AI chemist how to work with it.</p>
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <a href="../search.html?q={urllib.parse.quote(name)}" class="btn btn-primary">Find formulas using {html.escape(name)}</a>
          <a href="../register.html" class="btn btn-ghost">Start free</a>
        </div>
      </div>
    </div>
  </section>
{FOOTER}
</body>
</html>'''


def _index_card(slug: str, name: str, sub: str) -> str:
    sub_div = (f'<div style="color:var(--text-3); font-size:.8rem;">{html.escape(sub)}</div>'
               if sub else "")
    return (f'        <a class="card" href="./{slug}.html" '
            f'style="padding:14px 16px; text-decoration:none; color:inherit; display:block;">'
            f'<div style="font-weight:700;" dir="auto">{html.escape(name)}</div>{sub_div}</a>')


def index_page(items: list[tuple]) -> str:
    cards = "\n".join(_index_card(slug, name, sub) for (slug, name, sub) in items)
    return f'''<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chemical database — properties, CAS, uses | Formula AI Global</title>
  <meta name="description" content="Browse verified chemical data: CAS numbers, molecular formulas, properties, applications and formulation use-levels across thousands of ingredients." />
  <link rel="canonical" href="{SITE}/chemicals/index.html" />
  <link rel="manifest" href="../manifest.json" />
  <link rel="icon" type="image/svg+xml" href="../assets/icon.svg" />
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/styles.css?v=49" />
</head>
<body>
{NAV}
  <section style="padding: 130px 0 30px; text-align:center;">
    <div class="container">
      <span class="eyebrow">Chemical database</span>
      <h1 style="margin-top:14px;">Chemical ingredients — properties & uses</h1>
      <p style="color:var(--text-2); max-width:700px; margin:16px auto 0; line-height:1.75;">Real CAS numbers, formulas, properties and applications for the ingredients behind verified formulations.</p>
    </div>
  </section>
  <section class="section" style="padding-top:20px;">
    <div class="container">
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap:12px;">
{cards}
      </div>
    </div>
  </section>
{FOOTER}
</body>
</html>'''


def main() -> int:
    arg = sys.argv[1] if len(sys.argv) > 1 else "24"
    limit = None if arg == "all" else int(arg)
    print(f"Fetching chemicals (limit={arg})...")
    rows = fetch_chemicals(limit)
    print(f"  fetched {len(rows)} rows")

    written = []
    skipped = 0
    for c in rows:
        if not quality_ok(c):
            skipped += 1
            continue
        name = c.get("name_en") or c.get("name")
        slug = unique_slug(name)
        (OUT_DIR / f"{slug}.html").write_text(chemical_page(c, slug), encoding="utf-8", newline="\n")
        sub = c.get("molecular_formula") or c.get("function_category") or c.get("cas_number") or ""
        written.append((slug, name, sub))

    (OUT_DIR / "index.html").write_text(index_page(written), encoding="utf-8", newline="\n")
    print(f"\nWrote {len(written)} chemical pages + chemicals/index.html")
    print(f"Skipped {skipped} thin rows (quality gate: needs name + 2 real fields).")
    if written:
        print("Sample:", ", ".join(s for s, _, _ in written[:5]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
