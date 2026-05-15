"""
predictors.py — production serving layer for our trained ML models.

Each function loads a model from the registry on demand (cached), runs
inference, and returns a JSON-serializable dict. When the model is
unavailable (not trained yet, joblib missing, RDKit missing), each
function falls back to the legacy closed-form or heuristic so the API
contract never breaks.

This is what the FastAPI routes call. Trainers (train_logp.py,
train_compatibility.py, train_stability.py) produce the joblib files
this module loads.
"""
from __future__ import annotations

import math
from typing import Any

from ml.features import descriptor_vector
from ml.registry import load_model, model_metadata


# ─── 1. logP ────────────────────────────────────────────────────


def predict_logp(smiles: str) -> dict[str, Any]:
    """
    Predict logP. Returns:
      {
        "smiles": ...,
        "logp_predicted": float,
        "logp_crippen": float,        # RDKit baseline for comparison
        "delta_from_crippen": float,  # ML − Crippen
        "confidence": "high"|"medium"|"low",
        "model": "logp_rf" | "crippen_fallback",
        "model_metadata": {...}
      }
    """
    from ml.features import combined_vector
    feats = combined_vector(smiles)
    if feats is None:
        return {"error": "invalid_smiles", "smiles": smiles}

    crippen = descriptor_vector(smiles)[1] if descriptor_vector(smiles) else None
    model = load_model("logp_rf")

    if model is None:
        return {
            "smiles": smiles,
            "logp_predicted": round(float(crippen), 3) if crippen is not None else None,
            "logp_crippen": round(float(crippen), 3) if crippen is not None else None,
            "delta_from_crippen": 0.0,
            "confidence": "medium",
            "model": "crippen_fallback",
            "model_metadata": {"note": "ML model not trained yet; using RDKit Crippen."},
        }

    pred = float(model.predict([feats])[0])
    delta = pred - float(crippen) if crippen is not None else None
    # Use forest prediction variance for confidence
    try:
        all_tree_preds = [t.predict([feats])[0] for t in model.estimators_[:30]]
        stdev = float(_stdev(all_tree_preds))
    except Exception:
        stdev = 0.0
    if stdev < 0.3:
        confidence = "high"
    elif stdev < 0.7:
        confidence = "medium"
    else:
        confidence = "low"

    return {
        "smiles": smiles,
        "logp_predicted": round(pred, 3),
        "logp_crippen": round(float(crippen), 3) if crippen is not None else None,
        "delta_from_crippen": round(delta, 3) if delta is not None else None,
        "prediction_stdev": round(stdev, 3),
        "confidence": confidence,
        "model": "logp_rf",
        "model_metadata": _meta_summary("logp_rf"),
    }


# ─── 2. Compatibility ───────────────────────────────────────────


def predict_compatibility(smiles_a: str, smiles_b: str) -> dict[str, Any]:
    """
    Predict whether two ingredients are likely compatible. Returns:
      {
        "compatible": bool,
        "probability_compatible": float (0..1),
        "verdict": "compatible" | "review" | "incompatible",
        "confidence": "high"|"medium"|"low",
        "model": "compatibility_rf" | "rule_fallback",
      }
    """
    a, b = sorted([smiles_a, smiles_b])
    da = descriptor_vector(a)
    db = descriptor_vector(b)
    if da is None or db is None:
        return {"error": "invalid_smiles", "smiles_a": smiles_a, "smiles_b": smiles_b}
    feats = da + db

    model = load_model("compatibility_rf")
    if model is None:
        # Fallback: assume compatible unless trivially identical
        return {
            "smiles_a": a,
            "smiles_b": b,
            "compatible": True,
            "probability_compatible": 0.5,
            "verdict": "review",
            "confidence": "low",
            "model": "rule_fallback",
            "model_metadata": {"note": "Compatibility model not trained yet."},
        }

    prob = float(model.predict_proba([feats])[0][1])
    if prob >= 0.7:
        verdict = "compatible"
        compatible = True
    elif prob >= 0.4:
        verdict = "review"
        compatible = True
    else:
        verdict = "incompatible"
        compatible = False

    confidence = "high" if abs(prob - 0.5) > 0.3 else "medium" if abs(prob - 0.5) > 0.15 else "low"

    return {
        "smiles_a": a,
        "smiles_b": b,
        "compatible": compatible,
        "probability_compatible": round(prob, 4),
        "verdict": verdict,
        "confidence": confidence,
        "model": "compatibility_rf",
        "model_metadata": _meta_summary("compatibility_rf"),
    }


# ─── 3. Stability ───────────────────────────────────────────────


def predict_stability_ml(
    smiles: str,
    *,
    temperature_c: float = 25.0,
    relative_humidity: float = 50.0,
    ph: float = 7.0,
) -> dict[str, Any]:
    """
    Predict shelf-life in months. Returns:
      {
        "smiles": ...,
        "shelf_life_months": float,
        "shelf_life_log10": float,
        "category": "very_short"|"short"|"medium"|"long"|"very_long",
        "conditions": {temperature_c, relative_humidity, ph},
        "model": "stability_rf" | "heuristic_fallback",
      }
    """
    d = descriptor_vector(smiles)
    if d is None:
        return {"error": "invalid_smiles", "smiles": smiles}

    model = load_model("stability_rf")
    if model is None:
        # Heuristic fallback: short shelf for amines / aldehydes / peroxides
        return _stability_heuristic_fallback(smiles, temperature_c, relative_humidity, ph)

    feats = d + [temperature_c, relative_humidity, ph]
    pred_log = float(model.predict([feats])[0])
    months = max(0.1, 10 ** pred_log)
    cat = _stability_category(months)
    return {
        "smiles": smiles,
        "shelf_life_months": round(months, 1),
        "shelf_life_log10": round(pred_log, 3),
        "category": cat,
        "conditions": {
            "temperature_c": temperature_c,
            "relative_humidity": relative_humidity,
            "ph": ph,
        },
        "model": "stability_rf",
        "model_metadata": _meta_summary("stability_rf"),
    }


# ─── helpers ────────────────────────────────────────────────────


def _meta_summary(name: str) -> dict[str, Any]:
    """A condensed metadata view safe to ship to clients."""
    m = model_metadata(name)
    if not m.get("available"):
        return {"available": False, "name": name}
    return {
        "available": True,
        "name": name,
        "algorithm": m.get("algorithm"),
        "metrics": m.get("metrics", {}),
        "n_train": m.get("n_train"),
        "trained_at": m.get("trained_at"),
    }


def _stdev(xs: list[float]) -> float:
    if not xs:
        return 0.0
    mu = sum(xs) / len(xs)
    return math.sqrt(sum((x - mu) ** 2 for x in xs) / len(xs))


def _stability_category(months: float) -> str:
    if months < 3:    return "very_short"
    if months < 12:   return "short"
    if months < 24:   return "medium"
    if months < 36:   return "long"
    return "very_long"


def _stability_heuristic_fallback(smiles, t, rh, ph) -> dict[str, Any]:
    """Conservative shelf-life estimate when the ML model isn't trained yet."""
    # Defaults vary by descriptor signal
    months = 18.0
    if "[O][O]" in smiles or "OO" in smiles:  # peroxide motif
        months = 4.0
    if "C=O" in smiles and "N" in smiles:     # aldehyde + amine = browning
        months = 6.0
    # Temperature degrades 2× per 10°C above 25
    months /= 2 ** max(0, (t - 25.0) / 10.0)
    # High humidity penalizes hygroscopic materials slightly
    if rh > 70:
        months *= 0.85
    # pH extremes accelerate hydrolysis
    if ph < 3 or ph > 11:
        months *= 0.7
    months = max(months, 0.5)
    return {
        "smiles": smiles,
        "shelf_life_months": round(months, 1),
        "shelf_life_log10": round(math.log10(months), 3),
        "category": _stability_category(months),
        "conditions": {"temperature_c": t, "relative_humidity": rh, "ph": ph},
        "model": "heuristic_fallback",
        "model_metadata": {"note": "Stability ML model not trained yet."},
    }


# ─── Public registry view ───────────────────────────────────────


def models_status() -> dict[str, Any]:
    """Health snapshot of every trainable model."""
    return {
        "logp_rf":          _meta_summary("logp_rf"),
        "compatibility_rf": _meta_summary("compatibility_rf"),
        "stability_rf":     _meta_summary("stability_rf"),
    }
