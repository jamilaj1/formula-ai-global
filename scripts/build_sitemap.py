"""build_sitemap.py — generate sitemap.xml from Supabase.

Pulls every row in `formulas`, writes one <url> per formula
(`/formula.html?id=<uuid>`) plus the static top-level pages and any
generated industry pages found in `industries/`.

Run locally (the anon key has SELECT on `formulas` thanks to RLS, so a
service key is NOT required for this script):

    $env:SUPABASE_URL = "https://ivabcssceeaqgqjzgmdx.supabase.co"
    $env:SUPABASE_ANON_KEY = "<anon-key-from-supabase-client.js>"
    python scripts/build_sitemap.py

Re-run after a backfill or new ingestion. The generated sitemap.xml
must be uploaded with the rest of the static site.
"""
from __future__ import annotations
import datetime as _dt
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://jamilformula.com"
TODAY = _dt.date.today().isoformat()
PAGE_SIZE = 1000  # Supabase REST default cap

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = (os.environ.get("SUPABASE_SERVICE_KEY")
       or os.environ.get("SUPABASE_ANON_KEY")
       or "")

if not SUPABASE_URL or not KEY:
    print("ERROR: set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_KEY) in env.",
          file=sys.stderr)
    sys.exit(2)


def fetch_all_formulas() -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        url = (f"{SUPABASE_URL}/rest/v1/formulas?"
               f"select=id,updated_at&order=id.asc"
               f"&limit={PAGE_SIZE}&offset={offset}")
        req = urllib.request.Request(url, headers={
            "apikey": KEY,
            "Authorization": f"Bearer {KEY}",
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=45) as r:
            page = json.loads(r.read())
        if not isinstance(page, list) or not page:
            break
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


STATIC_PAGES = [
    ("", 1.0, "weekly"),
    ("/encyclopedia.html", 0.9, "daily"),
    ("/pricing.html", 0.9, "weekly"),
    ("/search.html", 0.8, "weekly"),
    ("/chat.html", 0.7, "weekly"),
    ("/about.html", 0.6, "monthly"),
    ("/contribute.html", 0.5, "monthly"),
    ("/docs.html", 0.5, "monthly"),
    ("/programs.html", 0.5, "monthly"),
    ("/safety.html", 0.5, "monthly"),
    ("/industries.html", 0.6, "weekly"),
    ("/learn.html", 0.5, "monthly"),
]


def industry_pages() -> list[str]:
    d = ROOT / "industries"
    if not d.is_dir():
        return []
    return sorted(f"/industries/{p.name}" for p in d.glob("*.html"))


def url_entry(loc: str, lastmod: str, priority: float, freq: str) -> str:
    safe = (loc.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;"))
    return (
        "  <url>\n"
        f"    <loc>{SITE}{safe}</loc>\n"
        f"    <lastmod>{lastmod}</lastmod>\n"
        f"    <changefreq>{freq}</changefreq>\n"
        f"    <priority>{priority:.1f}</priority>\n"
        "  </url>\n"
    )


def main() -> int:
    print(f"Fetching formulas from {SUPABASE_URL}...")
    rows = fetch_all_formulas()
    print(f"  {len(rows)} formulas")

    out: list[str] = [
        '<?xml version="1.0" encoding="UTF-8"?>\n',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n',
    ]

    for path, prio, freq in STATIC_PAGES:
        out.append(url_entry(path or "/", TODAY, prio, freq))

    for p in industry_pages():
        out.append(url_entry(p, TODAY, 0.7, "weekly"))

    for r in rows:
        fid = r.get("id")
        if not fid:
            continue
        lastmod = (str(r.get("updated_at") or "")[:10]) or TODAY
        url = "/formula.html?id=" + urllib.parse.quote(fid)
        out.append(url_entry(url, lastmod, 0.6, "monthly"))

    out.append("</urlset>\n")

    dest = ROOT / "sitemap.xml"
    dest.write_text("".join(out), encoding="utf-8", newline="\n")
    total = len(rows) + len(STATIC_PAGES) + len(industry_pages())
    print(f"Wrote {dest} ({total} URLs, {dest.stat().st_size} bytes).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
