"""
University Program — give 500 universities free Enterprise accounts.
A signup is auto-approved iff the email domain matches one in `university_program`.
"""
from datetime import date, timedelta
from typing import Dict, Optional

from supabase import Client


class UniversityService:
    DEFAULT_ACTIVE_YEARS = 1

    def __init__(self, supabase: Client):
        self.supabase = supabase

    def register_university(
        self, name: str, email_domain: str, max_students: int = 500
    ) -> Dict:
        active_until = date.today() + timedelta(
            days=365 * self.DEFAULT_ACTIVE_YEARS
        )
        res = (
            self.supabase.table("university_program")
            .insert(
                {
                    "university_name": name,
                    "domain": email_domain.lower(),
                    "max_students": max_students,
                    "active_until": active_until.isoformat(),
                }
            )
            .execute()
        )
        return res.data[0] if res.data else {"error": "insert failed"}

    def is_university_email(self, email: str) -> Optional[Dict]:
        if "@" not in email:
            return None
        domain = email.split("@", 1)[1].lower()
        res = (
            self.supabase.table("university_program")
            .select("*")
            .eq("domain", domain)
            .single()
            .execute()
        )
        return res.data

    def auto_grant_enterprise(self, user_id: str, email: str) -> Dict:
        uni = self.is_university_email(email)
        if not uni:
            return {"granted": False, "reason": "domain_not_registered"}

        # Find Enterprise plan
        plan = (
            self.supabase.table("subscription_plans")
            .select("id")
            .eq("slug", "enterprise")
            .single()
            .execute()
        )
        plan_id = plan.data["id"] if plan.data else None
        self.supabase.table("users").update(
            {
                "subscription_plan_id": plan_id,
                "subscription_status": "academic_active",
            }
        ).eq("id", user_id).execute()
        return {
            "granted": True,
            "university": uni.get("university_name"),
            "valid_until": uni.get("active_until"),
        }
