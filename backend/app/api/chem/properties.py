"""
chem/properties.py — RDKit-powered chemistry endpoints.

These endpoints compute molecular descriptors using the same algorithms a
PhD chemist uses (RDKit), not LLM guesses. Results are deterministic and
verifiable against published values.

All routes are namespaced under /api/chem on the FastAPI app.
The Cloudflare Worker proxies /chem/* to here.
"""
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.chemistry import (
    is_available,
    compute_properties,
    compute_properties_batch,
    canonicalize,
    lipinski_check,
)

router = APIRouter(prefix="/chem", tags=["chemistry"])


# ─── Request models ────────────────────────────────────────────────


class SmilesIn(BaseModel):
    smiles: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="SMILES string, e.g. 'CCO' for ethanol or 'c1ccccc1' for benzene",
        examples=["CCO", "c1ccccc1", "CC(=O)O"],
    )


class SmilesBatchIn(BaseModel):
    smiles: list[str] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="List of up to 100 SMILES strings",
    )


# ─── Endpoints ─────────────────────────────────────────────────────


@router.get("/health")
async def chem_health() -> dict[str, Any]:
    """
    Verify RDKit is loaded and functional.

    Returns 200 if a known SMILES (ethanol) parses correctly and returns
    the expected molecular weight (~46 Da). Returns 503 otherwise.
    """
    if not is_available():
        raise HTTPException(503, detail={"error": "rdkit_not_installed"})

    result = compute_properties("CCO")  # ethanol
    if not result.get("valid"):
        raise HTTPException(
            503,
            detail={"error": "rdkit_smoke_test_failed", "result": result},
        )
    return {
        "status": "ok",
        "rdkit_working": True,
        "test_compound": "ethanol",
        "molecular_weight": result["molecular_weight"],
        "formula": result["formula"],
    }


@router.post("/properties")
async def chem_properties(body: SmilesIn) -> dict[str, Any]:
    """
    Compute molecular descriptors for one SMILES string.

    Returns mass, formula, logP, TPSA, H-bond donors/acceptors, rings,
    rotatable bonds, Lipinski violations, and canonical SMILES + InChI.

    Invalid SMILES produces `{'valid': false, 'error': 'invalid_smiles'}`
    with HTTP 200 (not 4xx) so batch callers can collect results uniformly.
    """
    return compute_properties(body.smiles)


@router.post("/properties/batch")
async def chem_properties_batch(body: SmilesBatchIn) -> dict[str, Any]:
    """
    Batch version — up to 100 SMILES per request.
    Each result is independent; one invalid input doesn't break the others.
    """
    results = compute_properties_batch(body.smiles)
    valid = sum(1 for r in results if r.get("valid"))
    return {
        "count": len(results),
        "valid": valid,
        "invalid": len(results) - valid,
        "results": results,
    }


@router.post("/canonicalize")
async def chem_canonicalize(body: SmilesIn) -> dict[str, Any]:
    """
    Validate and canonicalize a SMILES string.

    Use this to deduplicate compounds in your database: two SMILES that
    represent the same molecule will produce the same canonical form and
    the same InChIKey.
    """
    return canonicalize(body.smiles)


@router.post("/lipinski")
async def chem_lipinski(body: SmilesIn) -> dict[str, Any]:
    """
    Detailed Lipinski Rule of Five evaluation.

    Returns each of the four rules with its measured value and pass/fail,
    plus a `drug_like` boolean (true iff 0 violations).

    Useful for filtering candidates in cosmetic/pharmaceutical formulations.
    """
    return lipinski_check(body.smiles)
