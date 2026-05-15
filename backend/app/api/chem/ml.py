"""
Phase 4 — ML-style chemistry predictors as FastAPI endpoints.

Routes (under /api/chem):
  POST /solubility            single SMILES → ESOL prediction
  POST /solubility/batch      up to 100 SMILES at once
  POST /stability_predict     formula → stability score + predicted shelf life
  POST /toxicity_scan         single SMILES → flag matched concerning motifs
  POST /toxicity_scan_formula formula → per-ingredient toxicity scan
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ml.solubility import SolubilityPredictor
from ml.stability import StabilityPredictor
from ml.toxicity import ToxicityFlagger
from ml.predictors import (
    models_status,
    predict_compatibility,
    predict_logp,
    predict_stability_ml,
)

router = APIRouter(prefix="/chem", tags=["chemistry"])

# Singletons — predictors are stateless, build once at startup
_solubility = SolubilityPredictor()
_stability = StabilityPredictor()
_toxicity = ToxicityFlagger()


class SmilesIn(BaseModel):
    smiles: str = Field(..., min_length=1, max_length=500)


class SmilesBatchIn(BaseModel):
    smiles: list[str] = Field(..., min_length=1, max_length=100)


class ComponentIn(BaseModel):
    name_en: str
    cas_number: str | None = None
    percentage: float = Field(0.0, ge=0.0, le=100.0)
    function: str | None = None
    smiles: str | None = None
    chem: dict | None = None


class FormulaIn(BaseModel):
    name: str | None = None
    form_type: str | None = None
    components: list[ComponentIn] = Field(..., min_length=1, max_length=100)


@router.post("/solubility")
async def predict_solubility(body: SmilesIn) -> dict[str, Any]:
    """ESOL aqueous solubility (Delaney 2004 equation)."""
    return _solubility.predict(body.smiles)


@router.post("/solubility/batch")
async def predict_solubility_batch(body: SmilesBatchIn) -> dict[str, Any]:
    results = _solubility.predict_batch(body.smiles)
    valid = sum(1 for r in results if r.get("valid"))

    return {
        "count": len(results),
        "valid": valid,
        "results": results,
    }


@router.post("/stability_predict")
async def predict_stability(body: FormulaIn) -> dict[str, Any]:
    """
    Heuristic stability score + shelf-life estimate from formula
    descriptors (weighted logP/MW + preservative presence + antioxidants).
    """
    return _stability.predict(body.model_dump())


@router.post("/toxicity_scan")
async def toxicity_scan(body: SmilesIn) -> dict[str, Any]:
    """Fast structural-motif scan for concerning groups."""
    return _toxicity.scan(body.smiles)


@router.post("/toxicity_scan_formula")
async def toxicity_scan_formula(body: FormulaIn) -> dict[str, Any]:
    """Scan every component in a formula for toxicity motifs."""

    return _toxicity.scan_formula(
        [c.model_dump() for c in body.components]
    )


# ─── Trained ML models (Phase 7) ──────────────────────────────────
# These hit the joblib files in ml/models/. If a model hasn't been
# trained yet, the predictor returns a graceful fallback so the API
# contract is never broken — see ml/predictors.py.


class PairIn(BaseModel):
    smiles_a: str = Field(..., min_length=1, max_length=500)
    smiles_b: str = Field(..., min_length=1, max_length=500)


class StabilityIn(BaseModel):
    smiles: str = Field(..., min_length=1, max_length=500)
    temperature_c: float = Field(25.0, ge=-40.0, le=120.0)
    relative_humidity: float = Field(50.0, ge=0.0, le=100.0)
    ph: float = Field(7.0, ge=0.0, le=14.0)


@router.post("/ml/logp")
async def ml_logp(body: SmilesIn) -> dict[str, Any]:
    """Predict logP using a trained Random Forest (falls back to RDKit Crippen)."""
    return predict_logp(body.smiles)


@router.post("/ml/compatibility")
async def ml_compatibility(body: PairIn) -> dict[str, Any]:
    """Predict pairwise ingredient compatibility (compatible | review | incompatible)."""
    return predict_compatibility(body.smiles_a, body.smiles_b)


@router.post("/ml/stability")
async def ml_stability(body: StabilityIn) -> dict[str, Any]:
    """Predict shelf-life in months under given storage conditions."""
    return predict_stability_ml(
        body.smiles,
        temperature_c=body.temperature_c,
        relative_humidity=body.relative_humidity,
        ph=body.ph,
    )


@router.get("/ml/status")
async def ml_status() -> dict[str, Any]:
    """List every trained ML model, its metrics, and training date.

    Use this to verify in production that the models actually loaded
    after a `python -m ml.train_logp` etc.
    """
    return {"models": models_status()}