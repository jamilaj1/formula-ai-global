"""
Consulting AI-draft + delivery pipeline — Phase 2 of BUILD_ROADMAP.md.

Workflow
--------
The Cloudflare Worker (`/be/consulting/*`, admin-only) calls this
service with the `consultation_requests.id` of a paid intake.

Draft (Phase 2.3):
  1. Fetch the brief from Supabase.
  2. Run `Orchestrator.formulate()` (Quick / Full / Custom map to
     different parallel-agent intensity).
  3. Render the orchestrator's structured output as Markdown.
  4. Upload the Markdown to Supabase Storage (bucket: `consulting-drafts`).
  5. Update `consultation_requests` to status='review' with the storage URL.

Deliver (Phase 2 close-loop, this commit):
  6. Owner reviews + optionally edits the markdown in admin.html.
  7. Owner clicks "Approve & deliver" → POST /api/v2/consulting/{id}/deliver
     with the (possibly edited) markdown.
  8. Render markdown → PDF via reportlab, upload PDF to the same bucket.
  9. Email client via Resend with the PDF as an attachment.
  10. Update consultation_requests: status='delivered', final_pdf_url=<signed>.

Resend:
  POST /api/v2/consulting/{id}/resend re-attaches the SAME final PDF and
  re-emails the client — no new render, no row mutation.
"""
from __future__ import annotations

import base64
import io
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import anthropic
import httpx
from fastapi import APIRouter, HTTPException, Path, Request
from pydantic import BaseModel

from agents import Orchestrator

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
    KeepTogether,
)

router = APIRouter(prefix="/consulting", tags=["consulting"])

log = logging.getLogger("consulting")

# Storage bucket where AI drafts (markdown) and finalized PDFs live.
# Bucket must be created in Supabase Storage (private, owner-read).
DRAFTS_BUCKET = "consulting-drafts"

# Delivery (email + final PDF) configuration. Read from Render env vars so
# the same Resend account that powers signup emails (via pg_net) also
# handles consulting delivery from the FastAPI side. Defaults match the
# pg_net config so a single Resend domain verification covers both.
RESEND_API_BASE = "https://api.resend.com/emails"
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "signups@jamilformula.com")
RESEND_FROM_NAME = os.getenv("RESEND_FROM_NAME", "Formula AI Consulting")
OWNER_EMAIL = os.getenv("OWNER_EMAIL", "jamilaj1@gmail.com")

# Final PDFs live in the same bucket as drafts but under a `final/` prefix,
# so the admin can spot the difference at a glance and lifecycle rules can
# treat them differently if we add any later.
FINAL_PDF_SIGNED_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days

PKG_LABELS: dict[str, str] = {
    "quick": "Quick Diagnostic",
    "full": "Full Formulation Report",
    "custom": "Custom Project",
}

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


# ════════════════════════════════════════════════════════════════════════
# DELIVER — markdown → PDF → email-with-attachment → row update
# ════════════════════════════════════════════════════════════════════════


class DeliverRequest(BaseModel):
    """Body for POST /consulting/{id}/deliver.

    `markdown_override` lets the owner pass the edited markdown straight
    from the admin textarea, so we never round-trip via storage during
    the same session (avoids the "I saved but the PDF used the old text"
    class of bug).
    """

    markdown_override: str | None = None
    # When True the endpoint will re-render + re-email even if the row is
    # already 'delivered'. Used when the owner spots a fix after sending.
    force: bool = False


class DeliverResponse(BaseModel):
    ok: bool
    request_id: str
    status: str
    final_pdf_url: str | None = None
    email_id: str | None = None
    note: str | None = None


# ── Markdown → reportlab block conversion ──────────────────────────────

# The markdown produced by `_render_markdown` (above) is well-defined, so a
# small block-by-block parser is enough — we don't pull in a full markdown
# library just to render a known shape. Supported blocks:
#   # / ## / ###        headings
#   ---                  horizontal rule (between sections)
#   > quoted line        blockquote (used for the client brief)
#   - item               bullet list
#   | a | b | c |        markdown table (with a separator row of dashes)
#   <blank line>         paragraph break
#   *anything else*      paragraph (inline **bold**, _italic_, `code`)

_MD_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_MD_ITAL_RE = re.compile(r"(?<![\w*])_(.+?)_(?![\w*])")
_MD_CODE_RE = re.compile(r"`([^`]+?)`")


def _md_inline_to_html(text: str) -> str:
    """Convert the inline markdown subset to the HTML-ish tags reportlab
    Paragraph understands.

    Order matters: escape first so user-supplied `<` doesn't open a tag,
    then re-introduce the formatting tags we actually want.
    """
    s = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    s = _MD_BOLD_RE.sub(r"<b>\1</b>", s)
    s = _MD_ITAL_RE.sub(r"<i>\1</i>", s)
    s = _MD_CODE_RE.sub(r"<font face='Courier'>\1</font>", s)
    return s


def _split_table_row(line: str) -> list[str]:
    """Split a markdown table row on `|`, trimming the empty leading /
    trailing cells produced by edge pipes."""
    parts = [c.strip() for c in line.strip().strip("|").split("|")]
    return parts


def _is_table_separator(line: str) -> bool:
    """`| --- | :---: | ---: |` style separator row."""
    if "|" not in line:
        return False
    cells = _split_table_row(line)
    return bool(cells) and all(
        re.fullmatch(r":?-{3,}:?", c or "") for c in cells if c
    )


def _md_styles() -> dict[str, ParagraphStyle]:
    """Reportlab styles tuned for a consulting-grade deliverable.

    Same visual language as `library_pdf.py` (the formula spec sheet) so
    when a customer buys both they look like one product family.
    """
    base = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle(
            "MdH1", parent=base["Heading1"], fontSize=20, leading=24,
            spaceBefore=2, spaceAfter=6,
            textColor=colors.HexColor("#0f172a"),
        ),
        "h2": ParagraphStyle(
            "MdH2", parent=base["Heading2"], fontSize=14, leading=18,
            spaceBefore=14, spaceAfter=6,
            textColor=colors.HexColor("#0f172a"),
        ),
        "h3": ParagraphStyle(
            "MdH3", parent=base["Heading3"], fontSize=11.5, leading=15,
            spaceBefore=10, spaceAfter=4,
            textColor=colors.HexColor("#1f2937"),
        ),
        "body": ParagraphStyle(
            "MdBody", parent=base["Normal"], fontSize=10, leading=14.5,
            textColor=colors.HexColor("#1f2937"),
            spaceAfter=4,
        ),
        "quote": ParagraphStyle(
            "MdQuote", parent=base["Normal"], fontSize=10, leading=14.5,
            textColor=colors.HexColor("#374151"),
            leftIndent=12, borderColor=colors.HexColor("#d1d5db"),
            borderWidth=0, backColor=colors.HexColor("#f9fafb"),
            spaceBefore=2, spaceAfter=2,
        ),
        "bullet": ParagraphStyle(
            "MdBullet", parent=base["Normal"], fontSize=10, leading=14.5,
            textColor=colors.HexColor("#1f2937"),
            leftIndent=14, bulletIndent=2,
            spaceAfter=2,
        ),
        "note": ParagraphStyle(
            "MdNote", parent=base["Normal"], fontSize=8.5, leading=12,
            textColor=colors.HexColor("#9ca3af"),
        ),
        "table_cell": ParagraphStyle(
            "MdCell", parent=base["Normal"], fontSize=9, leading=11.5,
            textColor=colors.HexColor("#1f2937"),
        ),
        "table_head": ParagraphStyle(
            "MdHead", parent=base["Normal"], fontSize=8.5, leading=11,
            textColor=colors.white,
        ),
    }


def _render_pdf_from_markdown(md: str, title_fallback: str = "Consulting report") -> bytes:
    """Convert the markdown deliverable to a polished A4 PDF.

    The parser is intentionally small — we control the markdown shape via
    `_render_markdown` above, so we only handle the subset we emit. Any
    line that doesn't match a recognised pattern falls through as a
    paragraph, which means owner edits in the admin textarea degrade
    gracefully even if they introduce a stray format.
    """
    styles = _md_styles()
    buf = io.BytesIO()
    # Take the title from the first `# ` line for the PDF metadata, falling
    # back to the package label if the markdown was edited heavily.
    title = title_fallback
    for ln in md.splitlines():
        if ln.startswith("# "):
            title = ln[2:].strip() or title_fallback
            break

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=title[:80],
        author="Formula AI Global",
    )

    story: list[Any] = []
    lines = md.splitlines()
    i = 0
    n = len(lines)

    def flush_paragraph(buf_lines: list[str]) -> None:
        if not buf_lines:
            return
        text = " ".join(s.strip() for s in buf_lines if s.strip())
        if text:
            story.append(Paragraph(_md_inline_to_html(text), styles["body"]))

    para_buf: list[str] = []

    while i < n:
        line = lines[i].rstrip()

        # Blank line → end any open paragraph.
        if not line.strip():
            flush_paragraph(para_buf)
            para_buf = []
            i += 1
            continue

        # Horizontal rule.
        if re.fullmatch(r"-{3,}|\*{3,}|_{3,}", line.strip()):
            flush_paragraph(para_buf)
            para_buf = []
            story.append(Spacer(1, 6))
            story.append(HRFlowable(
                width="100%", thickness=0.5,
                color=colors.HexColor("#e5e7eb"),
                spaceBefore=2, spaceAfter=8,
            ))
            i += 1
            continue

        # Headings.
        if line.startswith("# "):
            flush_paragraph(para_buf)
            para_buf = []
            story.append(Paragraph(_md_inline_to_html(line[2:].strip()), styles["h1"]))
            i += 1
            continue
        if line.startswith("## "):
            flush_paragraph(para_buf)
            para_buf = []
            story.append(Paragraph(_md_inline_to_html(line[3:].strip()), styles["h2"]))
            i += 1
            continue
        if line.startswith("### "):
            flush_paragraph(para_buf)
            para_buf = []
            story.append(Paragraph(_md_inline_to_html(line[4:].strip()), styles["h3"]))
            i += 1
            continue

        # Blockquote (consecutive lines starting with `> `).
        if line.lstrip().startswith(">"):
            flush_paragraph(para_buf)
            para_buf = []
            quoted: list[str] = []
            while i < n and lines[i].lstrip().startswith(">"):
                quoted.append(lines[i].lstrip().lstrip(">").strip())
                i += 1
            text = "<br/>".join(_md_inline_to_html(q) for q in quoted if q)
            if text:
                story.append(Paragraph(text, styles["quote"]))
            continue

        # Bullet list (consecutive `- ` lines).
        if re.match(r"\s*[-*]\s+", line):
            flush_paragraph(para_buf)
            para_buf = []
            bullets: list[str] = []
            while i < n and re.match(r"\s*[-*]\s+", lines[i]):
                content = re.sub(r"^\s*[-*]\s+", "", lines[i]).strip()
                bullets.append(content)
                i += 1
            for b in bullets:
                story.append(Paragraph(
                    _md_inline_to_html(b),
                    styles["bullet"],
                    bulletText="•",
                ))
            continue

        # Table — header row + separator + body rows. We don't render a
        # table for a single-line `| x |` (which is almost always a typo);
        # require at least header + separator.
        if line.lstrip().startswith("|") and i + 1 < n and _is_table_separator(lines[i + 1]):
            flush_paragraph(para_buf)
            para_buf = []
            headers = _split_table_row(line)
            i += 2  # skip header + separator
            rows: list[list[str]] = []
            while i < n and lines[i].lstrip().startswith("|"):
                rows.append(_split_table_row(lines[i]))
                i += 1

            # Build the reportlab Table. Each cell becomes a Paragraph so
            # long content wraps inside its column.
            hcells = [Paragraph(_md_inline_to_html(h), styles["table_head"]) for h in headers]
            data: list[list[Any]] = [hcells]
            for r in rows:
                # Pad/truncate to header width so rowspans don't mis-align.
                padded = (r + [""] * len(headers))[: len(headers)]
                data.append([
                    Paragraph(_md_inline_to_html(c), styles["table_cell"])
                    for c in padded
                ])
            # Distribute the available width evenly across columns. A4 with
            # 18mm side margins → 210 - 36 = 174mm of printable width.
            usable_mm = 174.0
            col_width = (usable_mm * mm) / max(len(headers), 1)
            tbl = Table(data, colWidths=[col_width] * len(headers), repeatRows=1)
            tbl.setStyle(TableStyle([
                ("BACKGROUND",   (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
                ("FONTSIZE",     (0, 0), (-1, 0), 8.5),
                ("BOTTOMPADDING",(0, 0), (-1, 0), 6),
                ("TOPPADDING",   (0, 0), (-1, 0), 6),
                ("GRID",         (0, 0), (-1, -1), 0.3, colors.HexColor("#d1d5db")),
                ("VALIGN",       (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING",  (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]))
            story.append(Spacer(1, 4))
            story.append(tbl)
            story.append(Spacer(1, 6))
            continue

        # Fallback: accumulate into the current paragraph buffer.
        para_buf.append(line)
        i += 1

    flush_paragraph(para_buf)

    # Footer disclaimer + brand line — same wording as the markdown's
    # bottom block so the PDF reads consistently even if the owner edits
    # heavily and accidentally drops that section.
    story.append(Spacer(1, 14))
    story.append(HRFlowable(
        width="100%", thickness=0.5,
        color=colors.HexColor("#e5e7eb"),
        spaceBefore=4, spaceAfter=8,
    ))
    story.append(Paragraph(
        "<i>Formula AI Global — jamilformula.com. This report is a "
        "design guide. Lab trials and local regulatory checks are "
        "required before commercial production.</i>",
        styles["note"],
    ))

    doc.build(story)
    return buf.getvalue()


# ── Resend (email + attachment) ────────────────────────────────────────


def _client_email_html(req: dict[str, Any]) -> str:
    """Short, English-first cover note. Matches the consulting.html
    positioning: global brand, English by default, translation available
    on request."""
    pkg_label = PKG_LABELS.get(req.get("package", ""), "Consulting report")
    safe_email = (req.get("email") or "").replace("<", "&lt;")
    product = (req.get("product_type") or "your product").replace("<", "&lt;")
    return (
        '<div style="font-family:Arial,sans-serif; max-width:640px; margin:0 auto; color:#1f2937; padding:24px; line-height:1.6;">'
        '<h2 style="margin:0 0 12px; color:#0f172a;">Your ' + pkg_label + ' is ready</h2>'
        '<p>Hi,</p>'
        '<p>Thank you for trusting Formula AI Global with <strong>' + product + '</strong>. '
        'Your report is attached as a PDF. The deliverable was prepared by our six chemistry '
        'agents and reviewed by Jamil Abduljalil, 25-year industrial chemist.</p>'
        '<p style="margin:18px 0;">'
        '<strong>Next steps:</strong>'
        '<ul style="padding-left:18px; margin:8px 0;">'
        '<li>Read the executive summary first — every recommendation is colour-coded.</li>'
        '<li>Lab-trial the formulation before any commercial production.</li>'
        '<li>Replies to this email come straight to Jamil — happy to clarify anything.</li>'
        '</ul></p>'
        '<p>If you need this in another language (Arabic, French, Spanish, etc.) just reply to '
        'this email and we will translate the PDF within 24 hours at no extra charge.</p>'
        '<p style="margin-top:22px;">Best regards,<br>'
        '<strong>Jamil Abduljalil</strong><br>'
        '<span style="color:#64748b; font-size:12px;">Founder, Formula AI Global — industrial chemist, 25+ years</span></p>'
        '<hr style="border:none; border-top:1px solid #e5e7eb; margin:20px 0;">'
        '<p style="font-size:11px; color:#9ca3af; margin:0;">'
        'Sent to ' + safe_email + ' · '
        'jamilformula.com · &copy; 2026 Formula AI Global</p>'
        '</div>'
    )


async def _resend_send(
    *,
    to_email: str,
    subject: str,
    html: str,
    pdf_bytes: bytes,
    pdf_filename: str,
    reply_to: str | None = None,
) -> dict[str, Any]:
    """POST one email to the Resend API with a PDF attachment.

    Returns the parsed Resend response (`{id: '...'}` on success) or
    raises HTTPException on a non-2xx — caller can let it propagate, the
    Worker will surface the detail to the admin tab.
    """
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key or api_key.startswith("re_PASTE"):
        raise HTTPException(
            status_code=503,
            detail="RESEND_API_KEY missing on the backend — set it in Render env vars.",
        )

    payload = {
        "from": f"{RESEND_FROM_NAME} <{RESEND_FROM_EMAIL}>",
        "to": [to_email],
        "subject": subject,
        "html": html,
        "reply_to": reply_to or OWNER_EMAIL,
        "attachments": [
            {
                "filename": pdf_filename,
                "content": base64.b64encode(pdf_bytes).decode("ascii"),
                "content_type": "application/pdf",
            }
        ],
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            RESEND_API_BASE,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

    if r.status_code >= 300:
        # Trim the body so we don't dump the entire Resend payload back at
        # the admin tab — first 400 chars is enough to diagnose.
        detail = r.text[:400] if r.text else f"HTTP {r.status_code}"
        log.error("[resend.send] %s — %s", r.status_code, detail)
        raise HTTPException(
            status_code=502,
            detail=f"resend send failed ({r.status_code}): {detail}",
        )

    try:
        return r.json() or {}
    except Exception:
        return {}


async def _download_markdown(supabase: Any, ai_draft_md_url: str) -> str:
    """Pull the latest draft markdown back from either Supabase Storage
    (storage:// scheme) or its signed URL form. Mirrors the logic in
    `fetch_markdown` so we share one code path."""
    if not ai_draft_md_url:
        raise HTTPException(status_code=404, detail="no draft on row")

    if ai_draft_md_url.startswith("storage://"):
        path = ai_draft_md_url.split("/", 3)[3] if ai_draft_md_url.count("/") >= 3 else ""
        data = supabase.storage.from_(DRAFTS_BUCKET).download(path)
        return data.decode("utf-8")

    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(ai_draft_md_url)
        r.raise_for_status()
        return r.text


def _safe_pdf_filename(req: dict[str, Any]) -> str:
    """A clean, downloadable filename: '<product>-<pkg>-<id8>.pdf'."""
    product = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(req.get("product_type") or "report")).strip("-") or "report"
    pkg = req.get("package") or "report"
    short_id = (req.get("id") or "")[:8]
    name = f"{product[:40]}-{pkg}-{short_id}.pdf".lower()
    # Belt + braces: reportlab can't open files with stray quotes etc.
    return re.sub(r"[^a-z0-9._-]+", "-", name)


# ── Routes ─────────────────────────────────────────────────────────────


@router.post("/{request_id}/deliver", response_model=DeliverResponse)
async def deliver_consulting(
    request: Request,
    request_id: str = Path(..., min_length=10, max_length=64),
    body: DeliverRequest | None = None,
):
    """Render the markdown to PDF, email it to the client, mark delivered.

    Auth: same shared-secret header as every other internal endpoint here.
    The Worker (admin-only) is the public gate.
    """
    if request.headers.get("x-formula-internal") != os.getenv(
        "BACKEND_INTERNAL_SECRET", "missing-secret"
    ):
        raise HTTPException(status_code=403, detail="forbidden")

    body = body or DeliverRequest()
    supabase = request.app.state.supabase

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

    if req["status"] == "delivered" and not body.force:
        raise HTTPException(
            status_code=409,
            detail="already delivered — pass force=true to re-render and re-send",
        )
    if req["status"] not in ("review", "delivered"):
        raise HTTPException(
            status_code=409,
            detail=f"cannot deliver from status='{req['status']}' — generate a draft first",
        )
    if not req.get("email"):
        raise HTTPException(status_code=422, detail="row has no client email")

    # 1. Get the markdown the owner wants to ship.
    if body.markdown_override and body.markdown_override.strip():
        md = body.markdown_override
    else:
        md = await _download_markdown(supabase, req.get("ai_draft_md_url") or "")
    if not md or len(md) < 40:
        raise HTTPException(status_code=422, detail="markdown is empty or too short")

    # 2. Render PDF.
    pkg_label = PKG_LABELS.get(req.get("package", ""), "Consulting report")
    try:
        pdf_bytes = _render_pdf_from_markdown(md, title_fallback=pkg_label)
    except Exception as exc:  # noqa: BLE001
        log.exception("PDF render failed for %s", request_id)
        raise HTTPException(status_code=500, detail=f"pdf render failed: {exc}") from exc

    pdf_filename = _safe_pdf_filename(req)

    # 3. Upload final PDF to Supabase Storage. Path includes a timestamp so
    # re-deliveries don't overwrite the previous version — the row's
    # final_pdf_url is updated to point at the newest one, but the
    # previous PDFs remain auditable.
    object_path = f"{request_id}/final/{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex[:8]}.pdf"
    try:
        supabase.storage.from_(DRAFTS_BUCKET).upload(
            object_path,
            pdf_bytes,
            file_options={"content-type": "application/pdf"},
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("storage upload failed for %s", request_id)
        raise HTTPException(status_code=502, detail=f"storage upload failed: {exc}") from exc

    try:
        signed = supabase.storage.from_(DRAFTS_BUCKET).create_signed_url(
            object_path, FINAL_PDF_SIGNED_TTL_SECONDS
        )
        signed_url = signed.get("signedURL") or signed.get("signed_url")
    except Exception:
        signed_url = None

    # 4. Email the client. If sending fails, DO NOT mark delivered — the
    # admin needs to retry. We've already paid for the PDF render but it
    # is captured in storage so the next attempt re-uses it (next iteration
    # of this endpoint will re-render, which is fine — reportlab is cheap).
    subject = f"{pkg_label} — Formula AI Global"
    html = _client_email_html(req)
    try:
        send_result = await _resend_send(
            to_email=req["email"],
            subject=subject,
            html=html,
            pdf_bytes=pdf_bytes,
            pdf_filename=pdf_filename,
        )
    except HTTPException:
        # Re-raise so the Worker sees the 502/503 and can surface a clear
        # message to the admin tab. The row stays in 'review' so the next
        # click retries cleanly.
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("resend send failed for %s", request_id)
        raise HTTPException(status_code=502, detail=f"email send failed: {exc}") from exc

    email_id = send_result.get("id") if isinstance(send_result, dict) else None

    # 5. Update the row.
    supabase.table("consultation_requests").update(
        {
            "status": "delivered",
            "final_pdf_url": signed_url or f"storage://{DRAFTS_BUCKET}/{object_path}",
        }
    ).eq("id", request_id).execute()

    return DeliverResponse(
        ok=True,
        request_id=request_id,
        status="delivered",
        final_pdf_url=signed_url,
        email_id=email_id,
    )


@router.post("/{request_id}/resend", response_model=DeliverResponse)
async def resend_consulting(
    request: Request,
    request_id: str = Path(..., min_length=10, max_length=64),
):
    """Re-email the SAME final PDF that's already on the row. Does not
    re-render — useful when the client emails saying "lost the PDF, can
    you resend?".

    Owner-only via shared secret. Status must already be 'delivered'.
    """
    if request.headers.get("x-formula-internal") != os.getenv(
        "BACKEND_INTERNAL_SECRET", "missing-secret"
    ):
        raise HTTPException(status_code=403, detail="forbidden")

    supabase = request.app.state.supabase
    row = (
        supabase.table("consultation_requests")
        .select("*")
        .eq("id", request_id)
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="request not found")
    req = row.data

    if req["status"] != "delivered":
        raise HTTPException(
            status_code=409,
            detail=f"can only resend after first delivery (status='{req['status']}')",
        )
    if not req.get("final_pdf_url"):
        raise HTTPException(status_code=422, detail="no final_pdf_url on row")
    if not req.get("email"):
        raise HTTPException(status_code=422, detail="row has no client email")

    # Pull the PDF back. final_pdf_url may be a signed URL OR a storage://
    # reference — handle both shapes.
    url = req["final_pdf_url"]
    if url.startswith("storage://"):
        path = url.split("/", 3)[3] if url.count("/") >= 3 else ""
        pdf_bytes = supabase.storage.from_(DRAFTS_BUCKET).download(path)
    else:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(url)
            if r.status_code >= 300:
                raise HTTPException(
                    status_code=502,
                    detail=f"could not fetch existing PDF ({r.status_code})",
                )
            pdf_bytes = r.content

    pkg_label = PKG_LABELS.get(req.get("package", ""), "Consulting report")
    subject = f"{pkg_label} — Formula AI Global (resend)"
    html = _client_email_html(req)
    pdf_filename = _safe_pdf_filename(req)

    send_result = await _resend_send(
        to_email=req["email"],
        subject=subject,
        html=html,
        pdf_bytes=pdf_bytes,
        pdf_filename=pdf_filename,
    )
    email_id = send_result.get("id") if isinstance(send_result, dict) else None

    return DeliverResponse(
        ok=True,
        request_id=request_id,
        status="delivered",
        final_pdf_url=url if not url.startswith("storage://") else None,
        email_id=email_id,
        note="resend completed; row not modified",
    )
