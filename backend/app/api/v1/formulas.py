"""GET / POST endpoints for the formulas table."""
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel
from typing import List, Optional


router = APIRouter(prefix="/formulas", tags=["formulas"])


class FormulaCreate(BaseModel):
    name: str
    name_en: Optional[str] = None
    category: Optional[str] = None
    components: List[dict] = []
    description: Optional[str] = None
    source_title: Optional[str] = None
    source_type: Optional[str] = None
    language: str = "en"


@router.get("")
async def list_formulas(
    request: Request,
    category: Optional[str] = Query(None),
    economic_level: Optional[str] = Query(None),
    min_trust: float = Query(0),
    limit: int = Query(50, ge=1, le=200),
):
    supabase = request.app.state.supabase
    q = supabase.table("formulas").select("*").gte("trust_score", min_trust).limit(limit)
    if category:
        q = q.eq("category", category)
    if economic_level:
        q = q.eq("economic_level", economic_level)
    res = q.execute()
    return {"items": res.data or [], "count": len(res.data or [])}


@router.get("/{formula_id}")
async def get_formula(formula_id: str, request: Request):
    supabase = request.app.state.supabase
    res = supabase.table("formulas").select("*").eq("id", formula_id).single().execute()
    if not res.data:
        raise HTTPException(404, "formula not found")
    # bump search_count
    try:
        supabase.table("formulas").update(
            {"search_count": (res.data.get("search_count") or 0) + 1}
        ).eq("id", formula_id).execute()
    except Exception:
        pass
    return res.data


@router.post("")
async def create_formula(payload: FormulaCreate, request: Request):
    supabase = request.app.state.supabase
    res = supabase.table("formulas").insert(payload.model_dump()).execute()
    return res.data[0] if res.data else {"status": "error"}
