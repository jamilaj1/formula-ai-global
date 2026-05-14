"""
SubstitutionEngine — real economic variants by swapping materials.

Given a base formula, this engine produces 4 grades:
  • LABORATORY  (highest quality / cost)
  • PREMIUM     (mainstream consumer)
  • INDUSTRIAL  (large-scale manufacturing)
  • ECONOMY    (price-sensitive markets)

It changes ingredients (not just labels), rebalances percentages, and
estimates regional cost based on a multiplier table.

Bug fixes vs spec:
  • imports `re` (was missing)
  • `oil_components` correctly summed (was undefined)
  • Returns dataclass that is JSON-serializable
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from enum import Enum
from typing import Dict, List, Optional


class EconomicLevel(str, Enum):
    LABORATORY = "laboratory"
    PREMIUM = "premium"
    INDUSTRIAL = "industrial"
    ECONOMY = "economy"


@dataclass
class AlternativeMaterial:
    name: str
    cas_number: str
    function: str
    cost_per_kg: float
    effectiveness_score: float  # 0-100
    availability_score: float   # 0-100
    safety_score: float         # 0-100
    compatibility_notes: str
    usage_adjustment: str       # e.g. "use_1.2x" or "use_0.5%"


@dataclass
class SubstitutionPlan:
    target_level: str
    new_components: List[Dict]
    cost_savings_percent: float
    quality_impact: str
    process_changes: List[str]
    stability_prediction: str
    total_cost_per_kg: float

    def to_dict(self) -> Dict:
        return {
            "target_level": self.target_level,
            "new_components": self.new_components,
            "cost_savings_percent": round(self.cost_savings_percent, 1),
            "quality_impact": self.quality_impact,
            "process_changes": self.process_changes,
            "stability_prediction": self.stability_prediction,
            "total_cost_per_kg": round(self.total_cost_per_kg, 2),
        }


class SubstitutionEngine:
    """Real economic-variant generator."""

    REGIONAL_MULTIPLIERS = {
        "global": 1.0,
        "africa_west": 1.30,
        "africa_east": 1.40,
        "middle_east": 1.10,
        "south_asia": 0.90,
        "southeast_asia": 0.85,
        "europe": 1.20,
        "north_america": 1.15,
        "south_america": 1.25,
    }

    def __init__(self) -> None:
        self.alternatives_db: Dict[str, Dict[EconomicLevel, AlternativeMaterial]] = {}
        self.function_keywords: Dict[str, List[str]] = {}
        self._load_alternatives()
        self._load_function_keywords()

    # ──────────────────────────────────────────────────────────────
    # Database
    # ──────────────────────────────────────────────────────────────
    def _alt(
        self, name, cas, function, cost, eff, avail, safety, notes, adjust="use_standard"
    ) -> AlternativeMaterial:
        return AlternativeMaterial(
            name=name, cas_number=cas, function=function, cost_per_kg=cost,
            effectiveness_score=eff, availability_score=avail, safety_score=safety,
            compatibility_notes=notes, usage_adjustment=adjust,
        )

    def _load_alternatives(self) -> None:
        L, P, I, E = (
            EconomicLevel.LABORATORY,
            EconomicLevel.PREMIUM,
            EconomicLevel.INDUSTRIAL,
            EconomicLevel.ECONOMY,
        )

        self.alternatives_db = {
            "surfactant_primary": {
                L: self._alt("Sodium Lauryl Sulfate (SLS) — Ultra Pure", "151-21-3", "primary_surfactant", 12.50, 95, 70, 85, "High foaming, may irritate sensitive skin >20%"),
                P: self._alt("Sodium Laureth Sulfate (SLES-70%)", "68585-34-2", "primary_surfactant", 8.20, 92, 90, 90, "Milder than SLS, good for personal care"),
                I: self._alt("Linear Alkylbenzene Sulfonate (LAS)", "68411-30-3", "primary_surfactant", 3.80, 88, 95, 85, "Excellent for detergents, not for personal care", "use_1.1x"),
                E: self._alt("Soap Noodles (80% TFM)", "61789-31-9", "primary_surfactant", 1.50, 75, 98, 95, "Natural, pH sensitive, hard-water issues", "use_1.3x"),
            },
            "surfactant_secondary": {
                L: self._alt("Cocamidopropyl Betaine — Pure", "61789-40-0", "secondary_surfactant", 15.00, 95, 65, 95, "Excellent foam booster, very mild"),
                P: self._alt("Cocamidopropyl Betaine (30%)", "61789-40-0", "secondary_surfactant", 9.50, 92, 85, 93, "Standard grade"),
                I: self._alt("Cocamide DEA", "68603-42-9", "secondary_surfactant", 4.20, 85, 90, 75, "Good foam, EU regulatory concerns"),
                E: self._alt("Coconut Diethanolamide (CDEA)", "68603-42-9", "secondary_surfactant", 2.80, 80, 95, 80, "Basic foam booster", "use_1.15x"),
            },
            "preservative": {
                L: self._alt("Phenoxyethanol + Ethylhexylglycerin", "122-99-6", "preservative", 45.00, 98, 75, 95, "Broad spectrum, paraben-free", "use_0.8%"),
                P: self._alt("Sodium Benzoate + Potassium Sorbate", "532-32-1", "preservative", 18.50, 90, 95, 92, "Natural positioning, pH < 5.5", "use_0.6%"),
                I: self._alt("Methylisothiazolinone (MIT)", "2682-20-4", "preservative", 35.00, 95, 90, 70, "Effective but sensitization concerns", "use_0.01%"),
                E: self._alt("Citric Acid (preservation aid)", "77-92-9", "preservative", 3.20, 60, 99, 100, "Weak alone, needs pH<4.5", "use_2%"),
            },
            "thickener": {
                L: self._alt("Xanthan Gum — Clear Grade", "11138-66-2", "thickener", 28.00, 95, 80, 98, "Excellent clarity, salt tolerant", "use_0.5%"),
                P: self._alt("Hydroxyethylcellulose (HEC)", "9004-62-0", "thickener", 15.50, 90, 90, 95, "Good compatibility", "use_1.0%"),
                I: self._alt("Sodium Chloride (Salt)", "7647-14-5", "thickener", 0.80, 75, 100, 100, "Only with SLES", "use_2.5%"),
                E: self._alt("Carboxymethyl Cellulose (CMC)", "9004-32-4", "thickener", 4.50, 80, 95, 95, "May reduce foam", "use_1.5%"),
            },
            "emollient": {
                L: self._alt("Hyaluronic Acid — Low MW", "9004-61-9", "emollient", 850.00, 98, 60, 99, "Superior hydration, anti-aging", "use_0.1%"),
                P: self._alt("Glycerin — USP Grade", "56-81-5", "emollient", 5.50, 90, 98, 98, "Universal compatibility", "use_3%"),
                I: self._alt("Propylene Glycol", "57-55-6", "emollient", 3.80, 85, 95, 85, "Good solvent", "use_2%"),
                E: self._alt("Sorbitol 70%", "50-70-4", "emollient", 2.20, 78, 95, 95, "May feel sticky", "use_4%"),
            },
            "chelating": {
                L: self._alt("Tetrasodium EDTA", "64-02-8", "chelating", 18.00, 98, 85, 90, "Excellent stability", "use_0.2%"),
                P: self._alt("Sodium Phytate", "14306-25-3", "chelating", 25.00, 88, 70, 98, "Natural, biodegradable", "use_0.5%"),
                I: self._alt("Citric Acid", "77-92-9", "chelating", 3.20, 75, 99, 100, "Weak chelator", "use_0.5%"),
                E: self._alt("Sodium Citrate", "68-04-2", "chelating", 4.50, 72, 95, 100, "Buffer effect", "use_0.8%"),
            },
            "ph_adjuster": {
                L: self._alt("Triethanolamine (TEA) — Pure", "102-71-6", "ph_adjuster", 12.00, 92, 85, 80, "Good neutralizer"),
                P: self._alt("Sodium Hydroxide (50%)", "1310-73-2", "ph_adjuster", 2.50, 95, 98, 75, "Strong base"),
                I: self._alt("Ammonium Hydroxide (28%)", "1336-21-6", "ph_adjuster", 1.80, 88, 95, 70, "Volatile, strong odor"),
                E: self._alt("Sodium Bicarbonate", "144-55-8", "ph_adjuster", 1.20, 70, 99, 100, "Limited pH range"),
            },
        }

    def _load_function_keywords(self) -> None:
        self.function_keywords = {
            "surfactant_primary": ["sles", "sls", "laureth", "lauryl", "alkylbenzene", "soap"],
            "surfactant_secondary": ["betaine", "cocamide", "amphoteric"],
            "preservative": ["benzoate", "sorbate", "phenoxy", "paraben", "isothiazolinone"],
            "thickener": ["cellulose", "xanthan", "carbomer", "salt", "sodium chloride"],
            "emollient": ["glycerin", "glycerol", "glycol", "sorbitol", "hyaluronic", "oil"],
            "chelating": ["edta", "phytate", "citrate", "polyphosphate"],
            "ph_adjuster": ["hydroxide", "amine", "ammonia", "bicarbonate", "tea"],
        }

    # ──────────────────────────────────────────────────────────────
    # Core API
    # ──────────────────────────────────────────────────────────────
    def create_variant(
        self, formula: Dict, target_level: EconomicLevel, region: str = "global"
    ) -> SubstitutionPlan:
        new_components: List[Dict] = []
        original_cost = new_cost = 0.0
        process_changes: List[str] = []
        multiplier = self.REGIONAL_MULTIPLIERS.get(region, 1.0)

        for comp in formula.get("components", []):
            name = (comp.get("name_en") or comp.get("name") or "").lower()
            pct = self._pct(comp)
            function = self._detect_function(name)
            alt = self._find_alternative(function, target_level)

            if alt:
                regional_cost = alt.cost_per_kg * multiplier
                original_cost += self._estimate_original_cost(name) * (pct / 100)
                new_cost += regional_cost * (pct / 100)

                new_pct = self._apply_adjustment(pct, alt.usage_adjustment)
                new_comp = dict(comp)
                new_comp.update({
                    "name_en": alt.name,
                    "cas_number": alt.cas_number,
                    "percentage": f"{new_pct:.1f}%",
                    "cost_per_kg": round(regional_cost, 2),
                    "effectiveness_score": alt.effectiveness_score,
                    "is_substituted": alt.name != comp.get("name_en"),
                    "original_material": comp.get("name_en"),
                    "usage_adjustment": alt.usage_adjustment,
                })
                if alt.usage_adjustment not in ("use_standard", "use_dropwise_to_target"):
                    process_changes.append(f"{alt.name}: {alt.usage_adjustment}")
                new_components.append(new_comp)
            else:
                # No alternative — keep original (likely water/fragrance)
                cost = self._estimate_original_cost(name)
                original_cost += cost * (pct / 100)
                new_cost += cost * (pct / 100)
                new_components.append(dict(comp))

        new_components = self._rebalance(new_components)
        savings = ((original_cost - new_cost) / original_cost * 100) if original_cost > 0 else 0.0
        quality = self._assess_quality_impact(formula.get("components", []), new_components)
        stability = self._predict_stability(new_components)

        return SubstitutionPlan(
            target_level=target_level.value,
            new_components=new_components,
            cost_savings_percent=savings,
            quality_impact=quality,
            process_changes=process_changes,
            stability_prediction=stability,
            total_cost_per_kg=new_cost,
        )

    def generate_all_variants(self, formula: Dict, region: str = "global") -> Dict[str, Dict]:
        return {
            level.value: self.create_variant(formula, level, region).to_dict()
            for level in EconomicLevel
        }

    # ──────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────
    def _detect_function(self, name: str) -> str:
        for func, keywords in self.function_keywords.items():
            if any(kw in name for kw in keywords):
                return func
        return "unknown"

    def _find_alternative(
        self, function: str, level: EconomicLevel
    ) -> Optional[AlternativeMaterial]:
        if function not in self.alternatives_db:
            return None
        alternatives = self.alternatives_db[function]
        if level in alternatives:
            return alternatives[level]
        # Fallback to nearest level
        order = [
            EconomicLevel.LABORATORY,
            EconomicLevel.PREMIUM,
            EconomicLevel.INDUSTRIAL,
            EconomicLevel.ECONOMY,
        ]
        try:
            idx = order.index(level)
        except ValueError:
            return None
        for offset in range(1, len(order)):
            for direction in (-1, 1):
                i = idx + offset * direction
                if 0 <= i < len(order) and order[i] in alternatives:
                    return alternatives[order[i]]
        return None

    def _estimate_original_cost(self, name: str) -> float:
        prices = {
            "sles": 8.20, "sodium laureth sulfate": 8.20,
            "sls": 12.50, "sodium lauryl sulfate": 12.50,
            "betaine": 9.50, "cocamidopropyl": 9.50,
            "glycerin": 5.50, "glycerol": 5.50,
            "citric acid": 3.20,
            "sodium benzoate": 18.50,
            "water": 0.10,
            "fragrance": 25.00,
        }
        for k, v in prices.items():
            if k in name:
                return v
        return 5.0

    def _apply_adjustment(self, original_pct: float, adjustment: str) -> float:
        if not adjustment or adjustment == "use_standard":
            return original_pct
        # use_1.2x → multiplier
        m = re.search(r"use_([\d.]+)x", adjustment)
        if m:
            return original_pct * float(m.group(1))
        # use_2.5% or use_0.5% → fixed
        m = re.search(r"use_([\d.]+)%", adjustment)
        if m:
            return float(m.group(1))
        return original_pct

    def _rebalance(self, components: List[Dict]) -> List[Dict]:
        total = sum(self._pct(c) for c in components)
        if total > 0 and abs(total - 100) > 0.1:
            factor = 100 / total
            for c in components:
                c["percentage"] = f"{self._pct(c) * factor:.1f}%"
        return components

    def _assess_quality_impact(self, original: List[Dict], new: List[Dict]) -> str:
        original_eff = [self._known_effectiveness(c.get("name_en", "")) for c in original]
        new_eff = [c.get("effectiveness_score", 85) for c in new]
        avg_o = sum(original_eff) / max(len(original_eff), 1)
        avg_n = sum(new_eff) / max(len(new_eff), 1)
        diff = avg_n - avg_o
        if diff >= -2:
            return "No significant quality impact — equivalent performance expected"
        if diff >= -8:
            return f"Minor quality reduction ({abs(diff):.0f}%) — acceptable for price-sensitive markets"
        if diff >= -15:
            return f"Moderate quality reduction ({abs(diff):.0f}%) — may require process optimization"
        return f"Significant quality reduction ({abs(diff):.0f}%) — reformulation recommended"

    def _known_effectiveness(self, material_name: str) -> float:
        for alternatives in self.alternatives_db.values():
            for alt in alternatives.values():
                if alt.name.lower() in material_name.lower():
                    return alt.effectiveness_score
        return 85.0

    def _predict_stability(self, components: List[Dict]) -> str:
        """Predict stability of the new formula. Bug from spec fixed: oil_components defined."""
        anionic = any(
            "sulfate" in (c.get("name_en") or "").lower() or "sulfonate" in (c.get("name_en") or "").lower()
            for c in components
        )
        cationic = any(
            "quaternium" in (c.get("name_en") or "").lower() or "trimonium" in (c.get("name_en") or "").lower()
            for c in components
        )
        oil_components = sum(
            self._pct(c) for c in components
            if any(o in (c.get("name_en") or "").lower() for o in ["oil", "ester", "silicone"])
        )
        water_components = sum(
            self._pct(c) for c in components if "water" in (c.get("name_en") or "").lower()
        )
        emulsifier = any(
            any(t in (c.get("name_en") or "").lower() for t in ["emulsif", "tween", "span", "stearate"])
            for c in components
        )

        issues: List[str] = []
        if anionic and cationic:
            issues.append("Anionic + cationic — possible insoluble complex")
        if oil_components > 20 and water_components > 50 and not emulsifier:
            issues.append("Oil-water separation risk — add emulsifier")
        if not issues:
            return "Stable under standard conditions (15-25°C, <60% RH)"
        return "Stability concerns: " + "; ".join(issues)

    @staticmethod
    def _pct(comp: Dict) -> float:
        try:
            value = comp.get("percentage", "0")
            if isinstance(value, str):
                return float(value.replace("%", "").strip() or 0)
            return float(value)
        except (TypeError, ValueError):
            return 0.0


def generate_economic_variants(formula: Dict, region: str = "global") -> Dict[str, Dict]:
    """Convenience wrapper — produces all four variants ready for JSON."""
    engine = SubstitutionEngine()
    return engine.generate_all_variants(formula, region)
