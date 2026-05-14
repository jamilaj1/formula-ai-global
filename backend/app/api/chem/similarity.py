"""
chem/similarity.py — Phase 2 endpoints for structural similarity,
substitution finding, and conflict detection.

Built on services/similarity.py (Tanimoto fingerprints) and
services/substitution.py (functional substitute ranking).

Routes (all under /api/chem):
  POST /find_similar       → rank candidates by structural similarity
  POST /find_substitute    → ranked substitutes for an ingredient
  POST /substructure       → does a SMILES contain a SMARTS pattern?
  POST /conflict_check     → fast heuristic conflict scan over a formula
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.similarity import (
    is_available as sim_available,
    rank_similar,
    substructure_match,
    tanimoto,
)
from services.substitution import conflict_check, find_substitutes

router = APIRouter(prefix="/chem", tags=["chemistry"])


# ─── /chem/similarity — pairwise score ────────────────────────


class PairIn(BaseModel):
    a: str = Field(..., min_length=1, max_length=500, description="SMILES of first compound")
    b: str = Field(..., min_length=1, max_length=500, description="SMILES of second compound")


@router.post("/similarity")
async def similarity(body: PairIn) -> dict[str, Any]:
    """
    Compute Tanimoto similarity between two SMILES.
    Returns 0.0-1.0 plus a human-readable interpretation.
    """
    if not sim_available():
        raise HTTPException(503, detail={"error": "rdkit_not_installed"})
    return tanimoto(body.a, body.b)


# ─── /chem/find_similar ───────────────────────────────────────


class CandidateMolecule(BaseModel):
    smiles: str = Field(..., min_length=1, max_length=500)
    name: str | None = None
    function: str | None = None
    molecular_weight: float | None = None
    lipinski_violations: int | None = None


class FindSimilarIn(BaseModel):
    query_smiles: str = Field(..., min_length=1, max_length=500)
    candidates: list[CandidateMolecule] = Field(..., min_length=1, max_length=1000)
    limit: int = Field(20, ge=1, le=100)
    min_similarity: float = Field(0.3, ge=0.0, le=1.0)


@router.post("/find_similar")
async def find_similar(body: FindSimilarIn) -> dict[str, Any]:
    """
    Rank `candidates` by structural similarity to `query_smiles`.

    Returns top N matches sorted by Tanimoto descending, each with a
    similarity score and an interpretation tier
    (essentially_identical / close_analog / related_family).
    """
    if not sim_available():
        raise HTTPException(503, detail={"error": "rdkit_not_installed"})

    ranked = rank_similar(
        body.query_smiles,
        [c.model_dump() for c in body.candidates],
        limit=body.limit,
        min_similarity=body.min_similarity,
    )
    return {
        "query_smiles": body.query_smiles,
        "candidates_considered": len(body.candidates),
        "matches_found": len(ranked),
        "matches": ranked,
    }


# ─── /chem/find_substitute ────────────────────────────────────


class TargetMolecule(BaseModel):
    name: str | None = None
    smiles: str = Field(..., min_length=1, max_length=500)
    function: str | None = None
    molecular_weight: float | None = None


class FindSubstituteIn(BaseModel):
    target: TargetMolecule
    candidates: list[CandidateMolecule] = Field(..., min_length=1, max_length=1000)
    require_same_function: bool = True
    mw_tolerance: float = Field(0.3, ge=0.0, le=1.0)
    limit: int = Field(5, ge=1, le=20)


@router.post("/find_substitute")
async def find_substitute(body: FindSubstituteIn) -> dict[str, Any]:
    """
    Rank candidates as functional substitutes for a target ingredient.

    Combines: structural similarity (Tanimoto) + molecular-weight closeness
    + drug-likeness, with the option to require matching `function` field.

    Returns up to `limit` candidates with score + human-readable reasoning.
    """
    if not sim_available():
        raise HTTPException(503, detail={"error": "rdkit_not_installed"})

    return find_substitutes(
        body.target.model_dump(),
        [c.model_dump() for c in body.candidates],
        require_same_function=body.require_same_function,
        mw_tolerance=body.mw_tolerance,
        limit=body.limit,
    )


# ─── /chem/substructure ───────────────────────────────────────


class SubstructureIn(BaseModel):
    smarts: str = Field(..., min_length=1, max_length=500,
                        description="SMARTS pattern, e.g. '[N+](C)(C)(C)C' for quat-N")
    smiles: str = Field(..., min_length=1, max_length=500)


@router.post("/substructure")
async def substructure(body: SubstructureIn) -> dict[str, Any]:
    """
    Test whether the given SMILES contains the SMARTS substructure pattern.
    Useful for filtering "all formulas with a quat ammonium head group" etc.
    """
    if not sim_available():
        raise HTTPException(503, detail={"error": "rdkit_not_installed"})
    return substructure_match(body.smarts, body.smiles)


# ─── /chem/conflict_check ─────────────────────────────────────


class ComponentIn(BaseModel):
    name_en: str = Field(..., max_length=200)
    smiles: str | None = None
    percentage: float = Field(0.0, ge=0.0, le=100.0)
    function: str | None = None
    chem: dict | None = None  # may contain {inchi_key, smiles, ...}


class ConflictCheckIn(BaseModel):
    components: list[ComponentIn] = Field(..., min_length=1, max_length=100)


@router.post("/conflict_check")
async def chem_conflict_check(body: ConflictCheckIn) -> dict[str, Any]:
    """
    Fast heuristic scan for duplicate ingredients, acid/base conflicts,
    and quat/anionic-surfactant inactivation. NOT a substitute for the
    full safety_agent (Phase 3) — this is the cheap real-time pre-check.
    """
    return conflict_check([c.model_dump() for c in body.components])
