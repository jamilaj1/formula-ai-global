"""
FormulaAIBrain v2 — orchestrator that wires the 6 advanced engines together.

This is the upgraded brain. It composes:
  • ChemicalSafetyEngine    (refuses deadly mixtures)
  • SubstitutionEngine      (4 real economic variants)
  • VirtualLaboratory       (predicts pH/viscosity/shelf life)
  • LearningEngine          (cumulative rules from feedback)
  • KnowledgeGraph          (conceptual relationships)
  • Claude API              (natural language reasoning)

The original `brain.py` is kept untouched for backward compatibility.
Use `FormulaAIBrainV2` for the new pipeline.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .safety_engine import ChemicalSafetyEngine, RiskLevel, quick_safety_check
from .substitution_engine import SubstitutionEngine, EconomicLevel
from .virtual_lab import VirtualLaboratory
from .learning_engine import LearningEngine
from .knowledge_graph import KnowledgeGraph


class FormulaAIBrainV2:
    """Advanced orchestrator. Pure-Python where possible — Claude only for NL."""

    def __init__(
        self,
        supabase_client: Any = None,
        claude_client: Any = None,
        model: str = "claude-sonnet-4-5",
    ) -> None:
        self.supabase = supabase_client
        self.claude = claude_client
        self.model = model

        # The six engines
        self.safety = ChemicalSafetyEngine()
        self.substitution = SubstitutionEngine()
        self.lab = VirtualLaboratory()
        self.learning = LearningEngine(supabase_client)
        self.graph = KnowledgeGraph(supabase_client)

    # ──────────────────────────────────────────────────────────────
    # Main pipeline: analyze a formula end-to-end
    # ──────────────────────────────────────────────────────────────
    def full_analysis(
        self,
        formula: Dict,
        region: str = "global",
        conditions: Optional[Dict] = None,
        context: Optional[Dict] = None,
    ) -> Dict:
        """
        Full pipeline: safety → simulation → variants → learning rules.

        Returns a JSON-serializable dict ready for the API response.
        """
        if conditions is None:
            conditions = {"temperature": 25, "mixing_speed": 500, "mixing_time": 30}
        if context is None:
            context = {}

        components = formula.get("components", [])

        # 1. Safety check (refuse if deadly)
        safety_report = self.safety.analyze_mixture(components, conditions)
        if safety_report.overall_risk == RiskLevel.DEADLY:
            return {
                "status": "rejected",
                "reason": "Deadly chemical combination detected",
                "safety": quick_safety_check(components, conditions.get("temperature", 25)),
            }

        # 2. Apply learned rules from past feedback
        improved, applied_rules = self.learning.apply_learned_rules(formula, context)

        # 3. Virtual lab simulation
        simulation = self.lab.simulate(improved.get("components", components), conditions)

        # 4. Generate 4 economic variants
        variants = self.substitution.generate_all_variants(improved, region)

        # 5. Knowledge-graph suggestions (e.g. "for sensitive skin")
        graph_suggestions: List[Dict] = []
        if context.get("user_condition"):
            graph_suggestions = self.graph.suggest_for_context(
                context["user_condition"], context.get("requirement")
            )

        return {
            "status": "approved" if safety_report.is_safe else "warning",
            "original_formula": formula,
            "improved_formula": improved,
            "applied_learning_rules": applied_rules,
            "safety": quick_safety_check(components, conditions.get("temperature", 25)),
            "simulation": simulation.to_dict(),
            "economic_variants": variants,
            "graph_suggestions": graph_suggestions,
        }

    # ──────────────────────────────────────────────────────────────
    # Conversational search (uses Claude for NL output)
    # ──────────────────────────────────────────────────────────────
    async def conversational_search(self, query: str, language: str = "en") -> Dict:
        if self.claude is None:
            return {
                "answer": "Claude client not configured. Local engines still work.",
                "language": language,
            }

        system_prompt = (
            "You are a senior R&D chemist with 25+ years of hands-on industrial "
            "experience across multiple countries, advising chemical manufacturing "
            "operations that produce 2,000+ tons of finished product per month. "
            f"The user asks in {language}. ALWAYS reply in {language}.\n"
            "Rules:\n"
            "  • Provide formulas with components, percentages, CAS numbers.\n"
            "  • Percentages MUST sum to 100%.\n"
            "  • Cite the source for every formula.\n"
            "  • Flag chemical conflicts before recommending.\n"
            "  • Refuse deadly combinations (bleach + ammonia, etc).\n"
        )

        response = self.claude.messages.create(
            model=self.model,
            max_tokens=4096,
            temperature=0.1,
            system=system_prompt,
            messages=[{"role": "user", "content": query}],
        )
        return {
            "answer": response.content[0].text,
            "language": language,
        }

    # ──────────────────────────────────────────────────────────────
    # Feedback ingestion
    # ──────────────────────────────────────────────────────────────
    async def ingest_feedback(
        self,
        formula_id: str,
        original: Dict,
        corrected: Dict,
        user_id: str,
        notes: str,
    ) -> Dict:
        rule = await self.learning.learn_from_correction(
            formula_id, original, corrected, user_id, notes
        )
        return {
            "status": "learned",
            "rule": rule.to_dict(),
        }
