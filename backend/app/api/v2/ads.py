"""Direct ads CRUD + impression / click tracking."""
from fastapi import APIRouter, Request


router = APIRouter(prefix="/ads", tags=["ads"])


@router.get("/active")
async def list_active_ads(request: Request, position: str = "banner"):
    supabase = request.app.state.supabase
    res = (
        supabase.table("direct_ads")
        .select("*")
        .eq("is_active", True)
        .eq("ad_position", position)
        .execute()
    )
    return {"items": res.data or []}


@router.post("/{ad_id}/impression")
async def record_impression(ad_id: str, request: Request):
    supabase = request.app.state.supabase
    try:
        supabase.rpc("increment_ad_impression", {"ad_id_param": ad_id}).execute()
    except Exception:
        # fallback if RPC not deployed
        cur = supabase.table("direct_ads").select("total_impressions").eq("id", ad_id).single().execute()
        n = (cur.data or {}).get("total_impressions") or 0
        supabase.table("direct_ads").update({"total_impressions": n + 1}).eq("id", ad_id).execute()
    return {"recorded": True}


@router.post("/{ad_id}/click")
async def record_click(ad_id: str, request: Request):
    supabase = request.app.state.supabase
    try:
        supabase.rpc("increment_ad_click", {"ad_id_param": ad_id}).execute()
    except Exception:
        cur = supabase.table("direct_ads").select("total_clicks").eq("id", ad_id).single().execute()
        n = (cur.data or {}).get("total_clicks") or 0
        supabase.table("direct_ads").update({"total_clicks": n + 1}).eq("id", ad_id).execute()
    return {"recorded": True}
