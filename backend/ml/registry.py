"""
registry.py — central registry for trained ML models.

Each model is a joblib-pickled estimator stored under `backend/ml/models/`.
This module loads them lazily at first use and caches them in-process so
serving stays fast (<10ms per prediction).

Layout
──────
    backend/ml/models/
        logp_rf.joblib          # logP regressor (Random Forest)
        logp_rf.meta.json       # training metrics (R², MAE, n_train, etc.)
        compatibility_rf.joblib # ingredient-pair compatibility classifier
        compatibility_rf.meta.json
        stability_rf.joblib     # shelf-life regressor
        stability_rf.meta.json

Naming convention: `<task>_<algo>.joblib`. The `.meta.json` is written
by the trainer at the same time so callers can show provenance ("This
prediction comes from a model trained on 1,243 compounds, R²=0.78").

API
───
    from ml.registry import load_model, model_metadata, list_models

    model = load_model("logp_rf")
    meta  = model_metadata("logp_rf")
    pred  = model.predict([feature_vector])
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

MODELS_DIR = Path(__file__).resolve().parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


@lru_cache(maxsize=16)
def load_model(name: str) -> Any:
    """Load a trained estimator by name (cached). Returns None if missing."""
    try:
        import joblib  # imported lazily so envs without joblib still import
    except ImportError:
        return None

    path = MODELS_DIR / f"{name}.joblib"
    if not path.exists():
        return None
    try:
        return joblib.load(path)
    except Exception:
        return None


@lru_cache(maxsize=16)
def model_metadata(name: str) -> dict[str, Any]:
    """Return training-time metadata (metrics, n_train, trained_at)."""
    path = MODELS_DIR / f"{name}.meta.json"
    if not path.exists():
        return {"available": False, "name": name}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["available"] = True
        data["name"] = name
        return data
    except Exception:
        return {"available": False, "name": name, "error": "metadata_unreadable"}


def list_models() -> list[dict[str, Any]]:
    """List every model in the registry with its metadata."""
    out = []
    for f in MODELS_DIR.glob("*.joblib"):
        name = f.stem
        out.append({
            "name": name,
            "size_bytes": f.stat().st_size,
            "metadata": model_metadata(name),
        })
    return out


def save_model(name: str, model: Any, metadata: dict[str, Any]) -> None:
    """Persist a trained model + its metadata. Used by trainer scripts."""
    import joblib
    joblib.dump(model, MODELS_DIR / f"{name}.joblib")
    with open(MODELS_DIR / f"{name}.meta.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, default=str)
    # Invalidate caches
    load_model.cache_clear()
    model_metadata.cache_clear()
