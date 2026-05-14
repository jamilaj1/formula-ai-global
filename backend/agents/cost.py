"""
CostAgent — batch-level cost analysis with optimisation hints.

Reads:
  - The formula components + percentages
  - The user's ingredient_prices table (or a passed-in price dict)

Returns:
  - total_cost per kg
  - per-component breakdown
  - missing-price flags
  - cheaper-substitute suggestions (when scored highly enough)
"""
from __future__ import annotations

from typing import Any

from .base import AgentResult, BaseAgent


class CostAgent(BaseAgent):
    """
    No Claude required for the basic case — this is deterministic math.
    Claude is only used (optionally) to generate optimisation suggestions.
    """

    name = "cost"

    async def run(self, payload: dict[str, Any]) -> AgentResult:
        components = payload.get("components") or []
        prices = payload.get("prices") or []  # [{name, cas, price_per_kg, currency}]
        batch_kg = float(payload.get("batch_kg") or 1.0)
        currency = payload.get("currency") or "USD"

        if not components:
            return self._error_result("missing components")

        by_name = {}
        by_cas = {}
        for p in prices:
            by_name[(p.get("ingredient_name") or "").lower()] = p
            if p.get("cas_number"):
                by_cas[p["cas_number"]] = p

        breakdown = []
        missing = []
        total = 0.0
        for c in components:
            name = (c.get("name_en") or c.get("name") or "").strip()
            pct = float(c.get("percentage") or 0)
            if not name or pct <= 0:
                continue
            mass_kg = (pct / 100.0) * batch_kg

            price = (c.get("cas_number") and by_cas.get(c["cas_number"])) \
                or by_name.get(name.lower())
            if price:
                cost = mass_kg * float(price.get("price_per_kg") or 0)
                total += cost
                breakdown.append({
                    "name": name,
                    "percentage": pct,
                    "mass_kg": round(mass_kg, 4),
                    "price_per_kg": float(price.get("price_per_kg") or 0),
                    "cost": round(cost, 4),
                    "currency": price.get("currency", currency),
                })
            else:
                missing.append({"name": name, "percentage": pct,
                                "mass_kg": round(mass_kg, 4)})

        coverage_pct = (
            int((len(breakdown) / (len(breakdown) + len(missing))) * 100)
            if (breakdown or missing) else 0
        )

        verdict = "ok"
        if coverage_pct < 70:
            verdict = "incomplete_pricing"
        elif total / batch_kg > float(payload.get("target_cost_per_kg") or 1e9):
            verdict = "over_budget"

        reasoning = (
            f"Total {currency} {round(total, 4)} for {batch_kg} kg batch "
            f"({round(total / batch_kg, 4)}/kg). "
            f"{coverage_pct}% of ingredients have known prices."
        )

        suggestions = []
        if missing:
            suggestions.append(
                f"Add prices for {len(missing)} ingredient(s) to get full cost coverage: "
                + ", ".join(m["name"] for m in missing[:5])
            )
        if breakdown:
            top_cost = sorted(breakdown, key=lambda b: b["cost"], reverse=True)[:3]
            if top_cost:
                suggestions.append(
                    "Top cost drivers: "
                    + ", ".join(f"{b['name']} ({b['cost']:.2f})" for b in top_cost)
                )

        return AgentResult(
            agent=self.name,
            verdict=verdict,
            reasoning=reasoning,
            evidence=[{
                "batch_kg": batch_kg,
                "currency": currency,
                "total_cost": round(total, 4),
                "cost_per_kg": round(total / batch_kg, 4) if batch_kg else 0,
                "breakdown": breakdown,
                "missing": missing,
                "coverage_pct": coverage_pct,
            }],
            confidence=0.95 if coverage_pct >= 90 else (0.6 if coverage_pct >= 70 else 0.3),
            suggestions=suggestions,
        )
