"""
FormulaValidator — 7-stage critical thinking:
  1. Source verified         (any source_info present?)
  2. Percentage sum is 100   (±2 % tolerance)
  3. Every component has CAS
  4. Conflict-free           (no incompatible mixes)
  5. Safety rules respected
  6. Quality threshold met
  7. Description / process present

Returns the formula with a numeric `trust_score` 0-100.
"""
from typing import Dict


class FormulaValidator:
    def __init__(self, supabase):
        self.supabase = supabase

    async def validate(self, formula: Dict) -> Dict:
        score = 100.0
        issues = []

        # 1. source ----------------------------------------------------
        if not formula.get("source_info") and not formula.get("source_title"):
            score -= 10
            issues.append("missing_source")

        # 2. % sum -----------------------------------------------------
        total = 0.0
        for c in formula.get("components", []):
            try:
                total += float(str(c.get("percentage", "0%")).replace("%", ""))
            except ValueError:
                pass
        if abs(total - 100) > 2:
            score -= 30
            issues.append(f"sum_off_{total:.1f}")

        # 3. CAS coverage ---------------------------------------------
        comps = formula.get("components", [])
        if comps and not all(c.get("cas_number") for c in comps):
            score -= 20
            issues.append("missing_cas")

        # 4. conflicts (placeholder — real check in conflict_detector)
        if formula.get("conflicts"):
            score -= 25
            issues.append("conflicts")

        # 5. safety ---------------------------------------------------
        if (formula.get("safety") or {}).get("status") == "danger":
            score -= 30
            issues.append("unsafe")

        # 6. quality / description -----------------------------------
        if not formula.get("description"):
            score -= 5
            issues.append("missing_description")

        # 7. process conditions --------------------------------------
        if not formula.get("process_conditions"):
            score -= 5
            issues.append("missing_process")

        formula["trust_score"] = max(0.0, score)
        formula["validation_issues"] = issues
        formula["completeness_score"] = max(0.0, score)
        return formula
