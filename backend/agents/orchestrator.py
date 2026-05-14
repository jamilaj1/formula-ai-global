"""
Orchestrator — coordinates the specialist agents.

Two workflows:

  workflow="formulate"   propose new recipes for a target product,
                         then run safety+cost+stability+regulatory on each

  workflow="evaluate"    given an existing formula, run the four
                         analysis agents (no formulator) — used by chat
                         when the user submits an existing recipe.

Output is a SINGLE structured result with `summary`, `agent_results` per
agent, an `overall_verdict`, and ranked recommendations.

Agents run in parallel via asyncio.gather where possible. Total wall-
clock for a typical evaluation: 3-8 seconds (depending on Claude latency).
"""
from __future__ import annotations

import asyncio
from typing import Any

from .base import AgentResult
from .cost import CostAgent
from .formulator import FormulatorAgent
from .regulatory import RegulatoryAgent
from .safety import SafetyAgent
from .stability import StabilityAgent


class Orchestrator:
    """Compose specialist agents into a single reasoning pipeline."""

    def __init__(self, claude_client=None, model: str = "claude-haiku-4-5"):
        self.formulator = FormulatorAgent(claude_client, model)
        self.safety = SafetyAgent(claude_client, model)
        self.cost = CostAgent(claude_client, model)
        self.stability = StabilityAgent(claude_client, model)
        self.regulatory = RegulatoryAgent(claude_client, model)

    async def evaluate(self, formula: dict[str, Any], *,
                       regions: list[str] | None = None,
                       prices: list[dict] | None = None,
                       batch_kg: float = 1.0) -> dict[str, Any]:
        """
        Run safety + cost + stability + regulatory in parallel on an
        existing formula. Returns aggregated result.
        """
        safety_payload = {
            "name": formula.get("name") or formula.get("name_en"),
            "form_type": formula.get("form_type"),
            "components": formula.get("components") or [],
        }
        cost_payload = {
            "components": formula.get("components") or [],
            "prices": prices or [],
            "batch_kg": batch_kg,
            "currency": formula.get("currency") or "USD",
        }
        stability_payload = {
            "components": formula.get("components") or [],
            "form_type": formula.get("form_type"),
            "target_ph": (formula.get("properties") or {}).get("ph"),
        }
        regulatory_payload = {
            "components": formula.get("components") or [],
            "form_type": formula.get("form_type"),
            "regions": regions or ["EU", "US"],
            "product_class": formula.get("category") or "cosmetic",
        }

        results = await asyncio.gather(
            self.safety.run(safety_payload),
            self.cost.run(cost_payload),
            self.stability.run(stability_payload),
            self.regulatory.run(regulatory_payload),
            return_exceptions=False,
        )
        safety_r, cost_r, stability_r, regulatory_r = results

        return self._compose(
            formula,
            agent_results={
                "safety": safety_r,
                "cost": cost_r,
                "stability": stability_r,
                "regulatory": regulatory_r,
            },
        )

    async def formulate(self, request: dict[str, Any], *,
                        regions: list[str] | None = None,
                        prices: list[dict] | None = None,
                        batch_kg: float = 1.0) -> dict[str, Any]:
        """
        Propose new formulas for the given product specification, then
        evaluate each proposal through the analysis agents.

        Returns a list of {proposal, evaluation} pairs sorted by overall
        score.
        """
        prop_result = await self.formulator.run(request)
        if prop_result.verdict != "proposed":
            return {
                "summary": "No proposals generated.",
                "overall_verdict": "no_proposal",
                "agent_results": {"formulator": prop_result.to_dict()},
                "candidates": [],
            }
        proposals = (prop_result.evidence[0] or {}).get("proposals", [])

        evaluations = await asyncio.gather(*[
            self.evaluate(p, regions=regions, prices=prices, batch_kg=batch_kg)
            for p in proposals
        ])

        # Score each evaluation
        candidates = []
        for prop, evl in zip(proposals, evaluations):
            score = self._score_evaluation(evl)
            candidates.append({
                "proposal": prop,
                "evaluation": evl,
                "composite_score": score,
            })
        candidates.sort(key=lambda c: c["composite_score"], reverse=True)

        return {
            "request": request,
            "proposals_generated": len(proposals),
            "candidates": candidates,
            "best_candidate_index": 0 if candidates else None,
            "agent_results": {"formulator": prop_result.to_dict()},
            "summary": (
                f"Generated {len(proposals)} proposal(s); top candidate scores "
                f"{candidates[0]['composite_score']:.2f}." if candidates else
                "No viable candidates after evaluation."
            ),
        }

    # ─── private ───

    def _compose(self, formula: dict, agent_results: dict[str, AgentResult]) -> dict:
        verdicts = {k: r.verdict for k, r in agent_results.items()}

        # Overall verdict logic
        if "blocked" in verdicts.values() or "dangerous" in verdicts.values():
            overall = "blocked"
        elif "warning" in verdicts.values() or "over_budget" in verdicts.values():
            overall = "needs_review"
        elif any(v in verdicts.values() for v in ("caution", "marginal", "incomplete_pricing")):
            overall = "acceptable_with_caveats"
        else:
            overall = "ready"

        summary_parts = [f"{k}: {v}" for k, v in verdicts.items()]
        summary = (
            f"Formula '{formula.get('name')}' → overall: {overall}. "
            f"Per-agent: {', '.join(summary_parts)}."
        )

        all_suggestions = []
        for k, r in agent_results.items():
            for s in r.suggestions:
                all_suggestions.append(f"[{k}] {s}")

        return {
            "formula_name": formula.get("name") or formula.get("name_en"),
            "overall_verdict": overall,
            "agent_results": {k: r.to_dict() for k, r in agent_results.items()},
            "summary": summary,
            "recommendations": all_suggestions,
        }

    @staticmethod
    def _score_evaluation(evaluation: dict) -> float:
        """Composite score 0-1 from per-agent verdicts."""
        verdict_weights = {
            "ready": 1.0, "safe": 1.0, "stable": 1.0, "allowed": 1.0, "ok": 1.0,
            "acceptable_with_caveats": 0.75,
            "needs_review": 0.45,
            "marginal": 0.5, "caution": 0.6,
            "incomplete_pricing": 0.55,
            "blocked": 0.0, "dangerous": 0.0, "unstable": 0.1,
        }
        agents = evaluation.get("agent_results", {})
        scores = [verdict_weights.get(r["verdict"], 0.5) for r in agents.values()]
        return round(sum(scores) / max(len(scores), 1), 3)
