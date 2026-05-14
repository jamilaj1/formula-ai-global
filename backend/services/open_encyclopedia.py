"""
Open Formulas Encyclopedia — 50,000+ free, CC-BY-SA-licensed formulas.
Only formulas with trust_score ≥ 90 may be promoted to public.
"""
from typing import Dict, List

from supabase import Client


class OpenEncyclopedia:
    PUBLISH_THRESHOLD = 90.0

    def __init__(self, supabase: Client):
        self.supabase = supabase

    def make_public(self, formula_id: str) -> Dict:
        formula = (
            self.supabase.table("formulas")
            .select("trust_score, name")
            .eq("id", formula_id)
            .single()
            .execute()
        )
        if not formula.data:
            return {"error": "formula not found"}
        if (formula.data.get("trust_score") or 0) < self.PUBLISH_THRESHOLD:
            return {
                "error": (
                    f"trust_score {formula.data.get('trust_score')} below "
                    f"threshold {self.PUBLISH_THRESHOLD}"
                )
            }
        self.supabase.table("open_encyclopedia").upsert(
            {"formula_id": formula_id, "is_public": True}
        ).execute()
        return {"status": "added", "formula_id": formula_id}

    def get_public_formulas(self, limit: int = 50, offset: int = 0) -> List[Dict]:
        # Join via the FK; if RPC `get_public_formulas` is deployed, prefer it
        try:
            res = self.supabase.rpc(
                "get_public_formulas", {"limit_count": limit, "offset_count": offset}
            ).execute()
            return res.data or []
        except Exception:
            pass
        oe = (
            self.supabase.table("open_encyclopedia")
            .select("formula_id")
            .eq("is_public", True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        ids = [r["formula_id"] for r in (oe.data or [])]
        if not ids:
            return []
        formulas = (
            self.supabase.table("formulas").select("*").in_("id", ids).execute()
        )
        return formulas.data or []

    def increment_download(self, formula_id: str) -> None:
        try:
            cur = (
                self.supabase.table("open_encyclopedia")
                .select("download_count")
                .eq("formula_id", formula_id)
                .single()
                .execute()
            )
            n = (cur.data or {}).get("download_count") or 0
            self.supabase.table("open_encyclopedia").update(
                {"download_count": n + 1}
            ).eq("formula_id", formula_id).execute()
        except Exception:
            pass
