"""
Industrial API — generate / rotate / meter API keys for factories integrating
Formula AI with their ERP. Pricing: $0.01/call (configurable per plan).
"""
import secrets
from typing import Dict, Optional

from fastapi import HTTPException
from supabase import Client


PLAN_LIMITS = {
    "starter":     {"calls_limit": 1_000,  "price_per_call": 0.01},
    "growth":      {"calls_limit": 50_000, "price_per_call": 0.008},
    "enterprise":  {"calls_limit": 1_000_000, "price_per_call": 0.005},
}


class IndustrialAPIService:
    def __init__(self, supabase: Client):
        self.supabase = supabase

    def issue_key(self, user_id: str, plan: str = "starter") -> Dict:
        if plan not in PLAN_LIMITS:
            return {"error": f"unknown plan {plan}"}
        api_key = "fai_" + secrets.token_urlsafe(32)
        res = (
            self.supabase.table("api_keys")
            .insert(
                {
                    "user_id": user_id,
                    "api_key": api_key,
                    "plan": plan,
                    "calls_limit": PLAN_LIMITS[plan]["calls_limit"],
                    "calls_used": 0,
                    "is_active": True,
                }
            )
            .execute()
        )
        return {"api_key": api_key, "plan": plan, "limit": PLAN_LIMITS[plan]["calls_limit"]}

    def authenticate(self, raw_key: str) -> Optional[Dict]:
        if not raw_key:
            return None
        res = (
            self.supabase.table("api_keys")
            .select("*")
            .eq("api_key", raw_key)
            .eq("is_active", True)
            .single()
            .execute()
        )
        return res.data

    def consume(self, raw_key: str, n: int = 1) -> Dict:
        rec = self.authenticate(raw_key)
        if not rec:
            raise HTTPException(401, "invalid api key")
        used = (rec.get("calls_used") or 0) + n
        if used > (rec.get("calls_limit") or 0):
            raise HTTPException(429, "monthly quota exhausted")
        self.supabase.table("api_keys").update({"calls_used": used}).eq(
            "id", rec["id"]
        ).execute()
        return {"calls_used": used, "calls_limit": rec.get("calls_limit")}

    def rotate(self, key_id: str) -> Dict:
        new_key = "fai_" + secrets.token_urlsafe(32)
        self.supabase.table("api_keys").update({"api_key": new_key}).eq(
            "id", key_id
        ).execute()
        return {"api_key": new_key}
