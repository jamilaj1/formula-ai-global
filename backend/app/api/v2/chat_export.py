"""
Chat → PDF render endpoint — Phase 9.4 of BUILD_ROADMAP.md.

The Worker renders one chat session as Markdown locally (zero backend
hop for the common .md export). For the .pdf export it forwards the
already-rendered Markdown here, and we re-use the markdown parser /
reportlab pipeline written for the Phase 2 consulting deliver.

Auth model is identical to /api/v2/consulting/* — owner-only shared
secret in the `x-formula-internal` header. The Worker is the public
gate; this endpoint just renders.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

# Re-use the markdown → PDF parser from consulting.py. It's pure on the
# input string, so it doesn't matter whether the markdown describes a
# consulting report or a chat transcript — same block patterns, same
# styles, same output PDF shape.
from app.api.v2.consulting import _render_pdf_from_markdown

router = APIRouter(prefix="/chat", tags=["chat-export"])

log = logging.getLogger("chat_export")


class ChatPdfRequest(BaseModel):
    markdown: str
    title: str | None = None


def _safe_attachment_name(title: str | None) -> str:
    """`Content-Disposition: attachment; filename="…"` needs ASCII-safe."""
    base = re.sub(r"[^a-zA-Z0-9._-]+", "-", (title or "chat")).strip("-")
    return (base or "chat")[:60] + ".pdf"


@router.post("/render-pdf")
async def render_chat_pdf(request: Request, body: ChatPdfRequest):
    if request.headers.get("x-formula-internal") != os.getenv(
        "BACKEND_INTERNAL_SECRET", "missing-secret"
    ):
        raise HTTPException(status_code=403, detail="forbidden")

    md = (body.markdown or "").strip()
    if not md or len(md) < 10:
        raise HTTPException(status_code=422, detail="markdown is empty or too short")
    # 1 MB hard cap. A chat session that hits this is almost certainly a
    # paste-bomb or a tool_results dump that doesn't belong in the PDF.
    if len(md) > 1_000_000:
        raise HTTPException(status_code=413, detail="markdown too large (>1 MB)")

    try:
        pdf_bytes = _render_pdf_from_markdown(md, title_fallback=body.title or "Chat")
    except Exception as exc:  # noqa: BLE001
        log.exception("chat pdf render failed")
        raise HTTPException(status_code=500, detail=f"pdf render failed: {exc}") from exc

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{_safe_attachment_name(body.title)}"',
            "Cache-Control": "private, no-store",
        },
    )
