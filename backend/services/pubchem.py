"""
pubchem.py — minimal PubChem REST client.

PubChem (https://pubchem.ncbi.nlm.nih.gov) hosts ~119 million unique
chemical compounds with verified properties, free and without an API key.
We use it to map a chemical name (e.g. "sodium laureth sulfate") to a
canonical SMILES + InChIKey + CID, then feed those into RDKit for
property computation.

Why this matters: existing data has only `name_en` per component. To
unlock Phase 2 (similarity search) and beyond, every component needs a
SMILES. This module is the bridge.

Rate limits: PubChem allows ~5 requests/second per IP. We respect that
with a tiny async sleep between batched calls.

REST docs: https://pubchemdocs.ncbi.nlm.nih.gov/pug-rest
"""
from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import quote

import httpx

PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
DEFAULT_TIMEOUT = 15.0
RATE_LIMIT_DELAY = 0.21  # ~5 req/sec — PubChem's published ceiling


class PubChemError(Exception):
    """Raised when PubChem returns a non-recoverable error."""


async def _get(client: httpx.AsyncClient, path: str) -> dict[str, Any] | None:
    """GET a PubChem JSON endpoint. Returns dict on 200, None on 404."""
    try:
        r = await client.get(f"{PUBCHEM_BASE}{path}")
    except httpx.HTTPError as e:
        raise PubChemError(f"network: {e}") from e
    if r.status_code == 404:
        return None
    if r.status_code == 503:
        # PubChem rate-limit kindness — back off and retry once
        await asyncio.sleep(1.0)
        r = await client.get(f"{PUBCHEM_BASE}{path}")
    if r.status_code != 200:
        raise PubChemError(f"http {r.status_code}: {r.text[:200]}")
    return r.json()


async def name_to_cid(client: httpx.AsyncClient, name: str) -> int | None:
    """
    Look up a chemical by name and return the first matching PubChem CID.
    Returns None if PubChem has no match.
    """
    if not name or not name.strip():
        return None
    safe = quote(name.strip(), safe="")
    data = await _get(client, f"/compound/name/{safe}/cids/JSON")
    if not data:
        return None
    cids = data.get("IdentifierList", {}).get("CID", [])
    return cids[0] if cids else None


async def cid_to_properties(client: httpx.AsyncClient, cid: int) -> dict[str, Any] | None:
    """
    Fetch the canonical chemistry identifiers for a CID:
    canonical SMILES, isomeric SMILES, InChI, InChIKey, molecular formula,
    molecular weight, IUPAC name.
    """
    props = (
        "CanonicalSMILES,IsomericSMILES,InChI,InChIKey,"
        "MolecularFormula,MolecularWeight,IUPACName"
    )
    data = await _get(client, f"/compound/cid/{cid}/property/{props}/JSON")
    if not data:
        return None
    rows = data.get("PropertyTable", {}).get("Properties", [])
    if not rows:
        return None
    return rows[0]


async def lookup_by_name(client: httpx.AsyncClient, name: str) -> dict[str, Any]:
    """
    One-shot: name → CID → full chemistry profile.

    Returns:
        { "found": True, "cid": 702, "smiles": "CCO", "inchi": "...",
          "inchi_key": "...", "formula": "C2H6O",
          "molecular_weight": "46.07", "iupac_name": "ethanol",
          "source": "pubchem" }
    or  { "found": False, "name": "...", "reason": "not_in_pubchem" }
    """
    cid = await name_to_cid(client, name)
    if not cid:
        return {"found": False, "name": name, "reason": "not_in_pubchem"}

    props = await cid_to_properties(client, cid)
    if not props:
        return {"found": False, "name": name, "cid": cid, "reason": "no_properties"}

    return {
        "found": True,
        "name_input": name,
        "cid": cid,
        "smiles": props.get("CanonicalSMILES"),
        "smiles_isomeric": props.get("IsomericSMILES"),
        "inchi": props.get("InChI"),
        "inchi_key": props.get("InChIKey"),
        "formula": props.get("MolecularFormula"),
        "molecular_weight": props.get("MolecularWeight"),
        "iupac_name": props.get("IUPACName"),
        "source": "pubchem",
        "source_url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}",
    }


async def lookup_by_cas(client: httpx.AsyncClient, cas_number: str) -> dict[str, Any]:
    """Same as lookup_by_name but uses the CAS Registry Number."""
    if not cas_number or not cas_number.strip():
        return {"found": False, "reason": "empty_cas"}
    safe = quote(cas_number.strip(), safe="")
    data = await _get(client, f"/compound/name/{safe}/cids/JSON")
    if not data:
        return {"found": False, "cas": cas_number, "reason": "not_in_pubchem"}
    cids = data.get("IdentifierList", {}).get("CID", [])
    if not cids:
        return {"found": False, "cas": cas_number, "reason": "no_match"}
    props = await cid_to_properties(client, cids[0])
    if not props:
        return {"found": False, "cas": cas_number, "cid": cids[0], "reason": "no_properties"}
    return {
        "found": True,
        "cas_input": cas_number,
        "cid": cids[0],
        "smiles": props.get("CanonicalSMILES"),
        "smiles_isomeric": props.get("IsomericSMILES"),
        "inchi": props.get("InChI"),
        "inchi_key": props.get("InChIKey"),
        "formula": props.get("MolecularFormula"),
        "molecular_weight": props.get("MolecularWeight"),
        "iupac_name": props.get("IUPACName"),
        "source": "pubchem",
        "source_url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{cids[0]}",
    }


async def lookup_many(
    names: list[str],
    *,
    timeout: float = DEFAULT_TIMEOUT,
    on_progress=None,
) -> list[dict[str, Any]]:
    """
    Look up many names sequentially with respect for PubChem's rate limit.
    Use this for backfill scripts (not user-facing requests).

    Args:
        names:        list of chemical names to look up.
        timeout:      per-request HTTP timeout (seconds).
        on_progress:  optional callable(i, total, result) for progress.

    Returns:
        list of lookup dicts, same order as input. One entry per input,
        with `found: True/False`.
    """
    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=timeout) as client:
        for i, name in enumerate(names):
            try:
                r = await lookup_by_name(client, name)
            except PubChemError as e:
                r = {"found": False, "name": name, "reason": str(e)}
            results.append(r)
            if on_progress:
                on_progress(i + 1, len(names), r)
            # Respect the 5 req/sec limit (skip on the last call)
            if i + 1 < len(names):
                await asyncio.sleep(RATE_LIMIT_DELAY)
    return results
