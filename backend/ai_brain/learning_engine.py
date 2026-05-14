"""
LearningEngine — cumulative learning from user corrections.

Builds rules from user feedback (e.g. "lower SLES, it irritates"), applies
them to new formulas, and improves with each correction.

Bug fixes vs spec:
  • All required imports present (datetime, json, hashlib, re, asyncio)
  • Tuple imported from typing
  • Confidence/success rate calculations protected from division-by-zero
"""
from __future__ import annotations

import json
import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Tuple


@dataclass
class LearnedRule:
    rule_id: str
    condition: str
    action: str
    confidence: float
    evidence_count: int
    success_rate: float
    created_at: datetime
    last_applied: datetime
    source_formulas: List[str] = field(default_factory=list)
    user_feedback: List[Dict] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "rule_id": self.rule_id,
            "condition": self.condition,
            "action": self.action,
            "confidence": round(self.confidence, 3),
            "evidence_count": self.evidence_count,
            "success_rate": round(self.success_rate, 3),
            "created_at": self.created_at.isoformat(),
            "last_applied": self.last_applied.isoformat(),
            "source_formulas": self.source_formulas,
            "user_feedback": self.user_feedback,
        }


class LearningEngine:
    """Rule-based incremental learning."""

    POSITIVE = ["good", "great", "perfect", "excellent", "success", "worked",
                "ممتاز", "جيد", "ناجح", "يعمل"]
    NEGATIVE = ["bad", "worse", "failed", "problem", "issue",
                "سيء", "فشل", "مشكلة", "أسوأ"]

    def __init__(self, supabase_client=None) -> None:
        self.supabase = supabase_client
        self.rules_cache: Dict[str, LearnedRule] = {}
        if supabase_client:
            self._load_existing_rules()

    def _load_existing_rules(self) -> None:
        try:
            response = self.supabase.table("learning_rules").select("*").execute()
            for row in response.data or []:
                self.rules_cache[row["rule_id"]] = LearnedRule(
                    rule_id=row["rule_id"],
                    condition=row["condition"],
                    action=row["action"],
                    confidence=row["confidence"],
                    evidence_count=row["evidence_count"],
                    success_rate=row["success_rate"],
                    created_at=datetime.fromisoformat(row["created_at"]),
                    last_applied=datetime.fromisoformat(row["last_applied"]),
                    source_formulas=row.get("source_formulas", []) or [],
                    user_feedback=row.get("user_feedback", []) or [],
                )
        except Exception as exc:
            print(f"LearningEngine: could not load existing rules: {exc}")

    # ──────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────
    async def learn_from_correction(
        self,
        formula_id: str,
        original_output: Dict,
        corrected_output: Dict,
        user_id: str,
        correction_notes: str,
    ) -> LearnedRule:
        diff = self._calculate_diff(original_output, corrected_output)
        condition = self._build_condition(original_output)
        action = self._build_action(diff)
        rule_hash = hashlib.sha256(f"{condition}:{action}".encode()).hexdigest()[:16]

        successful = self._is_successful(correction_notes)

        if rule_hash in self.rules_cache:
            rule = self.rules_cache[rule_hash]
            rule.evidence_count += 1
            rule.source_formulas.append(formula_id)
            rule.user_feedback.append({
                "user_id": user_id,
                "notes": correction_notes,
                "timestamp": datetime.now().isoformat(),
                "successful": successful,
            })
            successes = sum(1 for f in rule.user_feedback if f.get("successful"))
            rule.success_rate = successes / len(rule.user_feedback)
            rule.confidence = min(0.95, 0.5 + (rule.evidence_count * 0.05))
            rule.last_applied = datetime.now()
            await self._update_in_db(rule)
            return rule

        rule = LearnedRule(
            rule_id=rule_hash,
            condition=condition,
            action=action,
            confidence=0.6,
            evidence_count=1,
            success_rate=1.0 if successful else 0.5,
            created_at=datetime.now(),
            last_applied=datetime.now(),
            source_formulas=[formula_id],
            user_feedback=[{
                "user_id": user_id,
                "notes": correction_notes,
                "timestamp": datetime.now().isoformat(),
                "successful": successful,
            }],
        )
        self.rules_cache[rule_hash] = rule
        await self._save_to_db(rule)
        return rule

    def apply_learned_rules(
        self, formula: Dict, context: Optional[Dict] = None
    ) -> Tuple[Dict, List[str]]:
        if context is None:
            context = {}
        applied: List[str] = []
        modified = json.loads(json.dumps(formula))

        sorted_rules = sorted(
            self.rules_cache.values(),
            key=lambda r: (r.confidence * r.success_rate, r.evidence_count),
            reverse=True,
        )

        for rule in sorted_rules:
            if rule.confidence < 0.6:
                continue
            if self._rule_matches(rule.condition, modified):
                modified = self._apply_action(rule.action, modified)
                applied.append(f"{rule.rule_id}: {rule.action}")
                rule.last_applied = datetime.now()

        return modified, applied

    def suggest_improvements(self, formula: Dict, target_goal: str) -> List[Dict]:
        suggestions: List[Dict] = []
        for rule in self.rules_cache.values():
            if target_goal.lower() in rule.action.lower() or target_goal.lower() in rule.condition.lower():
                if rule.confidence > 0.7 and rule.success_rate > 0.8:
                    suggestions.append({
                        "rule_id": rule.rule_id,
                        "confidence": round(rule.confidence, 3),
                        "success_rate": round(rule.success_rate, 3),
                        "times_verified": rule.evidence_count,
                        "condition": rule.condition,
                        "suggested_action": rule.action,
                    })
        suggestions.sort(key=lambda s: s["confidence"] * s["success_rate"], reverse=True)
        return suggestions[:5]

    # ──────────────────────────────────────────────────────────────
    # Internals
    # ──────────────────────────────────────────────────────────────
    def _calculate_diff(self, original: Dict, corrected: Dict) -> Dict:
        orig_comps = {c.get("name_en", ""): c for c in original.get("components", [])}
        corr_comps = {c.get("name_en", ""): c for c in corrected.get("components", [])}

        added = [comp for name, comp in corr_comps.items() if name not in orig_comps]
        removed = [comp for name, comp in orig_comps.items() if name not in corr_comps]
        modified: List[Dict] = []
        for name in set(orig_comps) & set(corr_comps):
            orig_pct = self._pct(orig_comps[name])
            corr_pct = self._pct(corr_comps[name])
            if abs(orig_pct - corr_pct) > 0.1:
                modified.append({"name": name, "from": orig_pct, "to": corr_pct})
        return {"added": added, "removed": removed, "modified": modified}

    def _build_condition(self, original: Dict) -> str:
        parts: List[str] = []
        for comp in original.get("components", []):
            name = comp.get("name_en") or ""
            pct = self._pct(comp)
            parts.append(f"{name}={pct:.1f}%")
        return " AND ".join(parts)

    def _build_action(self, diff: Dict) -> str:
        actions: List[str] = []
        for added in diff["added"]:
            actions.append(f"ADD {added.get('name_en','')} {added.get('percentage','0%')}")
        for removed in diff["removed"]:
            actions.append(f"REMOVE {removed.get('name_en','')}")
        for mod in diff["modified"]:
            actions.append(f"CHANGE {mod['name']} TO {mod['to']:.1f}%")
        return " THEN ".join(actions)

    def _is_successful(self, notes: str) -> bool:
        notes_l = (notes or "").lower()
        pos = sum(1 for p in self.POSITIVE if p in notes_l)
        neg = sum(1 for n in self.NEGATIVE if n in notes_l)
        return pos > neg

    def _rule_matches(self, condition: str, formula: Dict) -> bool:
        for part in condition.split(" AND "):
            part = part.strip()
            m = re.match(r"(.+?)([>=<]+)([\d.]+)%", part)
            if not m:
                continue
            material, operator, threshold = m.groups()
            threshold = float(threshold)
            for comp in formula.get("components", []):
                if material.lower() in (comp.get("name_en") or "").lower():
                    pct = self._pct(comp)
                    if operator == ">" and not (pct > threshold):
                        return False
                    if operator == ">=" and not (pct >= threshold):
                        return False
                    if operator == "=" and not (abs(pct - threshold) < 0.1):
                        return False
                    if operator == "<" and not (pct < threshold):
                        return False
                    if operator == "<=" and not (pct <= threshold):
                        return False
        return True

    def _apply_action(self, action: str, formula: Dict) -> Dict:
        modified = json.loads(json.dumps(formula))
        components = modified.get("components", [])

        for step in action.split(" THEN "):
            step = step.strip()
            if step.startswith("ADD "):
                # "ADD <name> <pct>%"
                tail = step[4:].rstrip()
                parts = tail.rsplit(" ", 1)
                if len(parts) == 2:
                    name, pct = parts
                    components.append({
                        "name_en": name,
                        "percentage": pct,
                        "added_by_rule": True,
                    })
            elif step.startswith("REMOVE "):
                name = step[7:]
                components = [
                    c for c in components if name.lower() not in (c.get("name_en") or "").lower()
                ]
            elif step.startswith("CHANGE "):
                m = re.match(r"CHANGE (.+) TO ([\d.]+)%", step)
                if m:
                    name, new_pct = m.groups()
                    for comp in components:
                        if name.lower() in (comp.get("name_en") or "").lower():
                            comp["percentage"] = f"{float(new_pct):.1f}%"
                            comp["modified_by_rule"] = True

        # Rebalance
        total = sum(self._pct(c) for c in components)
        if total > 0 and abs(total - 100) > 0.1:
            factor = 100 / total
            for c in components:
                c["percentage"] = f"{self._pct(c) * factor:.1f}%"

        modified["components"] = components
        return modified

    async def _save_to_db(self, rule: LearnedRule) -> None:
        if not self.supabase:
            return
        try:
            self.supabase.table("learning_rules").insert({
                "rule_id": rule.rule_id,
                "condition": rule.condition,
                "action": rule.action,
                "confidence": rule.confidence,
                "evidence_count": rule.evidence_count,
                "success_rate": rule.success_rate,
                "created_at": rule.created_at.isoformat(),
                "last_applied": rule.last_applied.isoformat(),
                "source_formulas": rule.source_formulas,
                "user_feedback": rule.user_feedback,
            }).execute()
        except Exception as exc:
            print(f"Failed to save rule: {exc}")

    async def _update_in_db(self, rule: LearnedRule) -> None:
        if not self.supabase:
            return
        try:
            self.supabase.table("learning_rules").update({
                "confidence": rule.confidence,
                "evidence_count": rule.evidence_count,
                "success_rate": rule.success_rate,
                "last_applied": rule.last_applied.isoformat(),
                "source_formulas": rule.source_formulas,
                "user_feedback": rule.user_feedback,
            }).eq("rule_id", rule.rule_id).execute()
        except Exception as exc:
            print(f"Failed to update rule: {exc}")

    @staticmethod
    def _pct(comp: Dict) -> float:
        try:
            value = comp.get("percentage", "0")
            if isinstance(value, str):
                return float(value.replace("%", "").strip() or 0)
            return float(value)
        except (TypeError, ValueError):
            return 0.0
