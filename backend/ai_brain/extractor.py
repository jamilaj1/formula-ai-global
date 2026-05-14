"""
FormulaExtractor — 4 parallel extraction "eyes":
  1. Regex pattern (e.g. "10% SLES")
  2. Table parser (rows that look tabular)
  3. Claude AI deep read
  4. List parser (1., 2., bullets)

The four sets are deduplicated by component fingerprint.
"""
import re
import json
import hashlib
from typing import Dict, List

import anthropic


class FormulaExtractor:
    def __init__(self, claude_client: anthropic.Anthropic, model: str):
        self.claude = claude_client
        self.model = model

    async def extract_all(self, text: str, source_info: Dict) -> List[Dict]:
        pattern_results = self._extract_by_pattern(text)
        table_results = self._extract_tables(text)
        claude_results = await self._extract_with_claude(text, source_info)
        list_results = self._extract_from_lists(text)
        merged = pattern_results + table_results + claude_results + list_results

        # tag every result with the source so we can cite it later
        for f in merged:
            f.setdefault("source_info", source_info)
        return self._deduplicate(merged)

    # ---------- Eye 1: regex patterns ------------------------
    def _extract_by_pattern(self, text: str) -> List[Dict]:
        formulas = []
        matches = re.findall(r"(\d+\.?\d*)\s*%\s*[-–]?\s*([A-Za-z\s]+)", text)
        if matches:
            components = [
                {"name_en": name.strip(), "percentage": f"{pct}%"}
                for pct, name in matches
            ]
            formulas.append({"components": components, "source": "pattern"})
        return formulas

    # ---------- Eye 2: tabular regions -----------------------
    def _extract_tables(self, text: str) -> List[Dict]:
        formulas = []
        lines = text.split("\n")
        table_lines: List[str] = []
        in_table = False
        for line in lines:
            if "\t" in line or "|" in line or "  " in line:
                if not in_table:
                    in_table = True
                    table_lines = []
                table_lines.append(line)
            else:
                if in_table and len(table_lines) >= 3:
                    formulas.append(
                        {
                            "components": [],
                            "source": "table",
                            "raw_lines": table_lines,
                        }
                    )
                in_table = False
                table_lines = []
        return formulas

    # ---------- Eye 3: Claude deep read ----------------------
    async def _extract_with_claude(
        self, text: str, source_info: Dict
    ) -> List[Dict]:
        system_prompt = (
            "You are an expert chemical formulator. Extract ALL formulas from the "
            "text and return ONLY a JSON array. Each formula is "
            '{"components":[{"name_en":..,"percentage":..,"cas_number":..,"function":..}]}.'
            " Do NOT invent missing info — leave fields empty if unknown."
        )
        try:
            response = self.claude.messages.create(
                model=self.model,
                max_tokens=4096,
                temperature=0.1,
                system=system_prompt,
                messages=[{"role": "user", "content": text[:8000]}],
            )
            content = response.content[0].text
            json_match = re.search(r"\[.*\]", content, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
        except Exception:
            pass
        return []

    # ---------- Eye 4: numbered / bullet lists ---------------
    def _extract_from_lists(self, text: str) -> List[Dict]:
        formulas = []
        lines = text.split("\n")
        list_patterns = [r"^\d+[\.\)]\s", r"^[•\-–]\s", r"^[A-Z][\.\)]\s"]
        for pattern in list_patterns:
            items = []
            for line in lines:
                if re.match(pattern, line):
                    items.append(re.sub(pattern, "", line))
            if len(items) >= 3:
                formulas.append(
                    {"components": [], "source": "list", "raw_items": items}
                )
        return formulas

    # ---------- Dedup by fingerprint -------------------------
    def _deduplicate(self, formulas: List[Dict]) -> List[Dict]:
        seen = set()
        unique = []
        for f in formulas:
            comp_str = json.dumps(
                [
                    (c.get("name_en", ""), c.get("percentage", ""))
                    for c in f.get("components", [])
                ],
                sort_keys=True,
            )
            fp = hashlib.md5(comp_str.encode()).hexdigest()
            if fp not in seen:
                seen.add(fp)
                unique.append(f)
        return unique
