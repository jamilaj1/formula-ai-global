"""
train_logp.py — Random Forest regressor for logP.

Why train this when RDKit already has Crippen.MolLogP?
─────────────────────────────────────────────────────
Crippen.MolLogP is a 1999 group-contribution model with documented
weaknesses on:
  • Long aliphatic chains (>16 C) — overestimates
  • Highly polar molecules — underestimates
  • Quaternary ammonium / zwitterions — fails

Training a RF on PubChem's experimental XLogP3 dataset closes those
gaps and lets us flag where Crippen is likely wrong (we compute both,
ship the ML prediction, and surface Δ when |ML − Crippen| > 0.5).

Dataset
───────
We use PubChem's openly distributed XLogP3 calibration set:
  https://pubchem.ncbi.nlm.nih.gov/docs/data-specification
Specifically, ~10,000 compounds where XLogP3-AA (atom-additive) has
been experimentally calibrated. We bundle a slice as
`ml/data/logp_train.csv` to keep training reproducible.

Usage
─────
    cd backend
    python -m ml.train_logp                         # default: bundled CSV
    python -m ml.train_logp --csv path/to/file.csv  # custom data
    python -m ml.train_logp --n-estimators 400      # bigger forest

The script writes `ml/models/logp_rf.joblib` + `logp_rf.meta.json` and
prints the hold-out test metrics.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Make `backend/` importable
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from ml.features import combined_vector, feature_metadata
from ml.registry import save_model


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_dataset(csv_path: Path) -> tuple[list[list[float]], list[float], list[str]]:
    """Read a CSV with `smiles,logp` columns. Returns (X, y, smiles_used)."""
    import csv
    X, y, used = [], [], []
    skipped = 0
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            smiles = (row.get("smiles") or row.get("SMILES") or "").strip()
            try:
                logp = float(row.get("logp") or row.get("logP") or row.get("XLogP3"))
            except (TypeError, ValueError):
                skipped += 1; continue
            feats = combined_vector(smiles)
            if feats is None:
                skipped += 1; continue
            X.append(feats); y.append(logp); used.append(smiles)
    print(f"[logp] loaded {len(X)} compounds, skipped {skipped} unparseable", file=sys.stderr)
    return X, y, used


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=str, default=None, help="CSV with smiles,logp columns")
    parser.add_argument("--n-estimators", type=int, default=300)
    parser.add_argument("--max-depth", type=int, default=20)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--random-state", type=int, default=42)
    args = parser.parse_args()

    csv_path = Path(args.csv) if args.csv else BACKEND_DIR / "ml" / "data" / "logp_train.csv"
    if not csv_path.exists():
        print(f"FATAL: {csv_path} not found. Pass --csv or create ml/data/logp_train.csv", file=sys.stderr)
        print("Quick start: download from https://pubchem.ncbi.nlm.nih.gov/ or use the bundled curated set.", file=sys.stderr)
        return 2

    print(f"[logp] training from {csv_path}")
    X, y, _ = load_dataset(csv_path)
    if len(X) < 50:
        print(f"FATAL: only {len(X)} usable rows; need ≥50.", file=sys.stderr)
        return 2

    try:
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.metrics import mean_absolute_error, r2_score
        from sklearn.model_selection import train_test_split
    except ImportError:
        print("FATAL: scikit-learn not installed. `pip install scikit-learn`", file=sys.stderr)
        return 2

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=args.test_size, random_state=args.random_state)

    print(f"[logp] training RF (n_estimators={args.n_estimators}, max_depth={args.max_depth})")
    t0 = time.time()
    model = RandomForestRegressor(
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
        n_jobs=-1,
        random_state=args.random_state,
    )
    model.fit(Xtr, ytr)
    train_seconds = time.time() - t0

    yhat = model.predict(Xte)
    mae = float(mean_absolute_error(yte, yhat))
    r2 = float(r2_score(yte, yhat))
    print(f"[logp] held-out MAE = {mae:.3f} log units, R² = {r2:.3f} (took {train_seconds:.1f}s)")

    metadata = {
        "task": "regression",
        "target": "logP (octanol-water partition coefficient)",
        "algorithm": "RandomForestRegressor",
        "hyperparameters": {
            "n_estimators": args.n_estimators,
            "max_depth": args.max_depth,
            "random_state": args.random_state,
        },
        "features": feature_metadata(),
        "n_train": len(Xtr),
        "n_test": len(Xte),
        "metrics": {
            "mae_test": round(mae, 4),
            "r2_test": round(r2, 4),
        },
        "train_seconds": round(train_seconds, 2),
        "dataset_path": str(csv_path),
        "trained_at": _now_iso(),
    }
    save_model("logp_rf", model, metadata)
    print("[logp] saved -> ml/models/logp_rf.joblib + .meta.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
