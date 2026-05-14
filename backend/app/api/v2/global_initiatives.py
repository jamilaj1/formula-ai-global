"""
v2/global_initiatives — public-facing endpoints for the world-class push:
  • Open Encyclopedia
  • Gold Standard certification (issue + verify)
  • Ready Recipes (small-factory packs)
  • University auto-grant
  • Industrial API key management
"""
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel
from typing import List, Optional

from services.open_encyclopedia import OpenEncyclopedia
from services.certification import GoldCertification
from services.ready_recipes import ReadyRecipe
from services.university_service import UniversityService
from services.industrial_api import IndustrialAPIService


router = APIRouter(tags=["global-initiatives"])


# ----- Open Encyclopedia ------------------------------------
@router.post("/encyclopedia/publish/{formula_id}")
async def publish_to_encyclopedia(formula_id: str, request: Request):
    return OpenEncyclopedia(request.app.state.supabase).make_public(formula_id)


@router.get("/encyclopedia")
async def list_public_formulas(request: Request, limit: int = 50, offset: int = 0):
    items = OpenEncyclopedia(request.app.state.supabase).get_public_formulas(limit, offset)
    return {"items": items, "count": len(items)}


# ----- Gold Standard certification --------------------------
class IssueCertificate(BaseModel):
    formula_id: str
    certifier_id: str


@router.post("/certify/issue")
async def certify_issue(payload: IssueCertificate, request: Request):
    return GoldCertification(request.app.state.supabase).issue_certificate(
        payload.formula_id, payload.certifier_id
    )


@router.get("/certify/verify/{cert_hash}")
async def certify_verify(cert_hash: str, request: Request):
    return GoldCertification(request.app.state.supabase).verify_certificate(cert_hash)


# ----- Ready Recipes ---------------------------------------
class ReadyRecipeIn(BaseModel):
    formula_id: str
    video_url: str
    suppliers: List[dict] = []
    difficulty: str = "beginner"


@router.post("/recipes")
async def create_recipe(payload: ReadyRecipeIn, request: Request):
    return ReadyRecipe(request.app.state.supabase).create_recipe(
        payload.formula_id, payload.video_url, payload.suppliers, payload.difficulty
    )


@router.get("/recipes/region/{country_code}")
async def recipes_for_region(country_code: str, request: Request):
    items = ReadyRecipe(request.app.state.supabase).get_recipes_for_region(country_code)
    return {"items": items, "count": len(items)}


# ----- University Program ----------------------------------
class UniversityIn(BaseModel):
    university_name: str
    domain: str
    max_students: int = 500


@router.post("/university/register")
async def register_university(payload: UniversityIn, request: Request):
    return UniversityService(request.app.state.supabase).register_university(
        payload.university_name, payload.domain, payload.max_students
    )


@router.post("/university/grant/{user_id}")
async def grant_university(user_id: str, email: str, request: Request):
    return UniversityService(request.app.state.supabase).auto_grant_enterprise(user_id, email)


# ----- Industrial API keys --------------------------------
class APIKeyIssue(BaseModel):
    user_id: str
    plan: str = "starter"


@router.post("/api-keys/issue")
async def issue_api_key(payload: APIKeyIssue, request: Request):
    return IndustrialAPIService(request.app.state.supabase).issue_key(
        payload.user_id, payload.plan
    )


@router.get("/api-keys/whoami")
async def whoami(request: Request, x_api_key: Optional[str] = Header(None)):
    rec = IndustrialAPIService(request.app.state.supabase).authenticate(x_api_key or "")
    if not rec:
        raise HTTPException(401, "invalid api key")
    return {
        "plan": rec.get("plan"),
        "calls_used": rec.get("calls_used"),
        "calls_limit": rec.get("calls_limit"),
    }
