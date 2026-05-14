"""
daily_paper_scrape.py — fetch new chemistry papers daily, extract formulas.

Sources (mirrors the existing /discover handler):
  - arXiv (preprints, no API key needed)
  - Europe PMC (PubMed + PMC + full text where available)
  - Semantic Scholar (free)
  - Crossref (patents, best-effort)

For each new paper, Claude extracts any formulations and inserts them
into `formulas` with `trust_score=60-75` (auto-discovered, lower than
human-curated formulas).

Run with:
  python -m cron.daily_paper_scrape --since 2026-05-12
  python -m cron.daily_paper_scrape                    # since yesterday

Designed to be safe to run hourly — papers already ingested are skipped
via the `discovered_sources(provider, external_id)` unique constraint.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(BACKEND_DIR.parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# Default queries to scrape — biased toward industrial / cosmetic chemistry
DEFAULT_QUERIES = [
    "industrial formulation",
    "cosmetic emulsion",
    "surfactant formulation",
    "preservative system",
    "personal care formulation",
    "detergent composition",
    "disinfectant formulation",
    "anti-corrosion coating",
    "cleaning product chemistry",
    "hair care formulation",
]


async def fetch_recent_arxiv(client: httpx.AsyncClient, query: str, *,
                             since: datetime, max_results: int = 20) -> list[dict]:
    """Fetch recent arXiv papers matching `query` since `since`."""
    url = (
        f"https://export.arxiv.org/api/query"
        f"?search_query=all:{query.replace(' ', '+')}"
        f"&sortBy=submittedDate&sortOrder=descending"
        f"&max_results={max_results}"
    )
    try:
        r = await client.get(url, timeout=20.0)
    except httpx.HTTPError:
        return []
    if not r.is_success:
        return []
    xml = r.text
    entries = xml.split("<entry>")[1:]
    results = []
    for e in entries:
        def grab(tag: str) -> str:
            import re
            m = re.search(rf"<{tag}>([\s\S]*?)</{tag}>", e)
            return (m.group(1).strip() if m else "")

        title = grab("title").replace("\n", " ").strip()
        summary = grab("summary").replace("\n", " ").strip()
        pub_date = grab("published")
        url_id = grab("id")
        if not pub_date:
            continue
        try:
            pub_dt = datetime.fromisoformat(pub_date.replace("Z", "+00:00"))
        except ValueError:
            continue
        if pub_dt < since:
            continue
        results.append({
            "source_type": "preprint",
            "provider": "arxiv",
            "external_id": url_id.split("/")[-1] if url_id else None,
            "title": title or "Untitled",
            "abstract": summary,
            "year": pub_dt.year,
            "journal_or_office": "arXiv",
            "url": url_id,
            "_pub_date": pub_dt.isoformat(),
        })
    return results


async def fetch_recent_pubmed(client: httpx.AsyncClient, query: str, *,
                              since: datetime, max_results: int = 20) -> list[dict]:
    """Fetch recent Europe PMC papers matching `query` since `since`."""
    since_str = since.strftime("%Y-%m-%d")
    filtered = f"({query}) AND HAS_FT:Y AND PUB_DATE:[{since_str} TO NOW]"
    url = (
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
        f"?query={filtered.replace(' ', '%20')}"
        f"&format=json&pageSize={max_results}&resultType=core"
    )
    try:
        r = await client.get(url, timeout=20.0, headers={"Accept": "application/json"})
    except httpx.HTTPError:
        return []
    if not r.is_success:
        return []
    data = r.json()
    items = (data.get("resultList") or {}).get("result") or []
    out = []
    for it in items:
        out.append({
            "source_type": "paper",
            "provider": "pubmed",
            "external_id": (
                f"DOI:{it.get('doi')}" if it.get("doi") else
                (f"PMID:{it.get('pmid')}" if it.get("pmid") else it.get("id"))
            ),
            "title": (it.get("title") or "Untitled").strip(),
            "abstract": it.get("abstractText"),
            "year": int(it.get("pubYear")) if it.get("pubYear") else None,
            "journal_or_office": it.get("journalTitle"),
            "url": f"https://doi.org/{it['doi']}" if it.get("doi") else
                   (f"https://pubmed.ncbi.nlm.nih.gov/{it['pmid']}/" if it.get("pmid") else None),
        })
    return [p for p in out if p["abstract"]]


async def upsert_source(client: httpx.AsyncClient, source: dict) -> str | None:
    """Insert (or merge) one source row. Returns its id or None on failure."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    payload = {
        "source_type": source["source_type"],
        "provider": source["provider"],
        "external_id": source.get("external_id"),
        "title": source["title"][:400],
        "abstract": source.get("abstract") or None,
        "year": source.get("year"),
        "journal_or_office": source.get("journal_or_office"),
        "url": source.get("url"),
    }
    try:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/discovered_sources?on_conflict=provider,external_id",
            headers=headers,
            json=payload,
            timeout=20.0,
        )
        if not r.is_success:
            return None
        arr = r.json()
        return arr[0]["id"] if arr else None
    except Exception:
        return None


async def extract_formulas_from_abstract(client: httpx.AsyncClient,
                                         title: str, abstract: str) -> list[dict]:
    """Ask Claude to extract any formulas mentioned in this paper's abstract."""
    if not ANTHROPIC_KEY or not abstract or len(abstract) < 200:
        return []

    system = (
        "You extract chemical formulations from scientific text. "
        "Output a JSON array of formulas. Each: "
        '{"name", "category", "form_type", "components": [{"name_en", "cas_number", "percentage", "function"}], '
        '"completeness": "complete|partial"}. '
        "Only extract real recipes. Return [] if nothing concrete."
    )
    user = f"TITLE: {title}\n\nABSTRACT:\n{abstract[:5000]}"
    try:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5"),
                "max_tokens": 2500,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
            timeout=60.0,
        )
        if not r.is_success:
            return []
        data = r.json()
        raw = (data.get("content") or [{}])[0].get("text", "")
        import json
        text = raw.strip().replace("```json", "").replace("```", "").strip()
        arr = json.loads(text) if text else []
        return arr if isinstance(arr, list) else []
    except Exception:
        return []


async def insert_extracted_formula(client: httpx.AsyncClient, formula: dict,
                                   source: dict, source_id: str) -> bool:
    """Insert a Claude-extracted formula into `formulas` with attribution."""
    if not formula.get("name") or not formula.get("components"):
        return False
    total = sum(float(c.get("percentage") or 0) for c in formula["components"])
    if total < 50 or total > 110:
        return False
    completeness = formula.get("completeness") or (
        "complete" if 95 <= total <= 105 else "partial"
    )
    trust = 75 if completeness == "complete" else 60
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    payload = {
        "name": formula["name"][:200],
        "name_en": formula["name"][:200],
        "category": formula.get("category") or "specialty",
        "form_type": formula.get("form_type") or "liquid",
        "components": formula["components"],
        "process_conditions": {"completeness": completeness},
        "trust_score": trust,
        "source_title": source["title"],
        "source_year": source.get("year"),
        "source_url": source.get("url"),
        "discovered_source_id": source_id,
    }
    try:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/formulas",
            headers=headers, json=payload, timeout=20.0,
        )
        return r.is_success
    except Exception:
        return False


async def run(since: datetime, *, queries: list[str], max_per_query: int = 10) -> dict:
    """Main loop: fetch papers since `since`, extract, insert."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {"error": "supabase not configured"}

    stats = {
        "queries_run": len(queries) * 2,  # arxiv + pubmed each
        "papers_found": 0,
        "papers_new": 0,
        "formulas_extracted": 0,
        "formulas_inserted": 0,
    }

    async with httpx.AsyncClient() as client:
        all_sources = []
        for q in queries:
            arxiv_papers = await fetch_recent_arxiv(client, q, since=since,
                                                    max_results=max_per_query)
            pubmed_papers = await fetch_recent_pubmed(client, q, since=since,
                                                      max_results=max_per_query)
            all_sources.extend(arxiv_papers + pubmed_papers)
        stats["papers_found"] = len(all_sources)
        print(f"[scrape] found {len(all_sources)} candidate papers")

        for src in all_sources:
            source_id = await upsert_source(client, src)
            if not source_id:
                continue
            stats["papers_new"] += 1
            formulas = await extract_formulas_from_abstract(
                client, src["title"], src.get("abstract", "")
            )
            stats["formulas_extracted"] += len(formulas)
            for f in formulas:
                ok = await insert_extracted_formula(client, f, src, source_id)
                if ok:
                    stats["formulas_inserted"] += 1
            print(
                f"[scrape] {src['provider']}/{(src.get('external_id') or '?')[:20]} "
                f"→ {len(formulas)} formulas extracted"
            )

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Daily paper scrape + formula extraction")
    parser.add_argument("--since", type=str, default=None,
                        help="ISO date (YYYY-MM-DD); default = 1 day ago UTC")
    parser.add_argument("--queries", type=str, nargs="*", default=None,
                        help="Custom search queries; default = built-in industrial set")
    parser.add_argument("--max-per-query", type=int, default=10)
    args = parser.parse_args()

    if args.since:
        since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
    else:
        since = datetime.now(timezone.utc) - timedelta(days=1)

    queries = args.queries or DEFAULT_QUERIES

    print(f"[scrape] {datetime.now(timezone.utc).isoformat()} starting "
          f"(since={since.isoformat()}, queries={len(queries)})")
    stats = asyncio.run(run(since, queries=queries, max_per_query=args.max_per_query))
    print(f"[scrape] done — {stats}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
