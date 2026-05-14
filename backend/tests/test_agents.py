"""
Tests for the multi-agent reasoning layer (Phase 3).

Claude is mocked at the agent.claude.messages.create level so these tests
run hermetically. Determinism is tested by checking that the same input
produces the same parsed output, and that error paths (no Claude, bad
JSON, missing fields) all degrade gracefully.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from agents.base import AgentResult, BaseAgent
from agents.cost import CostAgent
from agents.formulator import FormulatorAgent
from agents.orchestrator import Orchestrator
from agents.regulatory import RegulatoryAgent
from agents.safety import SafetyAgent
from agents.stability import StabilityAgent


def _mock_claude_returning(payload: dict) -> MagicMock:
    """Build a mock Claude client that returns `payload` as JSON text."""
    client = MagicMock()
    response = MagicMock()
    content_block = MagicMock()
    content_block.text = json.dumps(payload)
    response.content = [content_block]
    client.messages.create.return_value = response
    return client


# ─── base + result shape ──────────────────────────────────────


def test_agent_result_serialises_to_dict():
    r = AgentResult(
        agent="x", verdict="ok", reasoning="", evidence=[], confidence=0.5
    )
    d = r.to_dict()
    assert d["agent"] == "x"
    assert d["confidence"] == 0.5


def test_base_agent_run_raises():
    a = BaseAgent()
    with pytest.raises(NotImplementedError):
        # noinspection PyTypeChecker
        import asyncio
        asyncio.run(a.run({}))


# ─── FormulatorAgent ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_formulator_missing_product_type():
    agent = FormulatorAgent(claude_client=None)
    r = await agent.run({})
    assert r.verdict == "error"
    assert "product_type" in r.reasoning


@pytest.mark.asyncio
async def test_formulator_no_claude_returns_no_claude():
    agent = FormulatorAgent(claude_client=None)
    r = await agent.run({"product_type": "hand soap"})
    assert r.verdict in {"no_claude", "error"}


@pytest.mark.asyncio
async def test_formulator_filters_unbalanced_proposals():
    """Proposals not summing to ~100% should be filtered out."""
    mock = _mock_claude_returning({
        "proposals": [
            {
                "name": "Hand Soap",
                "category": "personal_hygiene",
                "form_type": "liquid",
                "components": [
                    {"name_en": "Water", "percentage": 70, "function": "solvent"},
                    {"name_en": "SLES",  "percentage": 30, "function": "surfactant"},
                ],
            },
            {
                "name": "Broken",
                "category": "personal_hygiene",
                "form_type": "liquid",
                "components": [
                    {"name_en": "Water", "percentage": 50, "function": "solvent"},
                    {"name_en": "X",     "percentage": 30, "function": "x"},
                ],
            },
        ]
    })
    agent = FormulatorAgent(claude_client=mock)
    r = await agent.run({"product_type": "hand soap"})
    assert r.verdict == "proposed"
    valid = r.evidence[0]["proposals"]
    assert len(valid) == 1
    assert valid[0]["name"] == "Hand Soap"


# ─── SafetyAgent ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_safety_missing_components():
    agent = SafetyAgent()
    r = await agent.run({})
    assert r.verdict == "error"


@pytest.mark.asyncio
async def test_safety_falls_back_to_heuristic_when_no_claude():
    agent = SafetyAgent(claude_client=None)
    r = await agent.run({
        "name": "Cleaner",
        "components": [{"name_en": "Water", "percentage": 100}],
    })
    assert r.verdict in {"safe", "caution", "warning", "unknown"}
    assert r.confidence < 0.5  # heuristic-only confidence is low


@pytest.mark.asyncio
async def test_safety_uses_claude_overall_risk():
    mock = _mock_claude_returning({
        "overall_risk": "caution",
        "ghs_hazards": [{"code": "H315", "category": "Skin irritation"}],
        "ppe_required": ["nitrile gloves"],
    })
    agent = SafetyAgent(claude_client=mock)
    r = await agent.run({
        "name": "Strong Cleaner",
        "components": [{"name_en": "Sodium Hypochlorite", "percentage": 5.0}],
    })
    assert r.verdict == "caution"
    assert r.confidence >= 0.7


# ─── CostAgent (deterministic, no Claude) ─────────────────────


@pytest.mark.asyncio
async def test_cost_computes_breakdown_and_total():
    agent = CostAgent()
    r = await agent.run({
        "components": [
            {"name_en": "Water",   "percentage": 80.0},
            {"name_en": "Sodium Laureth Sulfate", "percentage": 12.0},
        ],
        "prices": [
            {"ingredient_name": "Water", "price_per_kg": 0.1, "currency": "USD"},
            {"ingredient_name": "Sodium Laureth Sulfate", "price_per_kg": 2.5,
             "currency": "USD"},
        ],
        "batch_kg": 100.0,
    })
    assert r.verdict in {"ok", "over_budget"}
    ev = r.evidence[0]
    # Expected: 80kg water * 0.1 + 12kg SLES * 2.5 = 8 + 30 = 38
    assert abs(ev["total_cost"] - 38.0) < 0.1


@pytest.mark.asyncio
async def test_cost_flags_missing_prices():
    agent = CostAgent()
    r = await agent.run({
        "components": [
            {"name_en": "Unknown Ingredient", "percentage": 50.0},
            {"name_en": "Water",              "percentage": 50.0},
        ],
        "prices": [{"ingredient_name": "Water", "price_per_kg": 0.1}],
        "batch_kg": 1.0,
    })
    ev = r.evidence[0]
    assert len(ev["missing"]) == 1
    assert ev["missing"][0]["name"] == "Unknown Ingredient"


# ─── StabilityAgent ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_stability_detects_no_preservative():
    agent = StabilityAgent(claude_client=None)
    r = await agent.run({
        "form_type": "cream",
        "components": [
            {"name_en": "Water", "percentage": 70.0},
            {"name_en": "Glycerin", "percentage": 20.0},
            {"name_en": "Cetyl Alcohol", "percentage": 10.0},
            # NO preservative
        ],
    })
    # Without Claude, falls back to heuristic — should flag missing preservative
    assert "preservative" in r.reasoning.lower() or "marginal" in r.verdict.lower()


@pytest.mark.asyncio
async def test_stability_detects_preservative_present():
    agent = StabilityAgent(claude_client=None)
    r = await agent.run({
        "form_type": "liquid",
        "components": [
            {"name_en": "Water", "percentage": 80.0},
            {"name_en": "Glycerin", "percentage": 15.0},
            {"name_en": "Phenoxyethanol", "percentage": 0.8},
        ],
    })
    assert r.verdict in {"stable", "marginal"}


# ─── RegulatoryAgent ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_regulatory_local_hard_list_catches_banned():
    agent = RegulatoryAgent(claude_client=None)
    r = await agent.run({
        "components": [
            {"name_en": "Mercury Compound X", "percentage": 0.1},
            {"name_en": "Water", "percentage": 99.9},
        ],
        "regions": ["EU", "US"],
    })
    # Even without Claude, local check should find mercury
    local = next((ev["local_findings"] for ev in r.evidence
                  if "local_findings" in ev), [])
    assert any("mercury" in (f.get("match") or "") for f in local)


@pytest.mark.asyncio
async def test_regulatory_local_hard_list_catches_overdose():
    agent = RegulatoryAgent(claude_client=None)
    r = await agent.run({
        "components": [
            {"name_en": "Formaldehyde", "percentage": 1.0},  # > 0.2% cap
            {"name_en": "Water", "percentage": 99.0},
        ],
        "regions": ["EU"],
    })
    local = next((ev["local_findings"] for ev in r.evidence
                  if "local_findings" in ev), [])
    assert any("formaldehyde" in (f.get("match") or "") for f in local)


# ─── Orchestrator ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_orchestrator_evaluate_returns_all_agent_results():
    mock = _mock_claude_returning({"overall_risk": "safe"})  # used by safety only
    orch = Orchestrator(claude_client=mock)
    r = await orch.evaluate({
        "name": "Test Cleaner",
        "form_type": "liquid",
        "components": [
            {"name_en": "Water", "percentage": 90.0},
            {"name_en": "Phenoxyethanol", "percentage": 1.0},
            {"name_en": "Sodium Laureth Sulfate", "percentage": 9.0},
        ],
    })
    assert "agent_results" in r
    for agent_name in ("safety", "cost", "stability", "regulatory"):
        assert agent_name in r["agent_results"]
    assert "overall_verdict" in r
    assert r["overall_verdict"] in {"ready", "acceptable_with_caveats",
                                     "needs_review", "blocked"}


@pytest.mark.asyncio
async def test_orchestrator_score_composition():
    """Verify the score function maps verdicts → reasonable numbers."""
    high_score_eval = {
        "agent_results": {
            "safety": {"verdict": "safe"},
            "cost": {"verdict": "ok"},
            "stability": {"verdict": "stable"},
            "regulatory": {"verdict": "allowed"},
        }
    }
    assert Orchestrator._score_evaluation(high_score_eval) == 1.0

    low_score_eval = {
        "agent_results": {
            "safety": {"verdict": "dangerous"},
            "cost": {"verdict": "over_budget"},
            "stability": {"verdict": "unstable"},
            "regulatory": {"verdict": "blocked"},
        }
    }
    assert Orchestrator._score_evaluation(low_score_eval) < 0.2
