"""
Consulting AI-draft pipeline — Phase 2.3 of BUILD_ROADMAP.md.

Workflow
--------
The Cloudflare Worker (`/be/consulting/draft`, admin-only) calls this
service with the `consultation_requests.id` of a paid intake. We:

  1. Fetch the brief from Supabase.
  2. Run `Orchestrator.formulate()` (Quick / Full / Custom map to
     different parallel-agent intensity).
  3. Render the orchestrator's structured output as Markdown.
  4. Upload the Markdown to Supabase Storage (bucket: `consulting-drafts`).
  5. Update `consultation_requests` to status='review' with the storage URL.

Owner-approval (Phase 2.4) reads the markdown back, optionally edits it
in admin.html, then calls `/v2/consulting/finalize/{id}` (separate
endpoint, in this file) which converts the approved Markdown → PDF via
reportlab and emails it to the client.
"""
from __future__ import annotations

import io
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import anthropic
from fastapi import APIRouter, HTTPException, Path, Request
from pydantic import BaseModel

from agents import Orchestrator

router = APIRouter(prefix="/consulting", tags=["consulting"])

log = logging.getLogger("consulting")

# Storage bucket where AI drafts (markdown) and finalized PDFs live.
# Bucket must be created in Supabase Storage (private, owner-read).
DRAFTS_BUCKET = "consulting-drafts"

# ── Models ────────────────────────────────────────────────────────────


class DraftRequest(BaseModel):
    """Body for POST /consulting/draft/{request_id}.

    The Worker forwards `force=true` when the owner re-runs the
    orchestrator from the admin tab (after the first draft was
    unsatisfactory and they want a second take).
    """

    force: bool = False


class DraftResponse(BaseModel):
    ok: bool
    request_id: str
    status: str
    ai_draft_md_url: str | None = None
    note: str | None = None


# ── Orchestrator factory ──────────────────────────────────────────────


def _claude_client() -> anthropic.Anthropic | None:
    key = os.getenv("ANTHROPIC_API_KEY")
    return anthropic.Anthropic(api_key=key) if key else None


def _model_for_package(pkg: str) -> str:
    """
    Quick → Haiku (cheap, fast, fine for a single existing-formula review).
    Full + Custom → Sonnet (better reasoning is worth the 4× cost when
    the deliverable is a $2,500+ report).
    """
    if pkg in ("full", "custom"):
        return os.getenv("ANTHROPIC_MODEL_PRO", "claude-sonnet-4-5")
    return os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")


# ── Markdown renderer ─────────────────────────────────────────────────


def _render_markdown(req: dict[str, Any], result: dict[str, Any]) -> str:
    """Render the orchestrator output as a polished Markdown report.

    Layout matches the "Typical report structure" promised on
    consulting.html (Phase 2.1), so the deliverable always lines up
    with what the customer bought.
    """
    pkg_label = {
        "quick": "Quick Diagnostic",
        "full": "Full Formulation Report",
        "custom": "Custom Project",
    }.get(req.get("package", ""), "Formulation Report")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    summary = (result.get("summary") or "").strip() or "(no summary returned)"
    verdict = (result.get("overall_verdict") or "").strip().upper() or "DRAFT"

    parts: list[str] = []

    parts.append(f"# {pkg_label}")
    parts.append("")
    parts.append(
        f"**Client:** {req.get('email')}"
        f"{(' (' + req['company'] + ')') if req.get('company') else ''}  "
    )
    parts.append(f"**Product type:** {req.get('product_type')}  ")
    parts.append(f"**Target market:** {req.get('market')}  ")
    parts.append(f"**Report date:** {today}  ")
    parts.append(f"**Request ID:** `{req.get('id')}`")
    parts.append("")
    parts.append("---")
    parts.append("")
    parts.append("## 1. Executive summary")
    parts.append("")
    parts.append(f"**Overall verdict:** {verdict}")
    parts.append("")
    parts.append(summary)
    parts.append("")
    parts.append("## 2. Client brief")
    parts.append("")
    parts.append("> " + (req.get("brief") or "").replace("\n", "\n> "))
    parts.append("")

    agent_results = result.get("agent_results") or {}

    # Ingredient list comes from the first proposal when formulate() was
    # used, or from the brief itself otherwise.
    proposals = result.get("proposals") or []
    if proposals:
        primary = proposals[0]
        parts.append("## 3. Recommended formulation")
        parts.append("")
        parts.append(_render_proposal(primary))
        parts.append("")

    section_n = 4 if proposals else 3
    for agent_name in ("safety", "cost", "stability", "regulatory"):
        agent_r = agent_results.get(agent_name)
        if not agent_r:
            continue
        title = agent_name.capitalize()
        parts.append(f"## {section_n}. {title} analysis")
        parts.append("")
        parts.append(_render_agent_block(agent_r))
        parts.append("")
        section_n += 1

    # Other proposals (ranked alternatives).
    if len(proposals) > 1:
        parts.append(f"## {section_n}. Alternative formulations considered")
        parts.append("")
        for i, p in enumerate(proposals[1:], start=2):
            parts.append(f"### Option {i}")
            parts.append("")
            parts.append(_render_proposal(p))
            parts.append("")
        section_n += 1

    # Recommendations.
    recs = result.get("recommendations") or []
    if recs:
        parts.append(f"## {section_n}. Recommendations")
        parts.append("")
        for r in recs:
            parts.append(f"- {r}")
        parts.append("")
        section_n += 1

    parts.append("---")
    parts.append("")
    parts.append("## Notes & disclaimers")
    parts.append("")
    parts.append(
        "- This report is a first draft generated by Formula AI Global's "
        "six chemistry agents (Formulator, Safety, Cost, Stability, "
        "Regulatory, Orchestrator). The final signed PDF is reviewed "
        "and approved by Jamil Abduljalil, 25-year industrial chemist."
    )
    parts.append(
        "- Lab trials are required before any commercial production. "
        "This document is design guidance, not a guarantee of process "
        "behavior at scale."
    )
    parts.append(
        "- Regulatory status reflects publicly available information at "
        "the report date. Always confirm current local rules with your "
        "licensed regulatory consultant before market entry."
    )
    parts.append("")
    parts.append("_Formula AI Global • jamilformula.com_")

    return "\n".join(parts)


def _render_proposal(p: dict[str, Any]) -> str:
    """One formulator proposal → Markdown subsection."""
    lines: list[str] = []
    name = p.get("name") or p.get("name_en") or "Proposed formula"
    lines.append(f"**{name}**")
    lines.append("")
    if p.get("description"):
        lines.append(p["description"])
        lines.append("")

    comps = p.get("components") or []
    if comps:
        lines.append("| # | Ingredient | % | CAS | Function |")
        lines.append("|---|---|---|---|---|")
        for i, c in enumerate(comps, 1):
            lines.append(
                f"| {i} | {c.get('name_en') or c.get('name') or '—'} "
                f"| {c.get('percentage', 0):.2f} "
                f"| {c.get('cas_number') or '—'} "
                f"| {c.get('function') or '—'} |"
            )
        lines.append("")

    process = p.get("process_conditions") or {}
    if process:
        lines.append("**Process conditions:**")
        lines.append("")
        for k, v in process.items():
            lines.append(f"- _{k.replace('_', ' ').capitalize()}_: {v}")
        lines.append("")

    return "\n".join(lines)


def _render_agent_block(agent_r: Any) -> str:
    """Render one AgentResult (dict-shaped) as Markdown."""
    # AgentResult may be a dataclass-like dict, or already a dict.
    d = agent_r if isinstance(agent_r, dict) else getattr(agent_r, "__dict__", {})
    verdict = (d.get("verdict") or "").upper() or "—"
    confidence = d.get("confidence")
    evidence = d.get("evidence") or []
    suggestions = d.get("suggestions") or []
    issues = d.get("issues") or []

    lines: list[str] = []
    lines.append(f"**Verdict:** {verdict}"
                 + (f" · confidence {confidence:.0%}" if isinstance(confidence, (int, float)) else ""))
    lines.append("")

    if d.get("summary"):
        lines.append(d["summary"])
        lines.append("")

    if issues:
        lines.append("**Issues identified:**")
        lines.append("")
        for it in issues:
            if isinstance(it, dict):
                level = (it.get("severity") or "").upper()
                msg = it.get("message") or it.get("detail") or ""
                lines.append(f"- **[{level}]** {msg}")
            else:
                lines.append(f"- {it}")
        lines.append("")

    if evidence:
        lines.append("**Evidence:**")
        lines.append("")
        for ev in evidence:
            if isinstance(ev, dict):
                lines.append(f"- {ev.get('claim') or ev.get('message') or ''}")
            else:
                lines.append(f"- {ev}")
        lines.append("")

    if suggestions:
        lines.append("**Suggestions:**")
        lines.append("")
        for s in suggestions:
            if isinstance(s, dict):
                lines.append(f"- {s.get('text') or s.get('message') or ''}")
            else:
                lines.append(f"- {s}")
        lines.append("")

    return "\n".join(lines)


# ── Routes ────────────────────────────────────────────────────────────


@router.post("/draft/{request_id}", response_model=DraftResponse)
async def generate_draft(
    request: Request,
    request_id: str = Path(..., min_length=10, max_length=64),
    body: DraftRequest | None = None,
):
    """
    Run the orchestrator against a paid consultation_requests row and
    save the markdown draft. Idempotent unless `force=true`.

    Authentication: this endpoint expects to be called by the Cloudflare
    Worker (`/be/consulting/draft`), which itself is owner-only. We add
    a header check as defence-in-depth so the FastAPI endpoint can't be
    called directly from the public internet.
    """
    if request.headers.get("x-formula-internal") != os.getenv(
        "BACKEND_INTERNAL_SECRET", "missing-secret"
    ):
        raise HTTPException(status_code=403, detail="forbidden")

    body = body or DraftRequest()
    supabase = request.app.state.supabase

    # 1. Fetch the brief
    row = (
        supabase.table("consultation_requests")
        .select("*")
        .eq("id", request_id)
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="request not found")
    req: dict[str, Any] = row.data

    # Don't overwrite a delivered report by accident.
    if req["status"] in ("delivered",) and not body.force:
        raise HTTPException(status_code=409, detail="already delivered")
    if req.get("ai_draft_md_url") and not body.force:
        return DraftResponse(
            ok=True,
            request_id=request_id,
            status=req["status"],
            ai_draft_md_url=req["ai_draft_md_url"],
            note="draft already exists; use force=true to regenerate",
        )

    # 2. Run orchestrator
    pkg = req.get("package", "quick")
    model = _model_for_package(pkg)
    orch = Orchestrator(claude_client=_claude_client(), model=model)

    formulate_input = {
        "product_type": req["product_type"],
        "target_attributes": [],
        "constraints": {
            "market": req.get("market"),
            "brief": req.get("brief"),
        },
    }
    try:
        result = await orch.formulate(formulate_input)
    except Exception as exc:  # noqa: BLE001 — orchestrator can raise anything
        log.exception("orchestrator failed for %s", request_id)
        # Mark the request as 'drafting_failed' so the admin tab shows it
        # in the right column instead of getting stuck in 'drafting'.
        supabase.table("consultation_requests").update(
            {"status": "review", "owner_notes": f"AI draft failed: {exc}"}
        ).eq("id", request_id).execute()
        raise HTTPException(status_code=502, detail=f"orchestrator failed: {exc}") from exc

    # 3. Render markdown
    md = _render_markdown(req, result)

    # 4. Upload to Supabase Storage
    object_path = f"{request_id}/{uuid.uuid4().hex}.md"
    try:
        supabase.storage.from_(DRAFTS_BUCKET).upload(
            object_path,
            md.encode("utf-8"),
            file_options={"content-type": "text/markdown; charset=utf-8"},
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("storage upload failed for %s", request_id)
        raise HTTPException(status_code=502, detail=f"storage upload failed: {exc}") from exc

    # Signed URL valid for 7 days — the admin tab fetches with this.
    try:
        signed = supabase.storage.from_(DRAFTS_BUCKET).create_signed_url(
            object_path, 60 * 60 * 24 * 7
        )
        signed_url = signed.get("signedURL") or signed.get("signed_url")
    except Exception:
        signed_url = None

    # 5. Update the request row
    supabase.table("consultation_requests").update(
        {
            "ai_draft_md_url": signed_url or f"storage://{DRAFTS_BUCKET}/{object_path}",
            "status": "review",
        }
    ).eq("id", request_id).execute()

    return DraftResponse(
        ok=True,
        request_id=request_id,
        status="review",
        ai_draft_md_url=signed_url,
    )


@router.get("/draft/{request_id}/markdown")
async def fetch_markdown(
    request: Request,
    request_id: str = Path(..., min_length=10, max_length=64),
):
    """Return the raw markdown so admin.html can render it in a textarea.

    Same defence-in-depth header check as the generator endpoint.
    """
    if request.headers.get("x-formula-internal") != os.getenv(
        "BACKEND_INTERNAL_SECRET", "missing-secret"
    ):
        raise HTTPException(status_code=403, detail="forbidden")

    supabase = request.app.state.supabase
    row = (
        supabase.table("consultation_requests")
        .select("ai_draft_md_url, status")
        .eq("id", request_id)
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="not found")
    url = row.data.get("ai_draft_md_url")
    if not url:
        raise HTTPException(status_code=404, detail="no draft yet")

    # If the URL is a storage:// reference, download via the storage API;
    # otherwise it's a signed URL and we fetch it as a regular HTTP GET.
    import httpx  # local import — keeps cold-start lean for endpoints that don't need it

    if url.startswith("storage://"):
        # Strip the scheme + bucket prefix to get the object path.
        path = url.split("/", 3)[3] if url.count("/") >= 3 else ""
        data = supabase.storage.from_(DRAFTS_BUCKET).download(path)
        return {"markdown": data.decode("utf-8"), "source": "storage"}

    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(url)
        r.raise_for_status()
        return {"markdown": r.text, "source": "signed_url"}
