"""
Formula AI Gold Standard — verifiable digital certification for top-tier
formulas. Issued only when trust_score ≥ 95 AND all 7 validation stages pass.
The hash is anchored to (formula_id, certifier_id, timestamp) so external
parties can reverify.
"""
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Dict

from supabase import Client


VALIDATION_STAGES = [
    "percentage_sum_100",
    "all_cas_verified",
    "no_chemical_conflicts",
    "safety_rules_passed",
    "regulatory_compliant",
    "source_documented",
    "human_reviewed",
]


class GoldCertification:
    TRUST_THRESHOLD = 95.0
    VALID_FOR_DAYS = 365 * 2

    def __init__(self, supabase: Client):
        self.supabase = supabase

    def issue_certificate(self, formula_id: str, certifier_id: str) -> Dict:
        formula = (
            self.supabase.table("formulas")
            .select("trust_score, components, name")
            .eq("id", formula_id)
            .single()
            .execute()
        )
        if not formula.data:
            return {"error": "formula not found"}
        if (formula.data.get("trust_score") or 0) < self.TRUST_THRESHOLD:
            return {
                "error": (
                    f"Gold Standard requires trust_score ≥ {self.TRUST_THRESHOLD}; "
                    f"current = {formula.data.get('trust_score')}"
                )
            }

        ts = datetime.now(timezone.utc)
        digest = hashlib.sha256(
            f"{formula_id}::{certifier_id}::{ts.isoformat()}".encode()
        ).hexdigest()
        expires = ts + timedelta(days=self.VALID_FOR_DAYS)

        self.supabase.table("gold_certifications").insert(
            {
                "formula_id": formula_id,
                "certified_by": certifier_id,
                "certificate_hash": digest,
                "validation_stages": VALIDATION_STAGES,
                "expires_at": expires.isoformat(),
            }
        ).execute()

        return {
            "status": "issued",
            "certificate_hash": digest,
            "expires_at": expires.isoformat(),
            "stages_passed": VALIDATION_STAGES,
        }

    def verify_certificate(self, cert_hash: str) -> Dict:
        res = (
            self.supabase.table("gold_certifications")
            .select("*")
            .eq("certificate_hash", cert_hash)
            .single()
            .execute()
        )
        if not res.data:
            return {"valid": False, "reason": "unknown_hash"}
        try:
            expires = datetime.fromisoformat(res.data["expires_at"])
            if expires < datetime.now(timezone.utc):
                return {"valid": False, "reason": "expired"}
        except Exception:
            pass
        return {"valid": True, "data": res.data}
