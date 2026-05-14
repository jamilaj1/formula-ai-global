"""
FormulaAIBrain — orchestrates extract → complete → validate → grade.
Layered "thinking": pattern + table + Claude + list extraction, then
analytical completion, 7-stage critical validation, and 4-grade variants.
"""
from typing import Dict, List

import anthropic
from supabase import Client

from .extractor import FormulaExtractor
from .completer import FormulaCompleter
from .validator import FormulaValidator
from .grader import FormulaGrader
from .safety_checker import SafetyChecker
from .cost_analyzer import CostAnalyzer
from .conflict_detector import ConflictDetector
from .language_detector import LanguageDetector


class FormulaAIBrain:
    """Orchestrator wiring every reasoning module together."""

    def __init__(
        self,
        supabase: Client,
        claude_client: anthropic.Anthropic,
        model: str,
    ):
        self.supabase = supabase
        self.claude = claude_client
        self.model = model

        # reasoning modules
        self.extractor = FormulaExtractor(self.claude, self.model)
        self.completer = FormulaCompleter(self.claude, self.model, supabase)
        self.validator = FormulaValidator(supabase)
        self.grader = FormulaGrader(supabase)
        self.safety = SafetyChecker()
        self.cost = CostAnalyzer()
        self.conflict = ConflictDetector()
        self.language_detector = LanguageDetector()

    # ---------- Pipeline: ingest → reason → output ------------
    async def process_text(self, text: str, source_info: Dict) -> List[Dict]:
        """Run the full multi-eye reasoning pipeline on raw text."""
        # 1. Multi-eye extraction
        raw_formulas = await self.extractor.extract_all(text, source_info)

        # 2. Analytical completion
        completed = []
        for formula in raw_formulas:
            fixed = await self.completer.complete(formula)
            completed.append(fixed)

        # 3. Critical validation (7 stages)
        validated = []
        for formula in completed:
            result = await self.validator.validate(formula)
            if result.get("trust_score", 0) >= 80:
                validated.append(result)

        # 4. Conflict detection
        for formula in validated:
            conflicts = self.conflict.scan(formula)
            formula["conflicts"] = conflicts

        # 5. Safety + cost scoring
        for formula in validated:
            formula["safety"] = self.safety.check(formula)
            formula["cost_score"] = self.cost.estimate_cost_score(formula)

        # 6. 4-grade variants (laboratory / premium / industrial / economy)
        graded = []
        for formula in validated:
            grades = await self.grader.generate_grades(formula)
            formula["variants"] = grades
            graded.append(formula)

        return graded

    # ---------- Conversational search -------------------------
    async def search(self, query: str, language: str = "en") -> str:
        """Answer a chemistry question in the user's own language."""
        if not language:
            language = self.language_detector.detect(query) or "en"

        system_prompt = (
            "You are an expert chemical formulator and a senior R&D chemist with "
            "25+ years of hands-on industrial-chemistry experience across multiple "
            "countries, advising operations that produce 2,000+ tons of finished "
            "product per month. The user asks in {lang}. ALWAYS reply in {lang}.\n"
            "Rules you must follow:\n"
            "  • Provide formulas with components, percentages, CAS numbers.\n"
            "  • Percentages MUST sum to exactly 100%.\n"
            "  • Cite the source (book / patent / journal) for every formula.\n"
            "  • Flag any chemical conflict before recommending.\n"
            "  • Prefer environmentally safe ingredients when affordable.\n"
            "  • If economy grade is requested, optimize for $/kg.\n"
        ).format(lang=language)

        response = self.claude.messages.create(
            model=self.model,
            max_tokens=4096,
            temperature=0.1,
            system=system_prompt,
            messages=[{"role": "user", "content": query}],
        )
        return response.content[0].text
