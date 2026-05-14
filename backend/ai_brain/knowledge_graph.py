"""
KnowledgeGraph — relationships between chemicals, conditions, and goals.

Lightweight in-memory graph that grows with usage. Supports:
  • finding substitutes
  • compatibility checks
  • context-aware suggestions ("sensitive_skin → mild surfactant")
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple


class KnowledgeGraph:
    """In-memory + Supabase-backed knowledge graph."""

    def __init__(self, supabase_client=None) -> None:
        self.supabase = supabase_client
        self.nodes: Dict[str, Dict] = {}
        self.edges: List[Tuple[str, str, str, float]] = []
        self._load_core()

    def _load_core(self) -> None:
        # Materials
        self.nodes = {
            "sodium_laureth_sulfate": {
                "type": "surfactant", "display_name": "Sodium Laureth Sulfate (SLES)",
                "properties": ["anionic", "foaming", "cleansing"],
                "safety_profile": "moderate_irritant", "cost_tier": "mid",
            },
            "sodium_lauryl_sulfate": {
                "type": "surfactant", "display_name": "Sodium Lauryl Sulfate (SLS)",
                "properties": ["anionic", "high_foaming", "cleansing"],
                "safety_profile": "irritant", "cost_tier": "mid",
            },
            "cocamidopropyl_betaine": {
                "type": "surfactant", "display_name": "Cocamidopropyl Betaine",
                "properties": ["amphoteric", "foam_booster", "mild"],
                "safety_profile": "safe", "cost_tier": "mid",
            },
            "glycerin": {
                "type": "humectant", "display_name": "Glycerin (USP)",
                "properties": ["moisturizing", "viscosity_builder", "safe"],
                "safety_profile": "very_safe", "cost_tier": "low",
            },
            "propylene_glycol": {
                "type": "humectant", "display_name": "Propylene Glycol",
                "properties": ["moisturizing", "solvent"],
                "safety_profile": "safe", "cost_tier": "low",
            },
            "phenoxyethanol": {
                "type": "preservative", "display_name": "Phenoxyethanol",
                "properties": ["broad_spectrum", "paraben_free"],
                "safety_profile": "safe", "cost_tier": "high",
            },
            "sodium_benzoate": {
                "type": "preservative", "display_name": "Sodium Benzoate",
                "properties": ["natural", "low_pH_required"],
                "safety_profile": "safe", "cost_tier": "low",
            },
            "citric_acid": {
                "type": "ph_adjuster", "display_name": "Citric Acid",
                "properties": ["acidic", "natural", "chelating"],
                "safety_profile": "safe", "cost_tier": "low",
            },
            # Conditions / goals
            "sensitive_skin": {
                "type": "condition",
                "properties": ["requires_mild_surfactants", "low_pH_preferred"],
            },
            "high_foaming": {
                "type": "requirement",
                "properties": ["needs_primary_surfactant", "foam_booster_helpful"],
            },
            "natural_positioning": {
                "type": "requirement",
                "properties": ["paraben_free", "sulfate_free", "biodegradable"],
            },
        }

        # (source, relation, target, confidence)
        self.edges = [
            ("sodium_laureth_sulfate", "compatible_with", "cocamidopropyl_betaine", 0.95),
            ("sodium_laureth_sulfate", "synergizes_with", "cocamidopropyl_betaine", 0.90),
            ("cocamidopropyl_betaine", "reduces_irritation_of", "sodium_laureth_sulfate", 0.88),
            ("cocamidopropyl_betaine", "can_substitute_for", "sodium_lauryl_sulfate", 0.70),
            ("glycerin", "can_substitute_for", "propylene_glycol", 0.85),
            ("phenoxyethanol", "can_substitute_for", "sodium_benzoate", 0.75),
            ("sodium_benzoate", "requires", "citric_acid", 0.85),
            ("sensitive_skin", "requires", "cocamidopropyl_betaine", 0.92),
            ("sensitive_skin", "avoids", "sodium_lauryl_sulfate", 0.80),
            ("high_foaming", "requires", "sodium_laureth_sulfate", 0.85),
            ("natural_positioning", "avoids", "sodium_lauryl_sulfate", 0.95),
            ("natural_positioning", "requires", "sodium_benzoate", 0.80),
        ]

    # ──────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────
    def find_substitutes(self, material: str, constraints: Optional[Dict] = None) -> List[Dict]:
        constraints = constraints or {}
        norm = self._normalize(material)
        candidates: List[Dict] = []

        for source, relation, target, confidence in self.edges:
            if relation != "can_substitute_for":
                continue
            if source == norm:
                candidates.append({
                    "material": target,
                    "display_name": self.nodes.get(target, {}).get("display_name", target),
                    "confidence": confidence,
                    "relation": relation,
                })
            elif target == norm:
                candidates.append({
                    "material": source,
                    "display_name": self.nodes.get(source, {}).get("display_name", source),
                    "confidence": confidence,
                    "relation": "reverse_substitute",
                })

        if "safety_profile" in constraints:
            candidates = [
                c for c in candidates
                if self.nodes.get(c["material"], {}).get("safety_profile") == constraints["safety_profile"]
            ]
        return sorted(candidates, key=lambda x: x["confidence"], reverse=True)

    def check_compatibility(self, material_a: str, material_b: str) -> Dict:
        a, b = self._normalize(material_a), self._normalize(material_b)
        for source, relation, target, conf in self.edges:
            if (source == a and target == b) or (source == b and target == a):
                return {
                    "compatible": relation in ("compatible_with", "synergizes_with"),
                    "relation": relation,
                    "confidence": conf,
                }
        return {"compatible": None, "relation": "unknown", "confidence": 0.0}

    def suggest_for_context(self, context: str, requirement: Optional[str] = None) -> List[Dict]:
        ctx = self._normalize(context)
        suggestions: List[Dict] = []
        for source, relation, target, conf in self.edges:
            if source == ctx and relation in ("requires", "benefits_from"):
                target_props = self.nodes.get(target, {}).get("properties", [])
                if requirement is None or requirement in target_props:
                    suggestions.append({
                        "material": target,
                        "display_name": self.nodes.get(target, {}).get("display_name", target),
                        "confidence": conf,
                        "reason": f"{ctx} {relation} {target}",
                    })
        return sorted(suggestions, key=lambda x: x["confidence"], reverse=True)

    def add_experience(
        self, formula_id: str, components: List[str], outcome: str, rating: float
    ) -> None:
        """Strengthen edges between successfully co-used materials."""
        if rating < 0.8:
            return
        normed = [self._normalize(c) for c in components if c]
        for i, mat_a in enumerate(normed):
            for mat_b in normed[i + 1:]:
                self._reinforce(mat_a, mat_b, "compatible_with", rating)

    def _reinforce(self, a: str, b: str, relation: str, rating: float) -> None:
        for idx, (s, r, t, c) in enumerate(self.edges):
            if r == relation and ((s == a and t == b) or (s == b and t == a)):
                new_conf = min(0.99, c + (rating - 0.8) * 0.05)
                self.edges[idx] = (s, r, t, new_conf)
                return
        # New edge
        self.edges.append((a, relation, b, 0.6))

    # ──────────────────────────────────────────────────────────────
    @staticmethod
    def _normalize(name: str) -> str:
        return (name or "").lower().strip().replace(" ", "_").replace("-", "_")
