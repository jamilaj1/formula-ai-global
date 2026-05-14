"""
substitution.py — find functional substitutes for an ingredient.

A good substitute satisfies:
  1. Similar structure (Tanimoto >= 0.5) → likely similar chemistry
  2. Matching function field (e.g. both "surfactant", both "preservative")
  3. Similar molecular-weight range (±30%) → similar physical behaviour
  4. Lower or equal Lipinski violation count → not less drug-like
  5. Compatible with target form_type (liquid/gel/cream/etc.)

The user wants this when they ask:
  - "find a natural alternative to triclosan"
  - "replace this preservative with something approved in EU"
  - "what can I use instead of SLES that's milder?"

This module returns a *ranked list* with reasoning. The Worker (or chat
agent) presents 3-5 top candidates to the user.
"""
from __future__ import annotations

from typing import Any

from services.chemistry import compute_properties
from services.similarity import rank_similar


def find_substitutes(
    target: dict[str, Any],
    candidates: list[dict[str, Any]],
    *,
    require_same_function: bool = True,
    mw_tolerance: float = 0.3,
    limit: int = 5,
    min_similarity: float = 0.4,
) -> dict[str, Any]:
    """
    Rank `candidates` as substitutes for `target`.

    Args:
        target: { name, smiles, function, molecular_weight, ... } —
                what we want to replace.
        candidates: list of compound dicts with the same fields.
        require_same_function: if True, drop candidates whose
                               `function` differs from target's.
        mw_tolerance: drop candidates with MW outside
                      target_mw * (1 ± mw_tolerance).
        limit: max results.
        min_similarity: minimum Tanimoto to be considered.

    Returns:
        {
          "target": <input target>,
          "candidate_count": <int>,
          "after_filters": <int>,
          "substitutes": [
            { ...candidate fields..., similarity, score, reasoning },
            ...
          ]
        }
    """
    target_smiles = target.get("smiles") or (target.get("chem") or {}).get("smiles")
    target_fn = (target.get("function") or "").strip().lower()
    target_mw = float(
        target.get("molecular_weight")
        or (target.get("chem") or {}).get("molecular_weight")
        or 0
    )

    if not target_smiles:
        return {
            "error": "target_missing_smiles",
            "detail": "Cannot find substitutes without a target SMILES",
            "substitutes": [],
        }

    # 1. Structural filter
    structurally_similar = rank_similar(
        target_smiles, candidates, limit=200, min_similarity=min_similarity
    )

    # 2. Function + MW filters
    after_filters: list[dict[str, Any]] = []
    for c in structurally_similar:
        c_fn = (c.get("function") or "").strip().lower()
        if require_same_function and target_fn and c_fn and c_fn != target_fn:
            continue

        c_mw = float(
            c.get("molecular_weight")
            or (c.get("chem") or {}).get("molecular_weight")
            or 0
        )
        if target_mw and c_mw and mw_tolerance is not None:
            lo, hi = target_mw * (1 - mw_tolerance), target_mw * (1 + mw_tolerance)
            if not (lo <= c_mw <= hi):
                continue

        after_filters.append(c)

    # 3. Score: weighted combo of structural similarity, MW closeness, lipinski
    for c in after_filters:
        sim = float(c.get("similarity") or 0)
        c_mw = float(c.get("molecular_weight")
                     or (c.get("chem") or {}).get("molecular_weight") or 0)
        mw_closeness = 1 - min(abs((c_mw - target_mw) / target_mw), 1.0) if target_mw else 0.5
        c_violations = int(
            c.get("lipinski_violations")
            or (c.get("chem") or {}).get("lipinski_violations")
            or 0
        )
        lipinski_score = max(0, 1 - c_violations / 4)
        c["score"] = round(0.6 * sim + 0.25 * mw_closeness + 0.15 * lipinski_score, 4)
        c["reasoning"] = _build_reasoning(target, c, sim, mw_closeness, c_violations)

    after_filters.sort(key=lambda x: x["score"], reverse=True)

    return {
        "target": {
            "name": target.get("name") or target.get("name_en"),
            "smiles": target_smiles,
            "function": target_fn or None,
            "molecular_weight": target_mw or None,
        },
        "candidate_count": len(candidates),
        "after_filters": len(after_filters),
        "substitutes": after_filters[:limit],
    }


def _build_reasoning(target, candidate, sim, mw_closeness, violations) -> str:
    parts = []
    if sim >= 0.9:
        parts.append("near-identical structure")
    elif sim >= 0.7:
        parts.append(f"close structural analog (Tanimoto {sim:.2f})")
    elif sim >= 0.5:
        parts.append(f"related scaffold (Tanimoto {sim:.2f})")
    else:
        parts.append(f"loosely related (Tanimoto {sim:.2f})")

    if mw_closeness >= 0.85:
        parts.append("very close molecular weight")
    elif mw_closeness >= 0.6:
        parts.append("comparable molecular weight")

    if violations == 0:
        parts.append("drug-like (0 Lipinski violations)")
    elif violations <= 1:
        parts.append("near-drug-like (1 Lipinski violation)")

    return "; ".join(parts) if parts else "structurally matched"


def conflict_check(components: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Detect duplicate / conflicting ingredients in a formula.

    Catches things string-matching can't:
      - "ethanol" + "alcohol" + "ethyl alcohol" + InChIKey LFQSCWFLJHTTHZ-* = same
      - acid + base added separately at high concentration = neutralisation risk
      - quaternary ammonium + anionic surfactant = inactivation

    This is a fast heuristic — for full safety analysis, use the
    safety_agent (Phase 3) which adds GHS + regulatory checks.
    """
    seen_inchi: dict[str, list[int]] = {}
    issues: list[dict[str, Any]] = []

    # 1. Duplicate detection by InChIKey
    for i, c in enumerate(components):
        chem = c.get("chem") or {}
        ikey = chem.get("inchi_key")
        if not ikey:
            continue
        seen_inchi.setdefault(ikey, []).append(i)

    for ikey, indices in seen_inchi.items():
        if len(indices) > 1:
            names = [components[idx].get("name_en") or "?" for idx in indices]
            issues.append(
                {
                    "kind": "duplicate_ingredient",
                    "severity": "warning",
                    "inchi_key": ikey,
                    "indices": indices,
                    "names": names,
                    "note": f"The same chemical appears under {len(indices)} different names — "
                    "consider merging their percentages or removing one.",
                }
            )

    # 2. pH conflict — strong acid + strong base
    has_acid = any(_is_strong_acid(c) for c in components)
    has_base = any(_is_strong_base(c) for c in components)
    if has_acid and has_base:
        issues.append(
            {
                "kind": "ph_conflict",
                "severity": "caution",
                "note": "Formula contains both a strong acid and a strong base — "
                "verify intended order of addition / neutralisation.",
            }
        )

    # 3. Charge conflict — quat + anionic surfactant
    has_quat = any(_is_quat(c) for c in components)
    has_anionic = any(_is_anionic_surfactant(c) for c in components)
    if has_quat and has_anionic:
        issues.append(
            {
                "kind": "charge_inactivation",
                "severity": "warning",
                "note": "Quaternary ammonium + anionic surfactant present — "
                "they typically inactivate each other in solution.",
            }
        )

    return {
        "components_checked": len(components),
        "issues_found": len(issues),
        "overall_risk": _overall_risk(issues),
        "issues": issues,
    }


def _is_strong_acid(c: dict[str, Any]) -> bool:
    name = (c.get("name_en") or "").lower()
    pct = float(c.get("percentage") or 0)
    if pct < 0.5:
        return False
    return any(t in name for t in ("hydrochloric acid", "sulfuric acid", "nitric acid",
                                    "phosphoric acid", "hcl", "h2so4"))


def _is_strong_base(c: dict[str, Any]) -> bool:
    name = (c.get("name_en") or "").lower()
    pct = float(c.get("percentage") or 0)
    if pct < 0.5:
        return False
    return any(t in name for t in ("sodium hydroxide", "potassium hydroxide", "naoh", "koh"))


def _is_quat(c: dict[str, Any]) -> bool:
    name = (c.get("name_en") or "").lower()
    smiles = (c.get("smiles") or (c.get("chem") or {}).get("smiles") or "")
    return ("ammonium chloride" in name or "benzalkonium" in name or
            "cetrimonium" in name or "[N+]" in smiles)


def _is_anionic_surfactant(c: dict[str, Any]) -> bool:
    name = (c.get("name_en") or "").lower()
    smiles = (c.get("smiles") or (c.get("chem") or {}).get("smiles") or "")
    return ("sulfate" in name or "sulphate" in name or "laureth" in name or
            "lauryl" in name or "[O-]S(=O)" in smiles)


def _overall_risk(issues: list[dict]) -> str:
    if not issues:
        return "safe"
    severities = {i["severity"] for i in issues}
    if "warning" in severities:
        return "warning"
    if "caution" in severities:
        return "caution"
    return "info"
