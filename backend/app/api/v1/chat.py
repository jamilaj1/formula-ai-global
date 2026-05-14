"""Forever-memory chat endpoints."""
from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional, List


router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    user_id: str
    session_id: Optional[str] = None
    message: str
    language: Optional[str] = None


@router.post("/send")
async def chat_send(req: ChatRequest, request: Request):
    brain = request.app.state.brain
    supabase = request.app.state.supabase
    lang = req.language or brain.language_detector.detect(req.message) or "en"
    answer = await brain.search(req.message, language=lang)

    try:
        supabase.table("chat_history").insert(
            {
                "user_id": req.user_id,
                "session_id": req.session_id,
                "message": req.message,
                "response": answer,
                "language": lang,
            }
        ).execute()
    except Exception:
        pass

    return {"response": answer, "language": lang, "session_id": req.session_id}


@router.get("/history/{user_id}")
async def chat_history(user_id: str, request: Request, limit: int = 100):
    supabase = request.app.state.supabase
    res = (
        supabase.table("chat_history")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"items": res.data or []}
