#!/usr/bin/env python3
"""
seed_database.py — Load formula JSON files into Supabase.

USAGE
-----
    # Load the curated seed
    python seed_database.py ../data/formulas_seed.json

    # Load Claude-extracted formulas
    python seed_database.py ../data/formulas_extracted.json

    # Load multiple files in one shot
    python seed_database.py ../data/formulas_seed.json ../data/formulas_extracted.json

    # Dry-run (validate only, no DB write)
    python seed_database.py --dry-run ../data/formulas_seed.json

WHAT IT DOES
------------
1. Reads one or more JSON files in the formulas_seed.json schema.
2. Re-validates every formula (percentages → 100%, CAS regex, required fields).
3. Maps the JSON shape onto the existing `formulas` table in
   `database/schema.sql` (UUID id, components inline as JSONB,
   flat `source_*` fields, `final_properties` JSONB).
4. Upserts by the human-readable `id` we put inside source.formula_code,
   so re-running the script is safe (no duplicates).

REQUIREMENTS
------------
    pip install supabase python-dotenv

ENV VARS (set in backend/.env)
-----------------------------
    SUPABASE_URL=https://<project>.supabase.co
    SUPABASE_SERVICE_KEY=<service-role-key>   # service-role, NOT anon

SCHEMA REFERENCE
----------------
This script writes to the `formulas` table created by
`database/schema.sql`. Components stay inline in `components` JSONB.
We use `source_url` to store our human-readable formula code
(e.g. "FA-2026-00001") so that re-running the script de-duplicates by it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: supabase not installed. Run: pip install supabase", file=sys.stderr)
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


CAS_REGEX = re.compile(r"^\d{2,7}-\d{2}-\d$")
PERCENTAGE_TOLERANCE = 0.5


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

def validate_formula(f: Dict[str, Any]) -> Tuple[bool, List[str]]:
    problems: List[str] = []
    for key in ("id", "name_en", "name_ar", "category", "form_type", "components"):
        if key not in f or f[key] in (None, "", []):
            problems.append(f"missing: {key}")

    components = f.get("components") or []
    total = 0.0
    for i, c in enumerate(components):
        pct = c.get("percentage")
        if not isinstance(pct, (int, float)):
            problems.append(f"component[{i}] bad percentage")
            continue
        total += float(pct)
        cas = c.get("cas_number")
        if cas and not CAS_REGEX.match(str(cas)):
            problems.append(f"component[{i}] bad CAS: {cas}")
    if components and abs(total - 100.0) > PERCENTAGE_TOLERANCE:
        problems.append(f"sum {total:.2f}% != 100%")

    return len(problems) == 0, problems


# ─────────────────────────────────────────────────────────────────────────────
# Map our JSON → existing `formulas` table schema
# ─────────────────────────────────────────────────────────────────────────────

def map_to_db_row(f: Dict[str, Any]) -> Dict[str, Any]:
    src = f.get("source") or {}
    props = f.get("properties") or {}

    # We stash our human-readable id inside source_url because the existing
    # schema's primary key is a UUID we can't override on insert without DB tweaks.
    formula_code = f["id"]

    return {
        # primary identity
        "name": f.get("name_ar") or f.get("name_en"),
        "name_en": f.get("name_en"),

        # taxonomy
        "category": f.get("category"),
        "sub_category": f.get("sub_category"),
        "form_type": f.get("form_type"),
        "description": f.get("description"),

        # JSONB blobs
        "components": f.get("components") or [],
        "process_conditions": f.get("process_conditions") or {},
        "final_properties": props,
        "safety_warnings": f.get("safety_warnings") or [],
        "applications": f.get("applications") or [],
        "quality_control": f.get("quality_control") or [],

        # source provenance
        "source_type": src.get("type"),
        "source_title": src.get("title"),
        "source_author": src.get("author"),
        "source_year": src.get("year"),
        "source_page": _to_int(src.get("pages")),
        "source_url": formula_code,                 # carries our human ID
        "source_confidence": float(f.get("trust_score", 85)) / 100.0,

        # scoring
        "trust_score": float(f.get("trust_score", 85)),
        "is_complete": True,
        "completeness_score": 1.0,

        # metadata
        "language": f.get("language", "en"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    s = str(value)
    m = re.search(r"\d+", s)
    return int(m.group()) if m else None


# ─────────────────────────────────────────────────────────────────────────────
# Supabase ops
# ─────────────────────────────────────────────────────────────────────────────

def get_client() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.", file=sys.stderr)
        sys.exit(2)
    return create_client(url, key)


def upsert_formula(sb: Client, f: Dict[str, Any]) -> str:
    """
    Idempotent insert/update by formula code (stored in source_url).
    Returns the action taken: 'inserted' or 'updated'.
    """
    code = f["id"]
    row = map_to_db_row(f)

    existing = (
        sb.table("formulas")
        .select("id")
        .eq("source_url", code)
        .limit(1)
        .execute()
    )
    if existing.data:
        sb.table("formulas").update(row).eq("source_url", code).execute()
        return "updated"
    sb.table("formulas").insert(row).execute()
    return "inserted"


# ─────────────────────────────────────────────────────────────────────────────
# Driver
# ─────────────────────────────────────────────────────────────────────────────

def load_file(path: Path) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    formulas = data.get("formulas") if isinstance(data, dict) else data
    if not isinstance(formulas, list):
        raise ValueError(f"{path}: expected top-level list or {{'formulas': [...]}}")
    return formulas


def run(files: List[Path], dry_run: bool) -> int:
    sb: Client | None = None if dry_run else get_client()

    inserted = 0
    updated = 0
    rejected = 0
    bad_log: List[Dict[str, Any]] = []

    for path in files:
        if not path.exists():
            print(f"[skip] {path} not found", file=sys.stderr)
            continue

        print(f"[file] {path}")
        formulas = load_file(path)
        for f in formulas:
            ok, problems = validate_formula(f)
            if not ok:
                rejected += 1
                bad_log.append({"id": f.get("id"), "problems": problems})
                print(f"  [BAD] {f.get('id', '<no id>')}: {'; '.join(problems)}")
                continue
            if dry_run:
                inserted += 1  # would-be insert
                continue
            try:
                action = upsert_formula(sb, f)
                if action == "inserted":
                    inserted += 1
                else:
                    updated += 1
            except Exception as e:
                rejected += 1
                bad_log.append({"id": f.get("id"), "problems": [f"db error: {e}"]})
                print(f"  [DB-FAIL] {f['id']}: {e}")

        print(f"[file] running totals → inserted={inserted}, updated={updated}, rejected={rejected}")

    print()
    print("=" * 60)
    print(f"  RESULT: {inserted} inserted, {updated} updated, {rejected} rejected")
    print(f"  Mode  : {'DRY-RUN (no DB writes)' if dry_run else 'LIVE'}")
    print("=" * 60)

    if bad_log:
        report_path = Path("seed_rejects.json")
        report_path.write_text(
            json.dumps({"rejected": bad_log}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"  Rejects written to {report_path.resolve()}")

    return 0 if rejected == 0 else 1


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Seed Supabase with chemical formulas from JSON.")
    p.add_argument("files", nargs="+", type=Path, help="One or more JSON files in seed schema.")
    p.add_argument("--dry-run", action="store_true",
                   help="Validate only; do not write to the database.")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    return run(args.files, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
