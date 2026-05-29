"""Backfill OpenAI embeddings into the formulas.embedding column.

What this does
--------------
1. Reads `public.formulas` rows where `embedding IS NULL` (resumable —
   re-run as many times as you like, it never re-embeds).
2. For each row, builds a short string from name_en + sub_category +
   top-5 components and asks OpenAI's text-embedding-3-small for a
   1536-dim vector.
3. Writes the vectors back to Supabase in batches.

Why this script (not a Render cron)
-----------------------------------
A one-time backfill for 3,381 rows runs in ~3-4 minutes from a laptop and
costs about USD 0.04. Setting up a Render job for it would take longer
than just running it. Re-run whenever you add a lot of new formulas; for
the trickle of one-off adds, see the TODO at the bottom of this file for
a tiny trigger-based path.

How to run
----------
1. Set env vars (either export them or put them in `.env` at repo root):
     SUPABASE_URL=https://ivabcssceeaqgqjzgmdx.supabase.co
     SUPABASE_SERVICE_KEY=<service_role key>
     OPENAI_API_KEY=sk-...
2. From the repo root:
     python scripts/embed_formulas.py
3. Wait. The script prints progress every batch. Re-run if it dies
   mid-way — it skips already-embedded rows.

Cost
----
OpenAI text-embedding-3-small: $0.020 per 1M tokens. We embed ~500
tokens per formula, so 3,381 × 500 ≈ 1.7M tokens ≈ $0.034 total.
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any

import requests

# ── Config ───────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Allow `.env` at repo root to provide the secrets — same pattern the
# Render backend uses via python-dotenv.
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv(os.path.join(ROOT, ".env"))
except ImportError:
    pass  # dotenv is optional — env vars from the shell also work

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
OPENAI_KEY   = os.getenv("OPENAI_API_KEY", "")

EMBED_MODEL  = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
BATCH_SIZE   = int(os.getenv("EMBED_BATCH_SIZE", "100"))  # OpenAI cap is 2048; 100 keeps memory sane

OPENAI_URL   = "https://api.openai.com/v1/embeddings"


def _check_env() -> None:
    missing = [
        k for k, v in {
            "SUPABASE_URL": SUPABASE_URL,
            "SUPABASE_SERVICE_KEY": SUPABASE_KEY,
            "OPENAI_API_KEY": OPENAI_KEY,
        }.items()
        if not v
    ]
    if missing:
        print(f"ERROR: missing env vars: {', '.join(missing)}")
        print("Set them in your shell or in a `.env` at the repo root.")
        sys.exit(2)


# ── Supabase REST helpers ────────────────────────────────────────────
SB_HEADERS = lambda extra=None: {  # noqa: E731 — small, readable
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    **(extra or {}),
}


def fetch_progress() -> dict[str, int]:
    """Read the formula_embedding_progress view (created by the migration)."""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/formula_embedding_progress?select=*",
        headers=SB_HEADERS(),
        timeout=15,
    )
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else {"embedded": 0, "pending": 0, "total": 0}


def fetch_pending(limit: int) -> list[dict[str, Any]]:
    """One page of formulas that still need embedding."""
    select = "id,name_en,name,sub_category,category,form_type,components"
    url = (
        f"{SUPABASE_URL}/rest/v1/formulas?"
        f"select={select}&embedding=is.null"
        f"&order=id.asc&limit={limit}"
    )
    r = requests.get(url, headers=SB_HEADERS(), timeout=30)
    r.raise_for_status()
    return r.json()


def update_embedding(formula_id: str, embedding: list[float]) -> None:
    """Write one embedding back. PATCH so we don't touch other columns."""
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/formulas?id=eq.{formula_id}",
        headers=SB_HEADERS({"Prefer": "return=minimal"}),
        data=json.dumps({"embedding": embedding}),
        timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"Supabase PATCH failed for {formula_id}: {r.status_code} {r.text[:300]}")


# ── Embedding input renderer ─────────────────────────────────────────
def render_text(row: dict[str, Any]) -> str:
    """Build the short string we'll embed for one formula.

    Keep it tight — the embedding cares about TOPIC and INGREDIENT
    SIGNATURE, not preparation steps or marketing copy. Include just
    enough for cosine similarity to distinguish "kids toothpaste from
    lemon mint mouthwash" while staying cheap to embed.
    """
    parts: list[str] = []
    name = (row.get("name_en") or row.get("name") or "").strip()
    if name:
        parts.append(name)

    sub = (row.get("sub_category") or "").strip()
    cat = (row.get("category") or "").strip()
    form = (row.get("form_type") or "").strip()
    classy = " · ".join(p for p in (cat, sub, form) if p)
    if classy:
        parts.append(classy)

    comps = row.get("components") or []
    if isinstance(comps, list) and comps:
        # Top 5 by percentage so the embedding represents the dominant
        # chemistry, not the trace flavorants.
        try:
            ranked = sorted(
                (c for c in comps if isinstance(c, dict)),
                key=lambda c: float(c.get("percentage") or 0),
                reverse=True,
            )[:5]
        except Exception:
            ranked = comps[:5]
        names = [
            (c.get("name_en") or c.get("name") or "").strip()
            for c in ranked
            if isinstance(c, dict)
        ]
        names = [n for n in names if n]
        if names:
            parts.append("ingredients: " + ", ".join(names))

    return " | ".join(parts) or name or "formula"


# ── OpenAI embed call ────────────────────────────────────────────────
def embed_batch(texts: list[str], retries: int = 3) -> list[list[float]]:
    """One OpenAI call → list of vectors in the same order as the inputs."""
    body = {"model": EMBED_MODEL, "input": texts}
    for attempt in range(retries):
        try:
            r = requests.post(
                OPENAI_URL,
                headers={
                    "Authorization": f"Bearer {OPENAI_KEY}",
                    "Content-Type": "application/json",
                },
                data=json.dumps(body),
                timeout=60,
            )
            if r.status_code == 429 or r.status_code >= 500:
                # Backoff and retry — transient.
                wait = 2 ** attempt
                print(f"  [retry] {r.status_code} from OpenAI, sleeping {wait}s")
                time.sleep(wait)
                continue
            r.raise_for_status()
            data = r.json()
            # OpenAI returns objects with `embedding` and `index` — sort
            # by index to be safe (they're usually in order, but the API
            # contract is "any order, use index").
            items = sorted(data.get("data", []), key=lambda x: x.get("index", 0))
            return [item["embedding"] for item in items]
        except requests.exceptions.RequestException as exc:
            wait = 2 ** attempt
            print(f"  [retry] HTTP error: {exc}, sleeping {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"OpenAI embed failed after {retries} retries")


# ── Main loop ────────────────────────────────────────────────────────
def main() -> None:
    _check_env()

    start_progress = fetch_progress()
    print(
        f"Starting: {start_progress['embedded']}/{start_progress['total']} "
        f"already embedded ({start_progress.get('pct_embedded') or 0}%)"
    )
    if not start_progress["pending"]:
        print("Nothing to do — every formula already has an embedding.")
        return

    total_embedded = 0
    batch_n = 0
    while True:
        rows = fetch_pending(BATCH_SIZE)
        if not rows:
            break
        batch_n += 1
        texts = [render_text(r) for r in rows]
        print(f"[batch {batch_n}] embedding {len(texts)} formulas…")
        vectors = embed_batch(texts)
        if len(vectors) != len(texts):
            raise RuntimeError(
                f"OpenAI returned {len(vectors)} vectors for {len(texts)} inputs"
            )
        for row, vec in zip(rows, vectors):
            update_embedding(row["id"], vec)
        total_embedded += len(rows)
        print(f"  ✓ written {total_embedded} vectors so far")

    end_progress = fetch_progress()
    print(
        f"\nDone. {end_progress['embedded']}/{end_progress['total']} "
        f"({end_progress.get('pct_embedded') or 0}%) embedded."
    )


if __name__ == "__main__":
    main()

# TODO (small follow-up, can ship later): add a Supabase trigger that
# clears `embedding` when name_en/components change, then a daily cron
# in worker-src/handlers/cost_report.js (or a separate job) that re-runs
# this script's embed_batch path against any NULL embeddings to keep
# things fresh after edits. For now this script is a one-shot backfill.
