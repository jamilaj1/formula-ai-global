"""
backfill_smiles.py — enrich existing formulas with chemistry metadata.

For every component in every formula, this script:
  1. Reads `name_en` (and `cas_number` if present)
  2. Asks PubChem for canonical SMILES + InChIKey + CID
  3. Writes those back into the component JSON
  4. Computes RDKit properties (mw, logP, etc.) and stores them too

The result: every component in every formula gains a `chem` block:

    {
      "name_en": "Sodium Laureth Sulfate",
      "cas_number": "68585-34-2",
      "percentage": 12.0,
      "function": "surfactant",
      "chem": {
        "cid": 8851,
        "smiles": "CCCCCCCCCCCCOCCOCCOS(=O)(=O)[O-].[Na+]",
        "inchi_key": "...",
        "formula": "C16H33NaO7S",
        "molecular_weight": 384.49,
        "logp": 4.12,
        "lipinski_violations": 1,
        "source": "pubchem",
        "lookup_at": "2026-05-13T16:00:00Z"
      }
    }

After this script runs once over your 3,381 formulas, every Phase 2+
feature (similarity search, substitution, conflict detection) gets
real chemistry to work with.

Usage
─────
    cd backend
    python -m tools.backfill_smiles --dry-run          # preview without writes
    python -m tools.backfill_smiles --limit 50         # enrich first 50 formulas
    python -m tools.backfill_smiles                    # full run (~30 min for 3,381)
    python -m tools.backfill_smiles --refresh          # re-fetch even if chem block exists

Requires the same env vars as the API (SUPABASE_URL, SUPABASE_SERVICE_KEY).

Rate respect
────────────
PubChem caps anonymous access at ~5 req/sec. The script paces itself with
the same RATE_LIMIT_DELAY used by services/pubchem.py. A typical formula
has 8-12 components, so ~30 minutes for 3,381 formulas is a reasonable
upper bound.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make `backend/` importable when invoked as a script.
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import httpx
from dotenv import load_dotenv

from services.chemistry import compute_properties
from services.pubchem import RATE_LIMIT_DELAY, lookup_by_cas, lookup_by_name

# Load .env from project root (one level up from backend/)
load_dotenv(BACKEND_DIR.parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env", file=sys.stderr)
    sys.exit(2)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def list_formulas_needing_backfill(
    client: httpx.AsyncClient, *, limit: int | None, refresh: bool
) -> list[dict]:
    """
    Fetch formulas that still need chemistry enrichment.

    With refresh=True: returns all formulas regardless of state.
    With refresh=False: returns only those whose components lack a `chem` block.
    """
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    path = "/rest/v1/formulas?select=id,name,name_en,components&order=id.asc"
    if limit:
        path += f"&limit={limit}"
    r = await client.get(f"{SUPABASE_URL}{path}", headers=headers)
    r.raise_for_status()
    rows = r.json()

    if refresh:
        return rows

    # Filter: keep formulas where AT LEAST ONE component is missing chem data
    def needs_work(row: dict) -> bool:
        comps = row.get("components") or []
        return any(not (c.get("chem") and c["chem"].get("smiles")) for c in comps)

    return [r for r in rows if needs_work(r)]


async def enrich_component(
    client: httpx.AsyncClient, comp: dict, *, refresh: bool
) -> dict:
    """
    Look up one component on PubChem and add a `chem` block.
    Returns the component dict (possibly with .chem added).
    """
    if not refresh and comp.get("chem") and comp["chem"].get("smiles"):
        return comp  # already enriched

    name = (comp.get("name_en") or comp.get("name") or "").strip()
    cas = (comp.get("cas_number") or "").strip()

    pc = None
    # Prefer CAS lookup — more specific than common name
    if cas:
        try:
            pc = await lookup_by_cas(client, cas)
        except Exception as e:
            print(f"    cas-lookup error: {e}", file=sys.stderr)
    if (not pc or not pc.get("found")) and name:
        try:
            pc = await lookup_by_name(client, name)
        except Exception as e:
            print(f"    name-lookup error: {e}", file=sys.stderr)

    if not pc or not pc.get("found"):
        comp["chem"] = {
            "smiles": None,
            "looked_up_at": now_iso(),
            "found": False,
            "source": "pubchem",
        }
        return comp

    # Compute RDKit properties
    smiles = pc.get("smiles")
    props = compute_properties(smiles) if smiles else {"valid": False}

    comp["chem"] = {
        "found": True,
        "cid": pc.get("cid"),
        "smiles": smiles,
        "smiles_isomeric": pc.get("smiles_isomeric"),
        "inchi": pc.get("inchi"),
        "inchi_key": pc.get("inchi_key"),
        "formula": pc.get("formula"),
        "molecular_weight": props.get("molecular_weight"),
        "logp": props.get("logp"),
        "tpsa": props.get("tpsa"),
        "h_bond_donors": props.get("h_bond_donors"),
        "h_bond_acceptors": props.get("h_bond_acceptors"),
        "lipinski_violations": props.get("lipinski_violations"),
        "iupac_name": pc.get("iupac_name"),
        "source": "pubchem",
        "source_url": pc.get("source_url"),
        "looked_up_at": now_iso(),
    }
    return comp


async def write_formula(client: httpx.AsyncClient, formula_id: str, components: list[dict]) -> bool:
    """PATCH the components column + chemistry_enriched_at timestamp."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    r = await client.patch(
        f"{SUPABASE_URL}/rest/v1/formulas?id=eq.{formula_id}",
        headers=headers,
        json={
            "components": components,
            "chemistry_enriched_at": now_iso(),
        },
    )
    return r.status_code in (200, 204)


async def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill SMILES + RDKit data into formulas.components")
    parser.add_argument("--dry-run", action="store_true", help="Preview, don't write")
    parser.add_argument("--limit", type=int, default=None, help="Only process N formulas")
    parser.add_argument("--refresh", action="store_true", help="Re-fetch even if chem block exists")
    args = parser.parse_args()

    print(f"[backfill] {now_iso()} starting (dry_run={args.dry_run}, limit={args.limit}, refresh={args.refresh})")

    async with httpx.AsyncClient(timeout=30.0) as client:
        formulas = await list_formulas_needing_backfill(
            client, limit=args.limit, refresh=args.refresh
        )
        print(f"[backfill] {len(formulas)} formulas to process")

        total_comps = sum(len(f.get("components") or []) for f in formulas)
        print(f"[backfill] estimated {total_comps} component lookups")
        print(f"[backfill] estimated wall time: ~{(total_comps * RATE_LIMIT_DELAY) / 60:.1f} min")

        stats = {"updated": 0, "found": 0, "missing": 0, "errors": 0}

        for i, f in enumerate(formulas, start=1):
            print(f"[{i:>4}/{len(formulas)}] {f.get('name_en') or f.get('name')!r}")
            new_components = []
            for comp in f.get("components") or []:
                try:
                    enriched = await enrich_component(client, comp, refresh=args.refresh)
                except Exception as e:
                    stats["errors"] += 1
                    print(f"    component error: {e}", file=sys.stderr)
                    enriched = comp
                if enriched.get("chem", {}).get("found"):
                    stats["found"] += 1
                else:
                    stats["missing"] += 1
                new_components.append(enriched)
                # Rate-limit between component lookups (PubChem cap)
                await asyncio.sleep(RATE_LIMIT_DELAY)

            if args.dry_run:
                print("    DRY: would patch", f["id"], "with", len(new_components), "components")
                # Print the first new chem block as a preview
                first = next((c for c in new_components if c.get("chem", {}).get("found")), None)
                if first:
                    print("    preview:", json.dumps(first["chem"], indent=2, default=str)[:300])
            else:
                ok = await write_formula(client, f["id"], new_components)
                if ok:
                    stats["updated"] += 1
                else:
                    print(f"    write FAILED for {f['id']}", file=sys.stderr)
                    stats["errors"] += 1

        print("\n[backfill] done")
        print(f"  formulas updated:    {stats['updated']}")
        print(f"  components found:    {stats['found']}")
        print(f"  components missing:  {stats['missing']}")
        print(f"  errors:              {stats['errors']}")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
