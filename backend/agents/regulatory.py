"""
RegulatoryAgent — region-by-region compliance check.

For each target region, returns:
  - allowed? (boolean)
  - restrictions (concentration caps, age limits, claim restrictions)
  - required documentation (SDS, INCI labeling, product registration)
  - notable banned ingredients in the formula

Supported regions (Phase 3 scope):
  - EU      (REACH / CLP / Cosmetics Regulation 1223/2009)
  - US      (FDA — depends on product class)
  - UK      (mostly EU-aligned post-Brexit)
  - SFDA    (Saudi Arabia)
  - GSO     (Gulf — including UAE, Kuwait, Qatar, Oman, Bahrain)
  - China   (NMPA / CSAR)
  - Japan   (PMDA / quasi-drug rules)
  - Brazil  (ANVISA)

The agent uses Claude (which has broad regulatory training data) plus
a hard-coded set of well-known banned/restricted substances. The hard
list catches the most embarrassing misses (formaldehyde over 0.2% in
cosmetics, etc.); Claude fills in nuance.
"""
from __future__ import annotations

from typing import Any

from .base import AgentResult, BaseAgent


SYSTEM_PROMPT = """You are a regulatory affairs specialist for cosmetics, household chemicals, and industrial formulations.

Given a formula and a list of target regions, output strict JSON:

{
  "results": {
    "<REGION_CODE>": {
      "allowed": true|false,
      "restrictions": [
        {"ingredient": "<name>", "max_concentration": "<e.g. 0.5%>", "rule": "<citation>", "note": "..."}
      ],
      "required_docs": ["SDS", "INCI labeling", "..."],
      "banned_ingredients": ["<name>"],
      "summary": "<2-sentence assessment>"
    },
    ...
  }
}

Recognised region codes: EU, US, UK, SFDA (Saudi), GSO (Gulf), CN (China NMPA), JP (Japan PMDA), BR (Brazil ANVISA).

CITE REAL RULES:
- EU: Cosmetics Regulation (EC) 1223/2009 Annex II/III, REACH Annex XVII
- US: FDA 21 CFR XXX, FDA cosmetic ingredient review
- SFDA: SFDA.CO/CR/GD-XXX-XX
- GSO: GSO 1943:2016 (cosmetics)
- China: CSAR 2021 + IECIC 2021
- Japan: Pharmaceutical Affairs Law, Quasi-Drug ingredient list
- Brazil: RDC No. 7/2015

Output JSON only — no markdown fences."""


# Hard list — minimum baseline (catches gross errors when Claude is unavailable)
GLOBAL_BANNED = {
    "asbestos", "mercury", "hexachlorophene", "vinyl chloride", "lead",
}
GLOBAL_RESTRICTED = {
    "formaldehyde": {"max": 0.2, "form": "cosmetics", "rule": "EU 1223/2009 Annex V"},
    "triclosan": {"max": 0.3, "form": "specific uses", "rule": "EU 1223/2009 Annex V"},
    "phenoxyethanol": {"max": 1.0, "form": "cosmetics", "rule": "EU 1223/2009 Annex V"},
    "methylisothiazolinone": {"max": 0.0015, "form": "rinse-off",
                              "rule": "EU 1223/2009 Annex V — banned in leave-on"},
}


class RegulatoryAgent(BaseAgent):
    name = "regulatory"

    async def run(self, payload: dict[str, Any]) -> AgentResult:
        components = payload.get("components") or []
        regions = payload.get("regions") or ["EU", "US"]
        form_type = payload.get("form_type") or "cosmetic"
        product_class = payload.get("product_class") or "cosmetic"

        if not components:
            return self._error_result("missing components")

        # 1. Quick local check against hard list
        local_findings = self._local_check(components)

        # 2. Ask Claude for full analysis
        user_msg = self._build_user_message(
            components, regions, form_type, product_class, local_findings
        )
        data = await self._ask_claude(SYSTEM_PROMPT, user_msg, max_tokens=2000)
        if data is None or data.get("_error"):
            return AgentResult(
                agent=self.name,
                verdict="incomplete",
                reasoning="Claude unavailable — only local hard-list check performed.",
                evidence=[{"local_findings": local_findings}],
                confidence=0.25,
            )

        results = data.get("results") or {}
        any_banned = any(not r.get("allowed", True) for r in results.values())
        overall = "blocked" if any_banned else "allowed"

        reasoning = (
            f"Checked {len(regions)} region(s). "
            + ("All clear." if not any_banned else
               "Blocked in: " + ", ".join(
                   reg for reg, r in results.items() if not r.get("allowed", True)
               ))
        )

        suggestions = []
        for reg, r in results.items():
            if r.get("banned_ingredients"):
                suggestions.append(
                    f"{reg}: replace banned — {', '.join(r['banned_ingredients'][:3])}"
                )
        if local_findings:
            suggestions.append(
                f"Hard-list flags: {len(local_findings)} ingredient(s) — review concentrations."
            )

        return AgentResult(
            agent=self.name,
            verdict=overall,
            reasoning=reasoning,
            evidence=[{"by_region": results}, {"local_findings": local_findings}],
            confidence=0.7,
            suggestions=suggestions,
        )

    # ─── helpers ───

    @staticmethod
    def _local_check(components: list[dict]) -> list[dict]:
        findings = []
        for c in components:
            name = (c.get("name_en") or "").lower()
            pct = float(c.get("percentage") or 0)
            for banned in GLOBAL_BANNED:
                if banned in name:
                    findings.append({
                        "ingredient": c.get("name_en"),
                        "match": banned,
                        "severity": "blocking",
                        "note": "Globally banned — cannot be marketed under most regulations.",
                    })
            for restricted, rules in GLOBAL_RESTRICTED.items():
                if restricted in name and pct > rules["max"]:
                    findings.append({
                        "ingredient": c.get("name_en"),
                        "match": restricted,
                        "concentration": pct,
                        "max_allowed": rules["max"],
                        "rule": rules["rule"],
                        "severity": "warning",
                    })
        return findings

    def _build_user_message(self, components, regions, form_type, product_class, local):
        lines = [
            f"- {c.get('name_en')} ({c.get('percentage')}%)"
            + (f" CAS {c['cas_number']}" if c.get("cas_number") else "")
            for c in components
        ]
        return (
            f"PRODUCT CLASS: {product_class}\n"
            f"FORM TYPE: {form_type}\n"
            f"TARGET REGIONS: {', '.join(regions)}\n"
            f"COMPONENTS:\n" + "\n".join(lines) + "\n\n"
            f"LOCAL HARD-LIST FLAGS (already detected): {local}\n\n"
            "Provide region-by-region compliance analysis in JSON."
        )
