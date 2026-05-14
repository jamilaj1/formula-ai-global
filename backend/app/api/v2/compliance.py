"""Regulatory compliance check — formula vs target country rules."""
from fastapi import APIRouter, Request
from typing import Optional


router = APIRouter(prefix="/compliance", tags=["compliance"])


@router.get("/check/{formula_id}")
async def check_compliance(
    formula_id: str,
    request: Request,
    country: str = "US",
    product_category: Optional[str] = None,
):
    supabase = request.app.state.supabase
    formula = supabase.table("formulas").select("*").eq("id", formula_id).single().execute()
    if not formula.data:
        return {"error": "formula not found"}

    # Pull the country's banned list
    limits = (
        supabase.table("chemical_limits")
        .select("*")
        .eq("country_iso", country.upper())
        .execute()
    )
    limits_by_cas = {l["cas_number"]: l for l in (limits.data or []) if l.get("cas_number")}

    violations = []
    warnings = []
    compliant = []
    for comp in formula.data.get("components", []):
        cas = comp.get("cas_number")
        rule = limits_by_cas.get(cas)
        if not rule:
            compliant.append(comp.get("name_en"))
            continue
        try:
            pct = float(str(comp.get("percentage", "0%")).replace("%", ""))
        except ValueError:
            pct = 0
        limit_value = float(rule.get("limit_value") or 0)
        if pct > limit_value and limit_value > 0:
            violations.append(
                {
                    "component": comp.get("name_en"),
                    "limit": limit_value,
                    "actual": pct,
                    "rule": rule.get("reference_standard"),
                }
            )
        else:
            warnings.append(comp.get("name_en"))

    overall = "compliant" if not violations else "non_compliant"
    return {
        "formula_id": formula_id,
        "country": country,
        "status": overall,
        "violations": violations,
        "warnings": warnings,
        "compliant_count": len(compliant),
    }
