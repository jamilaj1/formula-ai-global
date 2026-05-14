"""
vision.py — Claude Vision API integration for chemistry images.

Three primary use cases:

  1. PARSE_LABEL    — image of a competitor's product label
                      → INCI ingredient list + extracted claims

  2. PARSE_STRUCTURE — image of a hand-drawn or printed molecule sketch
                      → SMILES (Claude reads the structure)

  3. PARSE_MSDS     — photo / PDF page of a Material Safety Data Sheet
                      → structured GHS classifications, hazards, storage

All three use the same underlying Claude Vision call with different
system prompts. Images come in as base64 strings (frontend already
base64-encodes via FileReader.readAsDataURL).

These endpoints are EXPENSIVE — typically $0.005-$0.02 per call (more
tokens for vision). Rate-limit aggressively on the Worker side.
"""
from __future__ import annotations

import base64
import json
from typing import Any

import httpx


ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_API_VERSION = "2023-06-01"


class VisionError(Exception):
    pass


def _detect_media_type(data_url: str) -> str:
    """Extract MIME type from a data URL or default to image/jpeg."""
    if data_url.startswith("data:") and ";base64," in data_url:
        return data_url.split(";")[0][len("data:"):]
    return "image/jpeg"


def _strip_data_url(s: str) -> str:
    """Return raw base64 (no `data:image/...;base64,` prefix)."""
    if "," in s and s.startswith("data:"):
        return s.split(",", 1)[1]
    return s


async def _vision_call(
    image_b64: str,
    *,
    system: str,
    user_prompt: str,
    api_key: str,
    model: str = "claude-haiku-4-5",
    max_tokens: int = 2000,
) -> dict[str, Any]:
    """Generic vision call to Claude. Returns parsed JSON or {"_error": ...}."""
    if not api_key:
        return {"_error": "missing_anthropic_key"}

    media_type = _detect_media_type(image_b64)
    raw_b64 = _strip_data_url(image_b64)

    # Sanity-check the base64 — Anthropic rejects malformed inputs early
    try:
        decoded = base64.b64decode(raw_b64, validate=True)
        if len(decoded) > 5 * 1024 * 1024:  # 5 MB hard limit
            return {"_error": "image_too_large", "size_bytes": len(decoded)}
    except Exception as e:
        return {"_error": f"invalid_base64: {e}"}

    body = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": raw_b64,
                        },
                    },
                    {"type": "text", "text": user_prompt},
                ],
            }
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                ANTHROPIC_API_URL,
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": ANTHROPIC_API_VERSION,
                    "content-type": "application/json",
                },
                json=body,
            )
    except httpx.HTTPError as e:
        return {"_error": f"network: {e}"}
    if not r.is_success:
        return {"_error": f"http_{r.status_code}", "_detail": r.text[:500]}

    data = r.json()
    text = (data.get("content") or [{}])[0].get("text", "").strip()
    text = text.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(text) if text else {}
    except json.JSONDecodeError:
        return {"_error": "parse_failed", "_raw": text[:500]}


# ─── 1. Parse a product label ───────────────────────────────────


LABEL_SYSTEM = """You are an expert at reading cosmetic and household-product labels.

Extract from the image:
  - INCI ingredient list (in order, as printed)
  - Marketing claims (e.g. "sulfate-free", "vegan", "dermatologist tested")
  - Country/region of origin if visible
  - Brand name + product name if visible
  - Net weight / volume if visible
  - Warnings if visible

Output strict JSON:
{
  "brand": "<brand or null>",
  "product_name": "<name or null>",
  "ingredients": ["<INCI 1>", "<INCI 2>", ...],
  "claims": ["sulfate-free", "vegan", ...],
  "warnings": ["..."],
  "net_quantity": "<e.g. 250ml or null>",
  "country": "<2-letter or null>",
  "confidence": 0.0-1.0,
  "notes": "<freeform observations>"
}

Output ONLY JSON. If the image is blurry or not a label, set confidence < 0.5 and notes accordingly."""


async def parse_label(image_b64: str, *, api_key: str,
                      model: str = "claude-haiku-4-5") -> dict[str, Any]:
    result = await _vision_call(
        image_b64,
        system=LABEL_SYSTEM,
        user_prompt="Read this product label and return its INCI ingredients + claims as JSON.",
        api_key=api_key,
        model=model,
    )
    if "_error" in result:
        return {"ok": False, **result}
    return {"ok": True, **result}


# ─── 2. Parse a molecular structure ─────────────────────────────


STRUCTURE_SYSTEM = """You are an expert in chemical structure recognition (OCSR).

Look at the image and identify the molecular structure. Output strict JSON:

{
  "smiles": "<canonical SMILES of the main structure>",
  "iupac_guess": "<best IUPAC name if confident>",
  "molecular_formula": "<formula>",
  "structural_features": ["aromatic ring", "ketone", "primary amine", ...],
  "confidence": 0.0-1.0,
  "alternatives": ["<alternative SMILES if uncertain>"],
  "notes": "<freeform>"
}

Rules:
- If the image shows a 2D skeletal formula, return canonical SMILES.
- If you can't determine the structure, set confidence < 0.4 and notes explaining why.
- Prefer the most senior tautomer / canonical form.
- Output ONLY JSON."""


async def parse_structure(image_b64: str, *, api_key: str,
                          model: str = "claude-haiku-4-5") -> dict[str, Any]:
    result = await _vision_call(
        image_b64,
        system=STRUCTURE_SYSTEM,
        user_prompt="Identify the molecule(s) in this image. Return SMILES as JSON.",
        api_key=api_key,
        model=model,
    )
    if "_error" in result:
        return {"ok": False, **result}
    return {"ok": True, **result}


# ─── 3. Parse an MSDS / SDS page ────────────────────────────────


MSDS_SYSTEM = """You are an expert at reading Material/Safety Data Sheets (MSDS/SDS).

Extract from the page image (one page of a 16-section SDS):

{
  "section": "<section number 1-16 if visible>",
  "section_title": "<e.g. 'Hazards Identification'>",
  "product_identifier": "<chemical or product name>",
  "ghs_classifications": [
    {"category": "Eye irritation Cat 2", "h_code": "H319", "p_code": "P264"}
  ],
  "physical_data": {
    "ph": "<if listed>",
    "boiling_point_c": null,
    "flash_point_c": null,
    "density_g_ml": null,
    "form": "<liquid/solid/gas>"
  },
  "first_aid": {
    "skin": "<instructions>",
    "eyes": "<instructions>",
    "inhalation": "<instructions>",
    "ingestion": "<instructions>"
  },
  "storage": "<storage instructions>",
  "ppe_required": ["..."],
  "regulatory_lists_cited": ["OSHA", "REACH", "TSCA", ...],
  "confidence": 0.0-1.0
}

Set fields not visible to null. Output ONLY JSON."""


async def parse_msds(image_b64: str, *, api_key: str,
                     model: str = "claude-haiku-4-5") -> dict[str, Any]:
    result = await _vision_call(
        image_b64,
        system=MSDS_SYSTEM,
        user_prompt="Extract structured data from this MSDS page. Return JSON.",
        api_key=api_key,
        model=model,
        max_tokens=2500,
    )
    if "_error" in result:
        return {"ok": False, **result}
    return {"ok": True, **result}
