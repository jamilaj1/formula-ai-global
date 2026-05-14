"""
Multi-agent reasoning endpoints (Phase 3).

Routes (under /api/agents):
  POST /evaluate   → run safety+cost+stability+regulatory on a formula
  POST /formulate  → propose recipes + evaluate each
  POST /run/{name} → run one specific agent in isolation
"""
from __future__ import annotations

import os
from typing import Any

import anthropic
from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, Field

from agents import (
    CostAgent,
    FormulatorAgent,
    Orchestrator,
    RegulatoryAgent,
    SafetyAgent,
    StabilityAgent,
)

router = APIRouter(prefix="/agents", tags=["agents"])


def _claude_client():
    """Lazy-build a Claude client. Returns None if no API key set."""
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    return anthropic.Anthropic(api_key=key)


def _orchestrator() -> Orchestrator:
    model = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")
    return Orchestrator(claude_client=_claude_client(), model=model)


# ─── Request models ────────────────────────────────────────────


class ComponentIn(BaseModel):
    name_en: str
    cas_number: str | None = None
    percentage: float = Field(0.0, ge=0.0, le=100.0)
    function: str | None = None
    chem: dict | None = None


class FormulaIn(BaseModel):
    name: str | None = None
    category: str | None = None
    form_type: str | None = None
    components: list[ComponentIn] = Field(..., min_length=1, max_length=100)
    properties: dict | None = None
    currency: str | None = "USD"


class PriceIn(BaseModel):
    ingredient_name: str
    cas_number: str | None = None
    price_per_kg: float
    currency: str = "USD"


class EvaluateIn(BaseModel):
    formula: FormulaIn
    regions: list[str] = Field(default_factory=lambda: ["EU", "US"])
    prices: list[PriceIn] = Field(default_factory=list)
    batch_kg: float = Field(1.0, gt=0)


class FormulateIn(BaseModel):
    product_type: str = Field(..., min_length=3, max_length=300)
    target_attributes: list[str] = Field(default_factory=list)
    constraints: dict | None = None
    starting_from: list[dict] | None = None
    regions: list[str] = Field(default_factory=lambda: ["EU", "US"])
    prices: list[PriceIn] = Field(default_factory=list)
    batch_kg: float = Field(1.0, gt=0)


# ─── Endpoints ─────────────────────────────────────────────────


@router.post("/evaluate")
async def evaluate_formula(body: EvaluateIn) -> dict[str, Any]:
    """
    Run safety + cost + stability + regulatory in parallel on an
    existing formula. Returns aggregated reasoning chain.
    """
    orch = _orchestrator()
    return await orch.evaluate(
        body.formula.model_dump(),
        regions=body.regions,
        prices=[p.model_dump() for p in body.prices],
        batch_kg=body.batch_kg,
    )


@router.post("/formulate")
async def formulate_product(body: FormulateIn) -> dict[str, Any]:
    """
    Propose 1-3 candidate formulas for the requested product, then
    evaluate each one through the analysis agents. Returns the
    candidates sorted by composite score.
    """
    orch = _orchestrator()
    return await orch.formulate(
        body.model_dump(exclude={"prices", "regions", "batch_kg"}),
        regions=body.regions,
        prices=[p.model_dump() for p in body.prices],
        batch_kg=body.batch_kg,
    )


# ─── Single-agent diagnostic endpoint ──────────────────────────


@router.post("/run/{name}")
async def run_single_agent(name: str = Path(..., min_length=1),
                           payload: dict[str, Any] = None) -> dict[str, Any]:
    """
    Run one specific agent in isolation. Useful for debugging.

    name ∈ {formulator, safety, cost, stability, regulatory}
    """
    claude = _claude_client()
    model = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")
    agents_map = {
        "formulator": FormulatorAgent(claude, model),
        "safety": SafetyAgent(claude, model),
        "cost": CostAgent(claude, model),
        "stability": StabilityAgent(claude, model),
        "regulatory": RegulatoryAgent(claude, model),
    }
    agent = agents_map.get(name.lower())
    if not agent:
        raise HTTPException(404, detail={"error": "unknown_agent",
                                          "available": list(agents_map.keys())})
    result = await agent.run(payload or {})
    return result.to_dict()
