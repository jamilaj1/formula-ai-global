"""
Base class for all specialist agents.

Each agent:
  - takes a Claude client + model name + optional services (DB, RDKit, ...)
  - exposes one `async run(input: dict) -> dict` method
  - returns a structured `AgentResult` with `verdict`, `reasoning`,
    `evidence`, and `confidence`
  - never raises on bad input — returns an error result instead

This pattern makes agents composable and lets the Orchestrator fan
work out in parallel via asyncio.gather.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class AgentResult:
    """Structured output every agent returns."""
    agent: str
    verdict: str                # short label: "safe", "approved", "risky", "ok", "fail"
    reasoning: str              # 1-3 sentence explanation
    evidence: list[dict]        # references / computed values / DB hits
    confidence: float           # 0.0-1.0
    suggestions: list[str] = field(default_factory=list)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class BaseAgent:
    """Common scaffolding — JSON parsing, Claude wrapper, default result."""

    name: str = "base"

    def __init__(self, claude_client=None, model: str = "claude-haiku-4-5"):
        self.claude = claude_client
        self.model = model

    async def run(self, payload: dict[str, Any]) -> AgentResult:
        raise NotImplementedError(f"{self.name}.run() must be implemented by subclass")

    # ─── helpers ───

    async def _ask_claude(self, system: str, user: str, *,
                          max_tokens: int = 1500) -> dict[str, Any] | None:
        """Ask Claude for a JSON response and parse it. Returns None on failure."""
        if self.claude is None:
            return None
        try:
            resp = self.claude.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            text = resp.content[0].text if resp.content else ""
        except Exception as e:  # noqa: BLE001
            return {"_error": f"claude_call_failed: {e}"}
        text = text.strip().replace("```json", "").replace("```", "").strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"_error": "claude_returned_non_json", "_raw": text[:500]}

    def _error_result(self, msg: str) -> AgentResult:
        return AgentResult(
            agent=self.name,
            verdict="error",
            reasoning=msg,
            evidence=[],
            confidence=0.0,
            error=msg,
        )
