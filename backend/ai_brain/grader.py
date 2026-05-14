"""
FormulaGrader — produce 4 economic variants from a single source formula:
  • laboratory  → highest purity, research-grade ingredients
  • premium     → name-brand, consumer-luxury
  • industrial  → bulk-grade, factory-ready
  • economy     → cheapest viable mix (target small manufacturers / poor markets)

Each variant carries its own cost_per_kg estimate and quality_score.
"""
from typing import Dict, List


GRADE_DEFS = {
    "laboratory": {"purity": 0.99, "cost_multiplier": 3.5, "quality": 99},
    "premium":    {"purity": 0.95, "cost_multiplier": 2.0, "quality": 92},
    "industrial": {"purity": 0.90, "cost_multiplier": 1.0, "quality": 85},
    "economy":    {"purity": 0.85, "cost_multiplier": 0.6, "quality": 78},
}


class FormulaGrader:
    def __init__(self, supabase):
        self.supabase = supabase

    async def generate_grades(self, formula: Dict) -> List[Dict]:
        """Return 4 variant dicts, one per economic level."""
        base_cost = float(formula.get("cost_per_kg") or 5.0)
        variants: List[Dict] = []

        for level, params in GRADE_DEFS.items():
            variant = {
                "economic_level": level,
                "components": [dict(c) for c in formula.get("components", [])],
                "purity_target": params["purity"],
                "cost_per_kg": round(base_cost * params["cost_multiplier"], 2),
                "quality_score": params["quality"],
                "from_formula_id": formula.get("id"),
            }
            variants.append(variant)
        return variants
