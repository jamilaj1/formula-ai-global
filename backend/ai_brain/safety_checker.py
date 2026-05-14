"""
SafetyChecker — flags banned substances, hazardous combos, and computes an
environmental score 0-100 (higher = greener).
"""
from typing import Dict, List


# CAS numbers banned in major markets (EU, US, KSA). Extend as needed.
GLOBALLY_BANNED_CAS = {
    "84-74-2": "DBP — banned in cosmetics",
    "117-81-7": "DEHP — banned in toys",
    "1336-36-3": "PCBs — globally banned",
    "75-15-0": "Carbon disulfide — heavy restrictions",
}

HAZARD_KEYWORDS = ("toxic", "carcinogen", "mutagen", "explosive")


class SafetyChecker:
    def check(self, formula: Dict) -> Dict:
        components = formula.get("components", [])
        warnings: List[str] = []
        eco_score = 100

        for comp in components:
            cas = (comp.get("cas_number") or "").strip()
            if cas in GLOBALLY_BANNED_CAS:
                warnings.append(f"{comp.get('name_en')} — {GLOBALLY_BANNED_CAS[cas]}")
                eco_score -= 25

            hazards = (comp.get("hazards") or "").lower()
            if any(k in hazards for k in HAZARD_KEYWORDS):
                eco_score -= 10
                warnings.append(f"{comp.get('name_en')} — hazardous classification")

        status = "safe"
        if eco_score < 60:
            status = "danger"
        elif eco_score < 80:
            status = "caution"

        return {
            "status": status,
            "eco_score": max(0, eco_score),
            "warnings": warnings,
        }
