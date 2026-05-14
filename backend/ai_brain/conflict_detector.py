"""
ConflictDetector — catches well-known chemical incompatibilities so a formula
is never proposed that would degrade in storage or react dangerously.
"""
from typing import Dict, List


# (name_substring_a, name_substring_b, reason)
INCOMPATIBLE_PAIRS = [
    ("cationic", "anionic", "Cationic + anionic surfactants neutralize each other"),
    ("benzalkonium", "sodium laureth sulfate", "Cationic biocide + anionic surfactant — precipitation"),
    ("hypochlorite", "ammonia", "Releases toxic chloramine gas"),
    ("hypochlorite", "acid", "Releases chlorine gas"),
    ("hydrogen peroxide", "iron", "Catalyzed decomposition — heat / oxygen release"),
    ("ascorbic acid", "iron", "Discoloration / oxidation"),
    ("retinol", "ascorbic acid", "Both unstable at low pH together — degradation"),
]


class ConflictDetector:
    def scan(self, formula: Dict) -> List[Dict]:
        names = [
            (c.get("name_en") or c.get("name") or "").lower()
            for c in formula.get("components", [])
        ]
        conflicts = []
        for a, b, reason in INCOMPATIBLE_PAIRS:
            has_a = any(a in n for n in names)
            has_b = any(b in n for n in names)
            if has_a and has_b:
                conflicts.append({"a": a, "b": b, "reason": reason})
        return conflicts
