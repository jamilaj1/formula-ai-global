"""
Stability predictor.

Aggregates per-component RDKit descriptors into a formula-level
stability index, then maps that to a predicted shelf life in months.

The model is a weighted heuristic (not trained ML) because:
  1. Public stability datasets are too small/varied for a useful model
  2. Auditable rules let chemists trust + override the prediction
  3. Industry baseline: viscosity drift + pH drift + microbial growth +
     phase separation, each scored independently

When Jamil's factory accumulates real lab logs (Phase 5+), we'll train
an actual regression model on those.
"""
from __future__ import annotations

from typing import Any


# Tunable thresholds — set from chemistry literature + Jamil's experience
WEIGHTED_LOGP_IDEAL_MIN = 0.0   # below this → highly hydrophilic, fine
WEIGHTED_LOGP_IDEAL_MAX = 4.0   # above this → emulsion separation risk
WEIGHTED_MW_HIGH = 800.0        # above this → diffusion/settling concerns
PRESERVATIVE_KEYWORDS = (
    "phenoxyethanol", "paraben", "sorbate", "benzoate", "isothiazolinone",
    "imidazolidinyl", "dmdm hydantoin", "chlorphenesin", "ethylhexylglycerin",
    "benzyl alcohol", "potassium sorbate", "sodium benzoate", "caprylyl glycol",
)
ANTIOXIDANT_KEYWORDS = (
    "tocopherol", "vitamin e", "ascorbic acid", "vitamin c", "bha", "bht",
    "edta", "rosemary extract",
)


class StabilityPredictor:
    """Heuristic stability + shelf-life predictor."""

    name = "stability_heuristic"

    def predict(self, formula: dict[str, Any]) -> dict[str, Any]:
        components = formula.get("components") or []
        form_type = (formula.get("form_type") or "").lower()

        agg = self._aggregate(components)
        preservatives = self._find_keywords(components, PRESERVATIVE_KEYWORDS)
        antioxidants = self._find_keywords(components, ANTIOXIDANT_KEYWORDS)

        score = 100.0
        factors = []

        # Preservative system check (only relevant for aqueous forms)
        if form_type in ("liquid", "gel", "cream", "emulsion", "lotion"):
            if not preservatives:
                score -= 40
                factors.append({
                    "factor": "microbial",
                    "severity": "high",
                    "note": "No preservative system in aqueous formula. "
                            "Expect spoilage within weeks.",
                    "score_impact": -40,
                })
            elif len(preservatives) == 1:
                score -= 5
                factors.append({
                    "factor": "microbial",
                    "severity": "low",
                    "note": f"Single preservative ({preservatives[0]}). "
                            "Consider a broad-spectrum combination.",
                    "score_impact": -5,
                })

        # logP-based emulsion stability
        wlogp = agg.get("weighted_logp")
        if wlogp is not None:
            if wlogp > WEIGHTED_LOGP_IDEAL_MAX:
                penalty = min(20, (wlogp - WEIGHTED_LOGP_IDEAL_MAX) * 5)
                score -= penalty
                factors.append({
                    "factor": "phase_separation",
                    "severity": "medium" if penalty < 15 else "high",
                    "note": f"Weighted logP {wlogp:.2f} indicates strong "
                            "hydrophobic character; risk of phase separation "
                            "in aqueous form.",
                    "score_impact": -penalty,
                })

        # MW-based settling
        wmw = agg.get("weighted_mw") or 0
        if wmw > WEIGHTED_MW_HIGH:
            score -= 10
            factors.append({
                "factor": "settling",
                "severity": "medium",
                "note": f"Weighted MW {wmw:.0f} is high — large molecules "
                        "may settle out in low-viscosity formulas.",
                "score_impact": -10,
            })

        # Antioxidant bonus
        if antioxidants:
            score = min(100, score + 5)
            factors.append({
                "factor": "oxidation",
                "severity": "low",
                "note": f"Antioxidant present ({antioxidants[0]}) — "
                        "good protection against oxidative degradation.",
                "score_impact": +5,
            })

        score = max(0.0, min(100.0, score))
        shelf_months = self._score_to_shelf_life(score)
        klass = self._classify(score)

        return {
            "stability_score": round(score, 1),
            "stability_class": klass,
            "predicted_shelf_life_months": shelf_months,
            "factors": factors,
            "aggregate": agg,
            "preservatives_detected": preservatives,
            "antioxidants_detected": antioxidants,
            "method": "weighted-heuristic v1",
        }

    # ─── helpers ───

    @staticmethod
    def _aggregate(components: list[dict]) -> dict[str, Any]:
        total_w = 0.0
        sum_logp = 0.0
        sum_mw = 0.0
        with_chem = 0
        for c in components:
            pct = float(c.get("percentage") or 0)
            chem = c.get("chem") or {}
            if pct <= 0 or not chem.get("smiles"):
                continue
            w = pct / 100.0
            sum_logp += float(chem.get("logp") or 0) * w
            sum_mw += float(chem.get("molecular_weight") or 0) * w
            total_w += w
            with_chem += 1
        if total_w == 0:
            return {"weighted_logp": None, "weighted_mw": None,
                    "components_with_chem": 0}
        return {
            "weighted_logp": round(sum_logp / total_w, 3),
            "weighted_mw": round(sum_mw / total_w, 3),
            "components_with_chem": with_chem,
        }

    @staticmethod
    def _find_keywords(components: list[dict], keywords: tuple[str, ...]) -> list[str]:
        found = []
        for c in components:
            name = (c.get("name_en") or "").lower()
            for k in keywords:
                if k in name:
                    found.append(c.get("name_en"))
                    break
        return found

    @staticmethod
    def _score_to_shelf_life(score: float) -> int:
        # Empirical mapping — industry baselines
        if score >= 90:
            return 36
        if score >= 75:
            return 24
        if score >= 60:
            return 18
        if score >= 45:
            return 12
        if score >= 30:
            return 6
        return 3

    @staticmethod
    def _classify(score: float) -> str:
        if score >= 75:
            return "stable"
        if score >= 50:
            return "marginal"
        return "unstable"
