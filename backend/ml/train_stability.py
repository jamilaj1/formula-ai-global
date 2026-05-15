"""
train_stability.py — shelf-life regressor.

Predicts log10(months of shelf life) from a molecule's descriptors plus
storage conditions (temperature °C, relative humidity %, pH). The target
is log-transformed so a 2-month and 36-month prediction are equally
weighted in the loss.

Where the data come from
────────────────────────
Two sources are mined:

  1. Our own `formulas` table — when a formula has `shelf_life_months`
     filled in (currently rare but growing as users save their own
     formulas with measured shelf life), each component is treated as
     a labelled example.

  2. The bundled `ml/data/stability_seed.csv` — a curated set of
     ~200 commodity ingredients with conservative shelf-life ranges
     compiled from cosmetic / surfactant / food-additive references.
     This gives the model a sane prior before user data exists.

When neither source has ≥50 examples, the script falls back to the
heuristic in `services/chemistry.py:predict_stability()` — same logic
as before, no ML, but never crashes.

Usage
─────
    cd backend
    python -m ml.train_stability
    python -m ml.train_stability --include-seed --include-user
    python -m ml.train_stability --max-pairs 5000
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from ml.features import descriptor_vector, feature_metadata
from ml.registry import save_model

load_dotenv(BACKEND_DIR.parent / ".env")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# 3 condition features appended after the 12 molecular descriptors:
CONDITION_FEATURES = ["temperature_c", "relative_humidity", "ph"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def fetch_user_labeled() -> list[dict]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    async with httpx.AsyncClient(timeout=60.0) as client:
        url = (
            f"{SUPABASE_URL}/rest/v1/formulas"
            "?select=id,components,shelf_life_months,storage_temperature_c,storage_humidity"
            "&shelf_life_months=not.is.null"
            "&limit=5000"
        )
        try:
            r = await client.get(url, headers=headers, timeout=30.0)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"[stability] user-data fetch failed: {e}", file=sys.stderr)
            return []


def load_seed_csv() -> list[dict]:
    """`smiles,shelf_life_months,temperature_c,relative_humidity,ph`"""
    seed = BACKEND_DIR / "ml" / "data" / "stability_seed.csv"
    rows = []
    if not seed.exists():
        return rows
    with open(seed, "r", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                rows.append({
                    "smiles": r["smiles"].strip(),
                    "shelf_life_months": float(r["shelf_life_months"]),
                    "temperature_c": float(r.get("temperature_c") or 25.0),
                    "relative_humidity": float(r.get("relative_humidity") or 50.0),
                    "ph": float(r.get("ph") or 7.0),
                })
            except (KeyError, ValueError):
                continue
    return rows


def build_examples(user_rows: list[dict], seed_rows: list[dict]) -> list[dict]:
    out = []
    # User data: each component of a formula gets the formula's shelf life
    for f in user_rows:
        shelf = f.get("shelf_life_months")
        if not shelf or shelf <= 0:
            continue
        temp = float(f.get("storage_temperature_c") or 25.0)
        rh = float(f.get("storage_humidity") or 50.0)
        for c in (f.get("components") or []):
            smi = (c.get("chem") or {}).get("smiles")
            if not smi:
                continue
            out.append({
                "smiles": smi,
                "shelf_life_months": float(shelf),
                "temperature_c": temp,
                "relative_humidity": rh,
                "ph": float(c.get("ph") or 7.0),
            })
    out.extend(seed_rows)
    return out


def make_features(ex: dict) -> tuple[list[float], float] | None:
    d = descriptor_vector(ex["smiles"])
    if d is None:
        return None
    cond = [ex["temperature_c"], ex["relative_humidity"], ex["ph"]]
    target = math.log10(max(ex["shelf_life_months"], 0.5))
    return d + cond, target


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--include-user", action="store_true", default=True)
    parser.add_argument("--include-seed", action="store_true", default=True)
    parser.add_argument("--max-pairs", type=int, default=5000)
    parser.add_argument("--n-estimators", type=int, default=300)
    parser.add_argument("--random-state", type=int, default=42)
    args = parser.parse_args()

    user_rows = asyncio.run(fetch_user_labeled()) if args.include_user else []
    seed_rows = load_seed_csv() if args.include_seed else []
    print(f"[stability] {len(user_rows)} user-labeled formulas, {len(seed_rows)} seed rows")

    examples = build_examples(user_rows, seed_rows)[: args.max_pairs]
    print(f"[stability] {len(examples)} total examples after expansion")

    if len(examples) < 50:
        print("FATAL: only {0} examples; need ≥50. Add ml/data/stability_seed.csv".format(len(examples)), file=sys.stderr)
        return 2

    feats = []
    for ex in examples:
        f = make_features(ex)
        if f is not None:
            feats.append(f)

    X = [a for a, _ in feats]
    y = [b for _, b in feats]
    print(f"[stability] feature matrix: {len(X)} × {len(X[0])} cols")

    try:
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.metrics import mean_absolute_error, r2_score
        from sklearn.model_selection import train_test_split
    except ImportError:
        print("FATAL: scikit-learn not installed.", file=sys.stderr)
        return 2

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=args.random_state)

    t0 = time.time()
    model = RandomForestRegressor(
        n_estimators=args.n_estimators,
        max_depth=18,
        n_jobs=-1,
        random_state=args.random_state,
    )
    model.fit(Xtr, ytr)
    train_seconds = time.time() - t0

    yhat = model.predict(Xte)
    mae_log = float(mean_absolute_error(yte, yhat))
    r2 = float(r2_score(yte, yhat))
    # In months — geometric mean of error
    typical_factor = 10 ** mae_log
    print(f"[stability] log10(mo) MAE = {mae_log:.3f}, R2 = {r2:.3f}  typical factor-error ~ x{typical_factor:.2f}")
    print(f"[stability] training took {train_seconds:.1f}s")

    metadata = {
        "task": "regression",
        "target": "log10(shelf_life_months)",
        "algorithm": "RandomForestRegressor",
        "hyperparameters": {"n_estimators": args.n_estimators, "max_depth": 18},
        "features": {
            **feature_metadata(),
            "extra_condition_features": list(CONDITION_FEATURES),
            "feature_count_total": 12 + len(CONDITION_FEATURES),
        },
        "n_user_labeled": len(user_rows),
        "n_seed": len(seed_rows),
        "n_train": len(Xtr),
        "n_test": len(Xte),
        "metrics": {
            "mae_log10_test": round(mae_log, 4),
            "r2_test": round(r2, 4),
            "typical_factor_error": round(typical_factor, 3),
        },
        "train_seconds": round(train_seconds, 2),
        "note": "Target is log10(months). Multiply 10^pred to get months.",
        "trained_at": _now_iso(),
    }
    save_model("stability_rf", model, metadata)
    print("[stability] saved -> ml/models/stability_rf.joblib + .meta.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
