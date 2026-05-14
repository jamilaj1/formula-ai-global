"""
FormulatorAgent — proposes balanced ingredient lists for a target product.

Input  (dict):
  {
    "product_type": "anti-dandruff shampoo for kids",
    "target_attributes": ["sulfate-free", "ph 5.5", "for sensitive scalp"],
    "constraints": {"cost_per_kg_max": 3.0, "currency": "USD"},
    "starting_from": [optional: list of existing formulas to remix],
  }

Output (AgentResult):
  verdict: "proposed" | "no_proposal"
  evidence.proposals: list of formulas, each balanced to 100%, with
                      per-component {name_en, percentage, function}
  reasoning: short paragraph on the design choices
"""
from __future__ import annotations

from typing import Any

from .base import AgentResult, BaseAgent


SYSTEM_PROMPT = """You are an expert chemical formulator with 25+ years of factory experience producing 2,000+ tons per month of industrial chemistry across multiple countries.

Your job: propose realistic, balanced ingredient lists for a target product.

OUTPUT FORMAT — strict JSON only, no prose:
{
  "proposals": [
    {
      "name": "<descriptive name>",
      "category": "<one of: cleaning, disinfectants, hair_care, skin_care, body_care, personal_hygiene, color_cosmetics, laundry, dishwashing, automotive, industrial, agriculture, food_beverage, pet_care, adhesives, coatings, specialty, oral_care, paint_coating, glass_ceramics, hair_removal, home_fragrance, household, pool_water_treatment, water_treatment, boiler_cooling, metal_treatment, body_treatment, topical_analgesic, face_makeup, face_mask, massage, pest_control>",
      "form_type": "liquid|gel|cream|powder|paste|aerosol|tablet|emulsion",
      "components": [
        {"name_en": "Water (Aqua)", "cas_number": "7732-18-5", "percentage": 60.0, "function": "solvent"},
        ...
      ],
      "process_conditions": {"order_of_addition": "1. ... 2. ..."},
      "design_rationale": "1-2 sentence why this works for the requested product"
    },
    ... (1 to 3 proposals)
  ]
}

RULES:
1. Every formula MUST sum to exactly 100.00% (water/aqua balances the remainder).
2. Use real industrial chemistry — never invented compounds.
3. Use the EXACT functional categories from the schema.
4. CAS numbers are required when known; null if uncertain.
5. Respect any cost/attribute constraints in the request.
6. If the request is impossible (e.g. "sulfate-free shampoo that strips paint"), return {"proposals": []} and reasoning will say why.
7. Cap at 3 proposals — focus on quality over quantity.
8. Never propose harmful, illegal, or restricted formulations (drugs, explosives, weapons)."""


class FormulatorAgent(BaseAgent):
    name = "formulator"

    async def run(self, payload: dict[str, Any]) -> AgentResult:
        product_type = (payload.get("product_type") or "").strip()
        if not product_type:
            return self._error_result("missing product_type")

        target_attrs = payload.get("target_attributes") or []
        constraints = payload.get("constraints") or {}
        starting_from = payload.get("starting_from") or []

        user_msg = (
            f"PRODUCT TYPE: {product_type}\n"
            f"TARGET ATTRIBUTES: {', '.join(target_attrs) if target_attrs else 'none'}\n"
            f"CONSTRAINTS: {constraints if constraints else 'none'}\n"
        )
        if starting_from:
            user_msg += f"INSPIRATION FORMULAS (existing matches from our DB):\n{starting_from}\n"
        user_msg += "\nPropose 1-3 balanced formulas. Return JSON only."

        data = await self._ask_claude(SYSTEM_PROMPT, user_msg, max_tokens=2000)
        if data is None:
            return AgentResult(
                agent=self.name,
                verdict="no_claude",
                reasoning="No Claude client configured for formulator agent.",
                evidence=[],
                confidence=0.0,
            )
        if data.get("_error"):
            return self._error_result(data["_error"])

        proposals = data.get("proposals") or []

        # Validate: each proposal must balance to ~100%
        valid_proposals = []
        for p in proposals:
            comps = p.get("components") or []
            total = sum(float(c.get("percentage") or 0) for c in comps)
            if 99 <= total <= 101:
                p["_total_percentage"] = round(total, 2)
                valid_proposals.append(p)
            else:
                p["_total_percentage"] = round(total, 2)
                p["_unbalanced"] = True

        if not valid_proposals:
            return AgentResult(
                agent=self.name,
                verdict="no_proposal",
                reasoning="Claude returned proposals but none balanced to ~100%.",
                evidence=[{"raw_proposals": proposals}],
                confidence=0.2,
            )

        return AgentResult(
            agent=self.name,
            verdict="proposed",
            reasoning=(
                f"Generated {len(valid_proposals)} balanced proposal(s) for "
                f"'{product_type}'."
                + (f" Filtered {len(proposals) - len(valid_proposals)} "
                   "unbalanced draft(s)." if proposals != valid_proposals else "")
            ),
            evidence=[{"proposals": valid_proposals}],
            confidence=0.7,
            suggestions=[
                "Run safety + regulatory agents on each proposal before committing.",
                "Verify pricing with cost agent against current spot prices.",
            ],
        )
