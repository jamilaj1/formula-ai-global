"""POST /api/v1/search — chemistry Q&A in 20 languages."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from typing import Optional


router = APIRouter(tags=["search"])


class SearchRequest(BaseModel):
    query: str
    language: Optional[str] = None  # auto-detect if missing
    user_id: Optional[str] = None


class SearchResponse(BaseModel):
    answer: str
    detected_language: str


@router.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest, request: Request):
    brain = request.app.state.brain
    supabase = request.app.state.supabase

    lang = req.language or brain.language_detector.detect(req.query) or "en"
    answer = await brain.search(req.query, language=lang)

    # log to user_search_history
    if req.user_id:
        try:
            supabase.table("user_search_history").insert(
                {
                    "user_id": req.user_id,
                    "query": req.query,
                    "language": lang,
                    "results_count": 1,
                }
            ).execute()
        except Exception:
            pass

    return SearchResponse(answer=answer, detected_language=lang)
