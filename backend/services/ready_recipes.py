"""
Ready Recipes — turnkey "mix this with that" packs for small factories,
including a video walkthrough URL and a list of LOCAL suppliers per country.
"""
from typing import Dict, List

from supabase import Client


class ReadyRecipe:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def create_recipe(
        self,
        formula_id: str,
        video_url: str,
        suppliers: List[Dict],
        difficulty: str = "beginner",
    ) -> Dict:
        res = (
            self.supabase.table("ready_recipes")
            .insert(
                {
                    "formula_id": formula_id,
                    "video_url": video_url,
                    "local_suppliers": suppliers,
                    "difficulty_level": difficulty,
                }
            )
            .execute()
        )
        return res.data[0] if res.data else {"error": "could not create"}

    def get_recipes_for_region(self, country_code: str) -> List[Dict]:
        try:
            res = self.supabase.rpc(
                "get_recipes_by_country", {"country": country_code.upper()}
            ).execute()
            return res.data or []
        except Exception:
            pass
        # fallback: load all and filter in-memory
        all_r = self.supabase.table("ready_recipes").select("*").execute()
        out = []
        for r in (all_r.data or []):
            for s in (r.get("local_suppliers") or []):
                if (s.get("country") or "").upper() == country_code.upper():
                    out.append(r)
                    break
        return out
