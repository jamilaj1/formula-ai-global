"""
SafetyAgent — GHS classification + interaction analysis.

Combines:
  - Fast heuristic conflict scan (services.substitution.conflict_check)
  - Claude analysis with GHS rule knowledge
  - Component-level safety lookup (via SafetyChecker if available)

Output identifies hazards, required PPE, storage rules, regulatory flags,
and an overall risk label.
"""
from __future__ import annotations

from typing import Any

from services.substitution import conflict_check

from .base import AgentResult, BaseAgent


SYSTEM_PROMPT = """You are a senior chemical safety expert specializing in GHS classification, OSHA/HCS, EU CLP, and industrial cosmetics safety.

Analyze the given formula and output strict JSON:

{
  "overall_risk": "safe|caution|warning|dangerous",
  "ghs_hazards": [
    {"code": "H315", "category": "Skin irritation Cat 2", "applies_to": ["<ingredient_name>"]}
  ],
  "interactions": [
    {"between": ["<a>", "<b>"], "type": "incompatible|reactive|neutralizing", "severity": "low|medium|high", "note": "..."}
  ],
  "ppe_required": ["nitrile gloves", "safety goggles", "ventilated area", ...],
  "storage": "<recommended storage conditions>",
  "regulatory_flags": [
    {"region": "EU", "concern": "...", "rule": "REACH Annex XVII entry XX"},
    {"region": "US", "concern": "...", "rule": "FDA 21 CFR XXX"}
  ],
  "ar_summary": "<2-sentence summary in Arabic>"
}

RULES:
1. Use ONLY recognized GHS H-codes (H200-H499).
2. Cite real regulatory rules when you flag (REACH Annex, FDA CFR section, etc).
3. Conservative: when in doubt, escalate severity by one tier.
4. Output JSON only — no markdown fences, no prose outside the object."""


class SafetyAgent(BaseAgent):
    name = "safety"

    async def run(self, payload: dict[str, Any]) -> AgentResult:
        components = payload.get("components") or []
        name = payload.get("name") or "unnamed formula"
        form_type = payload.get("form_type") or "unknown"

        if not components:
            return self._error_result("missing components")

        # 1. Cheap deterministic heuristics first
        heuristic = conflict_check(components)

        # 2. Build Claude prompt with the ingredient list
        ing_lines = []
        for c in components:
            line = f"- {c.get('name_en') or c.get('name')} ({c.get('percentage')}%)"
            if c.get("cas_number"):
                line += f" CAS {c['cas_number']}"
            if (c.get("chem") or {}).get("formula"):
                line += f" [{c['chem']['formula']}]"
            ing_lines.append(line)

        user_msg = (
            f"FORMULA: {name}\n"
            f"FORM TYPE: {form_type}\n"
            f"COMPONENTS:\n" + "\n".join(ing_lines) + "\n\n"
            f"PRE-DETECTED ISSUES (from local heuristics):\n"
            f"{heuristic}\n\n"
            "Provide your full safety analysis in JSON."
        )

        data = await self._ask_claude(SYSTEM_PROMPT, user_msg, max_tokens=1500)
        if data is None:
            # Fall back to heuristic-only result
            return AgentResult(
                agent=self.name,
                verdict=heuristic.get("overall_risk", "unknown"),
                reasoning="No Claude available — returning heuristic-only analysis.",
                evidence=[{"heuristic": heuristic}],
                confidence=0.35,
            )
        if data.get("_error"):
            return self._error_result(data["_error"])

        risk = data.get("overall_risk", "unknown")
        verdict_map = {
            "safe": "safe",
            "caution": "caution",
            "warning": "warning",
            "dangerous": "dangerous",
        }
        verdict = verdict_map.get(risk, "unknown")

        reasoning_parts = []
        if data.get("ghs_hazards"):
            reasoning_parts.append(f"{len(data['ghs_hazards'])} GHS hazard(s)")
        if data.get("interactions"):
            reasoning_parts.append(f"{len(data['interactions'])} ingredient interaction(s)")
        if heuristic.get("issues_found", 0):
            reasoning_parts.append(f"{heuristic['issues_found']} local conflict(s)")
        reasoning = (
            f"Overall risk: {risk}. "
            + ("Concerns: " + "; ".join(reasoning_parts) if reasoning_parts else "No major flags.")
        )

        return AgentResult(
            agent=self.name,
            verdict=verdict,
            reasoning=reasoning,
            evidence=[{"claude_analysis": data}, {"heuristic": heuristic}],
            confidence=0.75 if verdict != "unknown" else 0.4,
            suggestions=self._build_suggestions(data),
        )

    def _build_suggestions(self, analysis: dict) -> list[str]:
        out = []
        if analysis.get("ppe_required"):
            out.append("Document PPE requirements on SDS: " + ", ".join(analysis["ppe_required"][:3]))
        if analysis.get("storage"):
            out.append(f"Storage: {analysis['storage']}")
        flags = analysis.get("regulatory_flags") or []
        if flags:
            out.append(f"Verify {len(flags)} regulatory flag(s) for target markets.")
        return out
