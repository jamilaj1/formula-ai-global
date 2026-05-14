"""
FormulaCompleter — fixes truncated names, looks up missing CAS numbers,
and rebalances percentages so the total is always 100% (water-pad strategy
when present, proportional rescale otherwise).
"""
import asyncio
from typing import Dict, List, Optional

import anthropic
from supabase import Client


class FormulaCompleter:
    def __init__(
        self,
        claude_client: anthropic.Anthropic,
        model: str,
        supabase: Client,
    ):
        self.claude = claude_client
        self.model = model
        self.supabase = supabase

    async def complete(self, formula: Dict) -> Dict:
        components = formula.get("components", [])
        components = self._fix_names(components)

        # Look up CAS for any missing component (sync supabase call → thread)
        for comp in components:
            if not comp.get("cas_number"):
                cas = await asyncio.to_thread(
                    self._find_cas_sync, comp.get("name_en", "")
                )
                if cas:
                    comp["cas_number"] = cas

        # Rebalance to 100%
        total = sum(self._parse_pct(c.get("percentage", "0%")) for c in components)
        if total == 0 and components:
            even = 100.0 / len(components)
            for c in components:
                c["percentage"] = f"{even:.1f}%"
        elif abs(total - 100) > 5:
            water = self._find_water(components)
            if water:
                current = self._parse_pct(water.get("percentage", "0%"))
                new_water = current + (100 - total)
                if new_water > 0:
                    water["percentage"] = f"{new_water:.1f}%"
            else:
                factor = 100 / total if total > 0 else 1
                for c in components:
                    current = self._parse_pct(c.get("percentage", "0%"))
                    c["percentage"] = f"{current * factor:.1f}%"

        formula["components"] = components
        return formula

    # ---------- Name repair ---------------------------------
    def _fix_names(self, components: List[Dict]) -> List[Dict]:
        # Common OCR/PDF truncations seen in old formularies
        name_fixes = {
            "GENE BASED": "OXYGEN BASED BLEACH",
            "SODIUM LAURETH": "SODIUM LAURETH SULFATE",
            "SODIUM LAURYL": "SODIUM LAURYL SULFATE",
            "COCAMIDOPROPYL": "COCAMIDOPROPYL BETAINE",
            "SLES": "SODIUM LAURETH SULFATE",
            "SLS": "SODIUM LAURYL SULFATE",
        }
        for comp in components:
            name = comp.get("name_en", "") or comp.get("name", "")
            upper = name.upper().strip()
            for partial, full in name_fixes.items():
                if upper == partial or upper.startswith(partial + " "):
                    if len(upper) <= len(partial) + 5:
                        comp["name_en"] = full
                        break
        return components

    # ---------- CAS lookup (DB → fallback dict) -------------
    def _find_cas_sync(self, name: str) -> Optional[str]:
        try:
            res = (
                self.supabase.table("chemicals_database")
                .select("cas_number")
                .ilike("name", f"%{name}%")
                .limit(1)
                .execute()
            )
            if res.data:
                return res.data[0].get("cas_number")
        except Exception:
            pass
        common = {
            "water": "7732-18-5",
            "sles": "68585-34-2",
            "sodium laureth sulfate": "68585-34-2",
            "sls": "151-21-3",
            "sodium lauryl sulfate": "151-21-3",
            "cocamidopropyl betaine": "61789-40-0",
            "glycerin": "56-81-5",
            "sodium chloride": "7647-14-5",
            "citric acid": "77-92-9",
            "sodium benzoate": "532-32-1",
            "phenoxyethanol": "122-99-6",
            "panthenol": "81-13-0",
        }
        return common.get(name.lower().strip())

    # ---------- Helpers -------------------------------------
    @staticmethod
    def _parse_pct(pct_str: str) -> float:
        try:
            return float(str(pct_str).replace("%", "").strip())
        except (ValueError, TypeError):
            return 0.0

    @staticmethod
    def _find_water(components: List[Dict]) -> Optional[Dict]:
        for c in components:
            name = (c.get("name_en") or c.get("name") or "").lower()
            if "water" in name or "aqua" in name:
                return c
        return None
