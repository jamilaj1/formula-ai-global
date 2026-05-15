"""
train_compatibility.py — pairwise ingredient compatibility classifier.

We mine `formulas.components[*]` for ingredient pairs that DO appear
together in real-world formulas (label = 1, "compatible") and generate
synthetic incompatible pairs by combining ingredients with known
conflict rules (label = 0, "incompatible"). A Random Forest then learns
to predict compatibility from the concatenated descriptor vectors of
both ingredients.

Conflict heuristics (used to label NEGATIVES from our own DB):
  • anionic surfactant  + cationic conditioner
  • strong acid (pH <3) + strong base (pH >11)
  • oxidizer            + reducer (peroxide vs. ascorbic acid)
  • silver salt         + chloride salt
  • aldehyde            + primary amine (Schiff base, browning)
  • iron salt           + tannin/catechol

These rules ship in `INCOMPATIBLE_FUNCTION_PAIRS` and
`INCOMPATIBLE_INCHI_PAIRS` below; extend as we learn more.

Usage
─────
    cd backend
    python -m ml.train_compatibility
    python -m ml.train_compatibility --neg-ratio 1.5   # more negatives
    python -m ml.train_compatibility --max-pairs 20000 # cap dataset size

Requires the same env vars as the API (SUPABASE_URL, SUPABASE_SERVICE_KEY)
and the backfill should have populated `components[*].chem.smiles` first.

Output: `ml/models/compatibility_rf.joblib` + `compatibility_rf.meta.json`
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Make `backend/` importable
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from ml.features import descriptor_vector, feature_metadata
from ml.registry import save_model

load_dotenv(BACKEND_DIR.parent / ".env")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


# Function-level incompatibilities (left-right are unordered).
# Function name is normalised to lowercase with underscores.
INCOMPATIBLE_FUNCTION_PAIRS = {
    frozenset({"anionic_surfactant", "cationic_conditioner"}),
    frozenset({"anionic_surfactant", "cationic"}),
    frozenset({"anionic_surfactant", "cationic_surfactant"}),
    frozenset({"surfactant", "cationic_conditioner"}),
    frozenset({"oxidizer", "reducer"}),
    frozenset({"oxidizing_agent", "reducing_agent"}),
    frozenset({"oxidizer", "antioxidant"}),
    frozenset({"strong_acid", "strong_base"}),
    frozenset({"acid", "alkali"}),
    frozenset({"silver_compound", "halide_salt"}),
    frozenset({"aldehyde", "primary_amine"}),
    frozenset({"chelator", "metal_salt"}),
    frozenset({"preservative", "oxidizer"}),
}


def _norm_fn(s: str) -> str:
    return (s or "").lower().strip().replace(" ", "_").replace("-", "_")


# SMARTS-based structural incompatibility flags. If a component's SMILES
# matches one of these and the other matches a complementary one, mark
# the pair as incompatible (regardless of function labels).
_INCOMPAT_SMARTS = {
    # (smarts_a, smarts_b, description)
    ("[#7+]",      "[O-]S(=O)(=O)",  "quaternary ammonium + anionic sulfate"),
    ("[#7+]",      "[O-]C(=O)",      "quaternary ammonium + carboxylate"),
    ("OO",         "[CX3H1](=O)",    "peroxide + aldehyde"),
    ("OO",         "[OH][c]",        "peroxide + phenol"),
    ("[CX3H1]=O", "[NX3H2]",         "aldehyde + primary amine"),
    ("[Ag+]",      "[Cl-]",          "silver salt + chloride"),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def fetch_formulas() -> list[dict]:
    """Fetch all formulas; filter in Python to those with chem.smiles set.

    We don't rely on `chemistry_enriched_at` because that timestamp may
    not have been set on every enriched row (backfill version mismatch).
    Instead we look at the components themselves.
    """
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Range-Unit": "items",
    }
    rows: list[dict] = []
    async with httpx.AsyncClient(timeout=60.0) as client:
        # Paginate 1000 at a time using PostgREST Range header
        for offset in range(0, 10000, 1000):
            headers_paged = {**headers, "Range": f"{offset}-{offset + 999}"}
            url = f"{SUPABASE_URL}/rest/v1/formulas?select=id,name,components&order=id.asc"
            r = await client.get(url, headers=headers_paged)
            if r.status_code in (200, 206):
                batch = r.json()
                if not batch:
                    break
                rows.extend(batch)
                if len(batch) < 1000:
                    break
            else:
                break

    # Keep only formulas where at least one component has chem.smiles set
    enriched = []
    for row in rows:
        has_chem = any(
            (c.get("chem") or {}).get("smiles")
            for c in (row.get("components") or [])
        )
        if has_chem:
            enriched.append(row)
    return enriched


def extract_positive_pairs(formulas: list[dict]) -> list[tuple[str, str]]:
    """Pairs of (smiles_a, smiles_b) that co-occur in a real formula."""
    pos = []
    for f in formulas:
        smiles_in_formula = []
        for c in (f.get("components") or []):
            smi = (c.get("chem") or {}).get("smiles")
            if smi:
                smiles_in_formula.append(smi)
        for a, b in itertools.combinations(set(smiles_in_formula), 2):
            pos.append((a, b))
    return pos


def is_incompatible(comp_a: dict, comp_b: dict) -> bool:
    """Apply the known-incompatibility heuristics to a pair of components.

    Tries function-name rules first, then SMARTS structural rules.
    """
    fa = _norm_fn(comp_a.get("function") or "")
    fb = _norm_fn(comp_b.get("function") or "")
    if fa and fb and frozenset({fa, fb}) in INCOMPATIBLE_FUNCTION_PAIRS:
        return True

    sa = (comp_a.get("chem") or {}).get("smiles") or ""
    sb = (comp_b.get("chem") or {}).get("smiles") or ""
    return _smiles_pair_incompatible(sa, sb)


def _smiles_pair_incompatible(sa: str, sb: str) -> bool:
    """Match the pair against SMARTS structural-incompatibility rules."""
    try:
        from rdkit import Chem
    except ImportError:
        return False
    ma = Chem.MolFromSmiles(sa) if sa else None
    mb = Chem.MolFromSmiles(sb) if sb else None
    if ma is None or mb is None:
        return False
    for smarts_a, smarts_b, _desc in _INCOMPAT_SMARTS:
        try:
            pa = Chem.MolFromSmarts(smarts_a)
            pb = Chem.MolFromSmarts(smarts_b)
            if pa is None or pb is None:
                continue
            # Either ordering counts
            if (ma.HasSubstructMatch(pa) and mb.HasSubstructMatch(pb)) or \
               (ma.HasSubstructMatch(pb) and mb.HasSubstructMatch(pa)):
                return True
        except Exception:
            continue
    return False


def extract_negative_pairs(
    formulas: list[dict],
    n_target: int,
    positive_set: set[tuple[str, str]],
) -> list[tuple[str, str]]:
    """Synthesize incompatible pairs.

    Strategy:
      1. Function-rule + SMARTS-rule negatives (highest signal)
      2. If we don't have enough, supplement with random pairs from
         components that NEVER co-occur in any formula. These are
         weak-supervision negatives — they don't prove incompatibility
         but they're plausible "haven't been combined in practice".
    """
    all_components = []
    for f in formulas:
        for c in (f.get("components") or []):
            smi = (c.get("chem") or {}).get("smiles")
            if smi:
                all_components.append((c, smi))

    # Sample pairs randomly instead of iterating all O(n²) combinations.
    # With ~5K components we'd have ~12M pairs — too slow for SMARTS checks.
    # Random sampling reaches the same target much faster.
    rule_neg: set[tuple[str, str]] = set()
    max_attempts = max(50000, n_target * 100)
    attempts = 0
    n_comps = len(all_components)
    while len(rule_neg) < n_target and attempts < max_attempts and n_comps >= 2:
        attempts += 1
        comp_a, sa = all_components[random.randrange(n_comps)]
        comp_b, sb = all_components[random.randrange(n_comps)]
        if sa == sb:
            continue
        if is_incompatible(comp_a, comp_b):
            rule_neg.add(tuple(sorted([sa, sb])))
    print(f"[compat] SMARTS+function sampling: {attempts} attempts -> {len(rule_neg)} negatives")

    # Weak-supervision: pairs that never appeared together (only if we lack rules)
    if len(rule_neg) < n_target:
        deficit = n_target - len(rule_neg)
        all_smiles = list({s for _, s in all_components})
        random.shuffle(all_smiles)
        weak = set()
        attempts = 0
        while len(weak) < deficit and attempts < deficit * 50:
            attempts += 1
            a, b = random.sample(all_smiles, 2)
            pair = tuple(sorted([a, b]))
            if pair in positive_set or pair in rule_neg:
                continue
            weak.add(pair)
        rule_neg |= weak

    return list(rule_neg)


def pair_features(smiles_a: str, smiles_b: str) -> list[float] | None:
    """Concat descriptors of both molecules. Symmetric: sort SMILES first."""
    a, b = sorted([smiles_a, smiles_b])
    da = descriptor_vector(a)
    db = descriptor_vector(b)
    if da is None or db is None:
        return None
    return da + db


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--neg-ratio", type=float, default=1.0,
                        help="ratio of negatives to positives (default 1:1)")
    parser.add_argument("--max-pairs", type=int, default=20000)
    parser.add_argument("--n-estimators", type=int, default=200)
    parser.add_argument("--random-state", type=int, default=42)
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("FATAL: SUPABASE_URL / SUPABASE_SERVICE_KEY must be set", file=sys.stderr)
        return 2

    print(f"[compat] fetching enriched formulas")
    formulas = asyncio.run(fetch_formulas())
    print(f"[compat] {len(formulas)} formulas with chemistry data")

    pos = extract_positive_pairs(formulas)
    pos = list({tuple(sorted(p)) for p in pos})         # dedupe
    random.seed(args.random_state)
    random.shuffle(pos)
    pos = pos[: int(args.max_pairs / (1 + args.neg_ratio))]
    print(f"[compat] {len(pos)} positive (co-occurring) pairs")

    positive_set = {tuple(sorted(p)) for p in pos}
    n_neg_target = int(len(pos) * args.neg_ratio)
    neg = extract_negative_pairs(formulas, n_neg_target, positive_set)
    n_rule = sum(
        1 for (a, b) in neg
        if _smiles_pair_incompatible(a, b)
    )
    print(f"[compat] {len(neg)} negative pairs ({n_rule} rule-based, {len(neg) - n_rule} weak-supervision)")

    if len(pos) < 100 or len(neg) < 50:
        print("FATAL: not enough labeled pairs. Run the SMILES backfill first.", file=sys.stderr)
        return 2

    X, y = [], []
    for (a, b) in pos:
        f = pair_features(a, b)
        if f: X.append(f); y.append(1)
    for (a, b) in neg:
        f = pair_features(a, b)
        if f: X.append(f); y.append(0)

    print(f"[compat] feature matrix: {len(X)} rows × {len(X[0])} cols")

    try:
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
        from sklearn.model_selection import train_test_split
    except ImportError:
        print("FATAL: scikit-learn not installed.", file=sys.stderr)
        return 2

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=args.random_state, stratify=y)

    t0 = time.time()
    model = RandomForestClassifier(
        n_estimators=args.n_estimators,
        max_depth=15,
        class_weight="balanced",
        n_jobs=-1,
        random_state=args.random_state,
    )
    model.fit(Xtr, ytr)
    train_seconds = time.time() - t0

    yhat = model.predict(Xte)
    yprob = model.predict_proba(Xte)[:, 1]
    acc = float(accuracy_score(yte, yhat))
    f1 = float(f1_score(yte, yhat))
    auc = float(roc_auc_score(yte, yprob))
    print(f"[compat] held-out acc = {acc:.3f}, F1 = {f1:.3f}, AUC = {auc:.3f}  ({train_seconds:.1f}s)")

    metadata = {
        "task": "binary_classification",
        "target": "ingredient_pair_compatibility (1=compatible, 0=incompatible)",
        "algorithm": "RandomForestClassifier",
        "hyperparameters": {
            "n_estimators": args.n_estimators,
            "max_depth": 15,
            "class_weight": "balanced",
        },
        "features": {
            **feature_metadata(),
            "pairwise": True,
            "feature_length_per_molecule": 12,
            "feature_length_total": 24,
            "note": "Descriptors only (no fingerprint) to keep pair vector small",
        },
        "n_positive": len(pos),
        "n_negative": len(neg),
        "n_train": len(Xtr),
        "n_test": len(Xte),
        "metrics": {
            "accuracy_test": round(acc, 4),
            "f1_test": round(f1, 4),
            "auc_test": round(auc, 4),
        },
        "train_seconds": round(train_seconds, 2),
        "rule_sources": [
            "Pairs co-occurring in our 3,381-formula DB → label 1",
            "Synthesised from INCOMPATIBLE_FUNCTION_PAIRS heuristic → label 0",
        ],
        "trained_at": _now_iso(),
    }
    save_model("compatibility_rf", model, metadata)
    print("[compat] saved -> ml/models/compatibility_rf.joblib + .meta.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
