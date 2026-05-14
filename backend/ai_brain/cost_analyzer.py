"""
CostAnalyzer — rough $/kg estimate from component prices + economic-level multiplier.
Falls back to a flat 85/100 score when prices are missing.
"""
from typing import Dict


# Default unit prices ($/kg) for common chemicals — extend with DB lookups later.
DEFAULT_PRICES = {
    "water": 0.001,
    "sodium laureth sulfate": 1.20,
    "sodium lauryl sulfate": 1.10,
    "cocamidopropyl betaine": 2.30,
    "glycerin": 1.80,
    "citric acid": 1.50,
    "sodium chloride": 0.20,
    "phenoxyethanol": 6.50,
    "fragrance": 12.00,
}


class CostAnalyzer:
    def estimate_cost_per_kg(self, formula: Dict) -> float:
        total = 0.0
        for comp in formula.get("components", []):
            try:
                pct = float(str(comp.get("percentage", "0%")).replace("%", "")) / 100.0
            except ValueError:
                pct = 0.0
            name = (comp.get("name_en") or comp.get("name") or "").lower().strip()
            unit = comp.get("price_per_kg") or DEFAULT_PRICES.get(name, 1.0)
            total += pct * float(unit)
        return round(total, 3)

    def estimate_cost_score(self, formula: Dict) -> float:
        """Score 0-100 (higher = more affordable). 0$/kg → 100, 30$/kg → 0."""
        cost = self.estimate_cost_per_kg(formula)
        if cost <= 0:
            return 85.0
        score = max(0.0, 100 - (cost / 30.0 * 100))
        return round(score, 1)
