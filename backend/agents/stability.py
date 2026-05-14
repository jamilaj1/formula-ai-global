"""
StabilityAgent — shelf-life and physical-stability prediction.

Uses simple, well-known cheminformatics heuristics + Claude for nuance:
  - Aggregate logP (weighted by mass fraction) → emulsion stability hint
  - Aggregate MW → diffusion / settling estimate
  - Component-level Lipinski violations → drug-likeness / aqueous solubility
  - Presence of preservative system → microbial stability rating

Not a substitute for accelerated-stability testing in the lab. This is a
fast pre-screen that catches obvious "this will separate" or "no
preservative system" issues before the formula reaches the bench.
"""
from __future__ import annotations

from typing import Any

from .base import AgentResult, BaseAgent


SYSTEM_PROMPT = """You are a stability scientist with 25+ years of cosmetics + industrial formulation experience.

Given a formula with computed chemistry data, output JSON:

{
  "predicted_shelf_life_months": <int>,
  "stability_class": "stable|marginal|unstable",
  "critical_factors": [
    {"factor": "<phase_separation|microbial|oxidation|pH_drift|crystallization>",
     "severity": "low|medium|high",
     "note": "..."}
  ],
  "preservation_assessment": {
    "has_preservative_system": true|false,
    "named_preservatives": ["..."],
    "broad_spectrum": true|false,
    "ph_range": "<e.g. 4.0-8.0>"
  },
  "recommended_storage": "<temp, humidity, light, container>",
  "accelerated_test_recommendation": "<e.g. '40°C × 3 months equivalent to 24-mo room-temp shelf>'"
}

Output ONLY JSON. Use real preservative names (parabens, phenoxyethanol, sorbates, isothiazolinones, etc.)."""


class StabilityAgent(BaseAgent):
    name = "stability"

    async def run(self, payload: dict[str, Any]) -> AgentResult:
        components = payload.get("components") or []
        form_type = payload.get("form_type") or "unknown"
        target_ph = payload.get("target_ph")

        if not components:
            return self._error_result("missing components")

        # ─── Deterministic heuristics ───
        agg = self._aggregate_chem(components)
        has_preservative = self._detect_preservatives(components)

        # ─── Claude for narrative + shelf-life estimate ───
        user_msg = self._build_user_message(
            components, form_type, target_ph, agg, has_preservative
        )
        data = await self._ask_claude(SYSTEM_PROMPT, user_msg, max_tokens=1000)
        if data is None or data.get("_error"):
            # Fall back to heuristic verdict
            return AgentResult(
                agent=self.name,
                verdict="marginal" if not has_preservative else "stable",
                reasoning=(
                    "Heuristic-only (no Claude). Preservative system detected: "
                    f"{has_preservative}. Aggregate logP: {agg['weighted_logp']}."
                ),
                evidence=[{"aggregate": agg, "has_preservative": has_preservative}],
                confidence=0.4,
            )

        shelf_months = int(data.get("predicted_shelf_life_months") or 0)
        klass = data.get("stability_class", "marginal")

        suggestions = []
        if not has_preservative and form_type in ("liquid", "gel", "cream", "emulsion"):
            suggestions.append(
                "No preservative detected in an aqueous form — microbial spoilage "
                "likely within weeks. Add a broad-spectrum preservative system."
            )
        if shelf_months > 0 and shelf_months < 12:
            suggestions.append(
                f"Predicted shelf life {shelf_months} months is below industry "
                "norm (24+ months). Consider stabilisers or packaging upgrade."
            )

        return AgentResult(
            agent=self.name,
            verdict=klass,
            reasoning=(
                f"Predicted shelf life {shelf_months} months. "
                f"Class: {klass}. "
                f"Preservative system: {'detected' if has_preservative else 'NOT detected'}."
            ),
            evidence=[{"aggregate": agg, "claude_analysis": data}],
            confidence=0.6,
            suggestions=suggestions,
        )

    # ─── helpers ───

    @staticmethod
    def _aggregate_chem(components: list[dict]) -> dict[str, Any]:
        total_w = 0.0
        sum_logp = 0.0
        sum_mw = 0.0
        violations_total = 0
        with_chem = 0
        for c in components:
            pct = float(c.get("percentage") or 0)
            chem = c.get("chem") or {}
            if pct <= 0 or not chem.get("smiles"):
                continue
            logp = float(chem.get("logp") or 0)
            mw = float(chem.get("molecular_weight") or 0)
            viol = int(chem.get("lipinski_violations") or 0)
            w = pct / 100.0
            sum_logp += logp * w
            sum_mw += mw * w
            violations_total += viol
            total_w += w
            with_chem += 1
        if total_w == 0:
            return {"weighted_logp": None, "weighted_mw": None,
                    "components_with_chem": 0}
        return {
            "weighted_logp": round(sum_logp / total_w, 3),
            "weighted_mw": round(sum_mw / total_w, 3),
            "components_with_chem": with_chem,
            "total_lipinski_violations": violations_total,
        }

    @staticmethod
    def _detect_preservatives(components: list[dict]) -> bool:
        preservatives = (
            "phenoxyethanol", "paraben", "sorbate", "benzoate", "isothiazolinone",
            "triclosan", "imidazolidinyl", "dmdm hydantoin", "chlorphenesin",
            "ethylhexylglycerin", "benzyl alcohol", "potassium sorbate",
        )
        for c in components:
            name = (c.get("name_en") or "").lower()
            if any(p in name for p in preservatives):
                return True
        return False

    def _build_user_message(self, components, form_type, target_ph, agg, has_pres):
        lines = []
        for c in components:
            line = f"- {c.get('name_en')}: {c.get('percentage')}%"
            chem = c.get("chem") or {}
            if chem.get("smiles"):
                line += f" (MW {chem.get('molecular_weight')}, logP {chem.get('logp')})"
            lines.append(line)
        return (
            f"FORM TYPE: {form_type}\n"
            f"TARGET pH: {target_ph or 'unspecified'}\n"
            f"AGGREGATE: weighted logP={agg['weighted_logp']}, "
            f"weighted MW={agg['weighted_mw']}, "
            f"total Lipinski violations={agg.get('total_lipinski_violations')}\n"
            f"PRESERVATIVE SYSTEM: {'detected' if has_pres else 'NOT detected'}\n"
            "COMPONENTS:\n" + "\n".join(lines) + "\n\n"
            "Predict stability and return JSON."
        )
