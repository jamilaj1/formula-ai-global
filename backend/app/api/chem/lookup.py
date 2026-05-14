"""
chem/lookup.py — name → SMILES → properties in one call.

This is the bridge from "human-readable chemical name" (what users type
and what your database stores in `name_en`) to "SMILES" (what RDKit
needs to compute anything).

Flow:
  1. POST {name: "ethanol"} or {cas: "64-17-5"}
  2. Hit PubChem REST API → canonical SMILES + InChIKey + CID
  3. Feed SMILES into RDKit → full property profile
  4. Return both PubChem identifiers and RDKit-computed descriptors

If a name isn't in PubChem (~5% of cosmetic trade names, e.g. branded
surfactants), the response tells the caller `found: False` so the UI
can prompt the user to enter a SMILES manually.
"""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.chemistry import compute_properties
from services.pubchem import lookup_by_cas, lookup_by_name

router = APIRouter(prefix="/chem", tags=["chemistry"])


class NameLookupIn(BaseModel):
    name: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Chemical name as it appears on a label or in a formula",
        examples=["ethanol", "sodium laureth sulfate", "glycerin", "citric acid"],
    )


class CasLookupIn(BaseModel):
    cas: str = Field(
        ...,
        min_length=5,
        max_length=20,
        pattern=r"^\d{2,7}-\d{2}-\d$",
        description="CAS Registry Number (e.g. 64-17-5 for ethanol)",
        examples=["64-17-5", "68585-34-2"],
    )


@router.post("/lookup/name")
async def lookup_name(body: NameLookupIn) -> dict[str, Any]:
    """
    Resolve a chemical name to its PubChem identifiers + RDKit properties.

    The endpoint is idempotent and safe to call repeatedly. PubChem is the
    only external API hit; if it's down we surface a 503.
    """
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            pc = await lookup_by_name(client, body.name)
    except Exception as e:
        raise HTTPException(503, detail={"error": "pubchem_unavailable", "detail": str(e)[:200]})

    if not pc.get("found"):
        return pc

    # Now enrich with RDKit-computed properties on the canonical SMILES.
    smiles = pc.get("smiles")
    rdkit_props = compute_properties(smiles) if smiles else {"valid": False}
    return {
        **pc,
        "rdkit": rdkit_props,
    }


@router.post("/lookup/cas")
async def lookup_cas(body: CasLookupIn) -> dict[str, Any]:
    """Like /lookup/name but takes a CAS Registry Number."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            pc = await lookup_by_cas(client, body.cas)
    except Exception as e:
        raise HTTPException(503, detail={"error": "pubchem_unavailable", "detail": str(e)[:200]})

    if not pc.get("found"):
        return pc

    smiles = pc.get("smiles")
    rdkit_props = compute_properties(smiles) if smiles else {"valid": False}
    return {
        **pc,
        "rdkit": rdkit_props,
    }
