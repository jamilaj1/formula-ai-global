# ML Models — Train, Verify, Deploy

Three production ML models live in `backend/ml/`:

| Model | File | Algorithm | Target | Trains from |
|---|---|---|---|---|
| **logP regressor** | `logp_rf.joblib` | RandomForestRegressor | log₁₀(octanol-water partition) | `ml/data/logp_train.csv` (180+ compounds with experimental logP) |
| **Compatibility classifier** | `compatibility_rf.joblib` | RandomForestClassifier | Are these two ingredients compatible? (0/1) | Our 3,381-formula database (positive pairs) + heuristic rules (negative pairs) |
| **Stability regressor** | `stability_rf.joblib` | RandomForestRegressor | log₁₀(shelf-life in months) | `ml/data/stability_seed.csv` (100+ commodity ingredients) + user-labeled formulas |

When a `.joblib` file is missing or `joblib` isn't installed, the
predictor falls back to the legacy closed-form (Crippen for logP, rule
heuristic for the others) so the API contract never breaks.

---

## Quick-start (local)

```bash
cd backend
source venv/bin/activate          # or: venv\Scripts\activate on Windows
pip install scikit-learn joblib   # one-time

# Train all three sequentially — about 1-3 minutes total
python -m ml.train_logp
python -m ml.train_compatibility
python -m ml.train_stability
```

Each script:
- Loads its dataset
- Builds the feature matrix (RDKit descriptors + optional fingerprint)
- Splits 80/20 train/test
- Fits a Random Forest
- Prints held-out metrics
- Writes `ml/models/<name>.joblib` + `ml/models/<name>.meta.json`

The `.meta.json` records:
- Algorithm + hyperparameters
- Number of training rows
- Test-set metrics (R², MAE, F1, AUC as applicable)
- Trained timestamp
- Dataset path / row count

This is what `GET /api/chem/ml/status` returns to callers, so anyone
can audit "where does this prediction come from?"

---

## What each model gives you

### `/api/chem/ml/logp`

POST body: `{ "smiles": "CCO" }`

Response:
```json
{
  "smiles": "CCO",
  "logp_predicted": -0.31,
  "logp_crippen": -0.14,
  "delta_from_crippen": -0.17,
  "prediction_stdev": 0.18,
  "confidence": "high",
  "model": "logp_rf",
  "model_metadata": {
    "available": true,
    "name": "logp_rf",
    "algorithm": "RandomForestRegressor",
    "metrics": { "mae_test": 0.42, "r2_test": 0.84 },
    "n_train": 144,
    "trained_at": "2026-05-14T08:12:33+00:00"
  }
}
```

Why two logP values? **Crippen** is the 1999 RDKit baseline.
**logp_predicted** is our trained RF. Big delta (>0.5) means Crippen is
likely wrong for this molecule — the user can decide which to trust.

### `/api/chem/ml/compatibility`

POST body: `{ "smiles_a": "CCO", "smiles_b": "OCCO" }`

Response:
```json
{
  "smiles_a": "CCO",
  "smiles_b": "OCCO",
  "compatible": true,
  "probability_compatible": 0.82,
  "verdict": "compatible",
  "confidence": "high",
  "model": "compatibility_rf"
}
```

Verdict tiers: `compatible` (≥0.7), `review` (0.4-0.7), `incompatible` (<0.4).

### `/api/chem/ml/stability`

POST body:
```json
{
  "smiles": "OCC(O)CO",
  "temperature_c": 30,
  "relative_humidity": 60,
  "ph": 7
}
```

Response:
```json
{
  "smiles": "OCC(O)CO",
  "shelf_life_months": 24.3,
  "shelf_life_log10": 1.385,
  "category": "long",
  "conditions": { "temperature_c": 30, "relative_humidity": 60, "ph": 7 },
  "model": "stability_rf"
}
```

Categories: `very_short` (<3mo), `short` (<12mo), `medium` (<24mo),
`long` (<36mo), `very_long` (≥36mo).

### `/api/chem/ml/status`

GET — returns a snapshot of every trained model with metrics.

Use this to verify after `git push` + Render redeploy that all three
models loaded successfully on the production server.

---

## Deployment

### Option A: train locally, commit the joblib files

```bash
cd backend
python -m ml.train_logp
python -m ml.train_compatibility
python -m ml.train_stability

cd ..
git add backend/ml/models/
git commit -m "ml: trained logP/compat/stability RFs"
git push
```

Render rebuilds and the new models go live with the next deploy.

**Pros:** simple, reproducible, models are versioned with the code.
**Cons:** model files inflate the git repo (each .joblib is 1-5 MB).

### Option B: train on Render (recommended for >50 MB models)

Add a one-shot Render job that runs `python -m ml.train_logp` etc. and
stores the joblib output to S3 / Supabase Storage. The serving process
then downloads on startup. Out of scope for v1 — start with Option A.

---

## Dataset growth

Every model gets better with more labelled data. Plan:

1. **logP**: We bundled 180 compounds. Goal: 5,000+ from PubChem's XLogP3
   calibration set. Add to `ml/data/logp_train.csv` (same columns) and
   re-run `python -m ml.train_logp`.

2. **Compatibility**: Currently mines our 3,381 formulas + 6 incompat
   rules. Add more incompatibility heuristics to
   `INCOMPATIBLE_FUNCTION_PAIRS` as the team discovers them, and the
   dataset re-grows on each retrain.

3. **Stability**: Add user-submitted shelf-life data via a new column
   on `formulas.shelf_life_months` (already implied by the trainer).
   When users start saving formulas with measured shelf life, the
   model auto-improves on each retrain.

---

## Monitoring after deploy

In the Better Stack dashboard:

```
service:formula-ai-backend AND path:"/api/chem/ml/*"
```

…will show every prediction request, errors, and p95 latency.

Alert: if `confidence: low` shows up in >40% of requests for a single
model over 24h, something has drifted — retrain on fresher data.
