"""
Vision endpoints (Phase 6) — image → structured chemistry data.

Routes (under /api/vision):
  POST /label      product label image    → INCI + claims
  POST /structure  molecule sketch image  → SMILES (+ feed into RDKit)
  POST /msds       MSDS page image        → GHS + storage + PPE

Each accepts a base64-encoded image in JSON. The frontend already does
this via FileReader.readAsDataURL — just send the resulting string in
the request body.

These calls are expensive (~$0.005-$0.02 each on Claude Haiku Vision).
The Worker enforces auth + rate limit before forwarding.
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.chemistry import compute_properties
from services.vision import parse_label, parse_msds, parse_structure

router = APIRouter(prefix="/vision", tags=["vision"])


def _api_key() -> str:
    return os.getenv("ANTHROPIC_API_KEY", "")


def _model() -> str:
    return os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")


# Base64 input — generous size limit; Anthropic rejects > ~5 MB.
class ImageIn(BaseModel):
    image: str = Field(
        ...,
        min_length=20,
        max_length=10_000_000,  # ~7.5 MB after base64
        description="base64-encoded image, with or without `data:...;base64,` prefix",
    )


@router.post("/label")
async def vision_label(body: ImageIn) -> dict[str, Any]:
    """
    Read a cosmetic / household product label.

    Returns: brand, product_name, ingredients (INCI), claims, warnings,
    net_quantity, country, confidence, notes.

    Cost: ~$0.005-$0.01 per call (Claude Haiku Vision).
    """
    key = _api_key()
    if not key:
        raise HTTPException(503, detail={"error": "anthropic_not_configured"})
    return await parse_label(body.image, api_key=key, model=_model())


@router.post("/structure")
async def vision_structure(body: ImageIn) -> dict[str, Any]:
    """
    Recognise a molecular structure (skeletal formula) in an image.

    Returns SMILES + IUPAC guess + structural features. If a SMILES is
    extracted with confidence ≥ 0.5, we also pipe it through RDKit to
    return computed properties.
    """
    key = _api_key()
    if not key:
        raise HTTPException(503, detail={"error": "anthropic_not_configured"})
    result = await parse_structure(body.image, api_key=key, model=_model())

    if (
        result.get("ok")
        and result.get("smiles")
        and (result.get("confidence") or 0) >= 0.5
    ):
        rdkit_props = compute_properties(result["smiles"])
        result["rdkit"] = rdkit_props
    return result


@router.post("/msds")
async def vision_msds(body: ImageIn) -> dict[str, Any]:
    """
    Read one page of a Material Safety Data Sheet.

    Returns: section, GHS classifications, physical data, first aid,
    storage, PPE, cited regulatory lists.

    Cost: ~$0.01-$0.02 (longer prompt + more tokens out).
    """
    key = _api_key()
    if not key:
        raise HTTPException(503, detail={"error": "anthropic_not_configured"})
    return await parse_msds(body.image, api_key=key, model=_model())
