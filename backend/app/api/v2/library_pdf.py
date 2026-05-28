"""
Formula PDF export — Phase 4.4 of BUILD_ROADMAP.md.

Endpoint: GET /api/v2/library/{id}/pdf

Renders a single-page spec sheet for a user_formulas row using
reportlab (already in backend/requirements.txt). The Cloudflare Worker
calls this on behalf of the signed-in user via /library/{id}/pdf and
streams the PDF bytes back to the browser.

Why server-side: reportlab is too heavy for the Worker (no native
deps), but Render already has it. The header check (same shared
secret as the consulting backend) makes the endpoint internal-only.
"""
from __future__ import annotations

import io
import logging
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Path, Query, Request
from fastapi.responses import Response

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
)

router = APIRouter(prefix="/library", tags=["library-pdf"])

log = logging.getLogger("library_pdf")

# Same secret as the consulting endpoints. Set in Render env.
INTERNAL_HEADER = "x-formula-internal"


def _require_internal(request: Request) -> None:
    expected = os.getenv("BACKEND_INTERNAL_SECRET", "missing-secret")
    if request.headers.get(INTERNAL_HEADER) != expected:
        raise HTTPException(status_code=403, detail="forbidden")


def _safe(s: Any, default: str = "—") -> str:
    """Coerce anything to a non-empty string."""
    if s is None:
        return default
    out = str(s).strip()
    return out if out else default


def _render_pdf(formula: dict[str, Any]) -> bytes:
    """Layout one polished spec sheet for the given user_formulas row."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=_safe(formula.get("name"), "Formula spec"),
        author="Formula AI Global",
    )
    styles = getSampleStyleSheet()
    h_style = ParagraphStyle(
        "TitleH", parent=styles["Heading1"], fontSize=18, leading=22,
        spaceAfter=4, textColor=colors.HexColor("#0f172a"),
    )
    sub_style = ParagraphStyle(
        "Sub", parent=styles["Normal"], fontSize=10, leading=14,
        textColor=colors.HexColor("#6b7280"),
    )
    sec_style = ParagraphStyle(
        "Sec", parent=styles["Heading2"], fontSize=12, leading=15,
        spaceBefore=12, spaceAfter=6,
        textColor=colors.HexColor("#0f172a"),
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"], fontSize=10, leading=14,
        textColor=colors.HexColor("#1f2937"),
    )
    note_style = ParagraphStyle(
        "Note", parent=styles["Normal"], fontSize=8.5, leading=12,
        textColor=colors.HexColor("#9ca3af"),
    )

    story: list[Any] = []

    # ─── Title block ────────────────────────────────────────────────
    story.append(Paragraph(_safe(formula.get("name"), "Untitled formula"), h_style))

    meta_parts = []
    if formula.get("category"):
        meta_parts.append(_safe(formula["category"]))
    if formula.get("form_type"):
        meta_parts.append(_safe(formula["form_type"]))
    if formula.get("project"):
        meta_parts.append("project: " + _safe(formula["project"]))
    if formula.get("trust_score") is not None:
        meta_parts.append(f"trust {int(formula['trust_score'])}/100")
    if meta_parts:
        story.append(Paragraph(" · ".join(meta_parts), sub_style))

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    story.append(Paragraph(f"Generated {today} · Formula AI Global", note_style))
    story.append(Spacer(1, 8))

    # ─── Description / notes ────────────────────────────────────────
    if formula.get("description"):
        story.append(Paragraph("Description", sec_style))
        story.append(Paragraph(_safe(formula["description"]), body_style))

    if formula.get("notes"):
        story.append(Paragraph("Owner notes", sec_style))
        story.append(Paragraph(_safe(formula["notes"]), body_style))

    # ─── Ingredients table ──────────────────────────────────────────
    components = formula.get("components") or []
    story.append(Paragraph(f"Ingredients ({len(components)})", sec_style))

    if not components:
        story.append(Paragraph("<i>No ingredients on this row.</i>", body_style))
    else:
        # Wrap each cell in a Paragraph so long names + functions can
        # word-wrap inside the table column.
        cell_style = ParagraphStyle(
            "Cell", parent=body_style, fontSize=9, leading=11.5,
        )
        head_style = ParagraphStyle(
            "Head", parent=cell_style, fontSize=8.5, textColor=colors.white,
            alignment=0,  # 0 = left
        )

        headers = ["#", "Ingredient", "%", "CAS", "Function"]
        rows = [[Paragraph(h, head_style) for h in headers]]
        total_pct = 0.0
        for i, c in enumerate(components, 1):
            pct = c.get("percentage") if isinstance(c, dict) else None
            try:
                total_pct += float(pct) if pct is not None else 0.0
            except (TypeError, ValueError):
                pass
            rows.append([
                Paragraph(str(i), cell_style),
                Paragraph(_safe((c or {}).get("name_en") or (c or {}).get("name")), cell_style),
                Paragraph(f"{float(pct):.2f}" if pct is not None else "—", cell_style),
                Paragraph(_safe((c or {}).get("cas_number")), cell_style),
                Paragraph(_safe((c or {}).get("function")), cell_style),
            ])
        # Total row
        rows.append([
            Paragraph("", cell_style),
            Paragraph("<b>Total</b>", cell_style),
            Paragraph(f"<b>{total_pct:.2f}</b>", cell_style),
            Paragraph("", cell_style),
            Paragraph("", cell_style),
        ])

        tbl = Table(
            rows,
            colWidths=[10 * mm, 70 * mm, 18 * mm, 28 * mm, 48 * mm],
            repeatRows=1,
        )
        tbl.setStyle(TableStyle([
            ("BACKGROUND",   (0, 0), (-1, 0), colors.HexColor("#0f172a")),
            ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
            ("FONTSIZE",     (0, 0), (-1, 0), 8.5),
            ("BOTTOMPADDING",(0, 0), (-1, 0), 6),
            ("TOPPADDING",   (0, 0), (-1, 0), 6),
            ("BACKGROUND",   (0, -1), (-1, -1), colors.HexColor("#f3f4f6")),
            ("GRID",         (0, 0), (-1, -1), 0.3, colors.HexColor("#d1d5db")),
            ("VALIGN",       (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING",  (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(tbl)

    # ─── Process / properties ──────────────────────────────────────
    pc = formula.get("process_conditions") or {}
    if isinstance(pc, dict) and pc:
        story.append(Paragraph("Process conditions", sec_style))
        for k, v in pc.items():
            story.append(Paragraph(
                f"<b>{_safe(k).replace('_', ' ').capitalize()}:</b> {_safe(v)}",
                body_style,
            ))

    props = formula.get("properties") or {}
    if isinstance(props, dict) and props:
        story.append(Paragraph("Properties", sec_style))
        for k, v in props.items():
            story.append(Paragraph(
                f"<b>{_safe(k).replace('_', ' ').capitalize()}:</b> {_safe(v)}",
                body_style,
            ))

    # ─── Footer disclaimer ─────────────────────────────────────────
    story.append(Spacer(1, 12))
    story.append(Paragraph(
        "<i>Generated by Formula AI Global — jamilformula.com. "
        "This spec sheet is a design guide. Always run lab trials and "
        "regulatory checks before commercial production.</i>",
        note_style,
    ))

    doc.build(story)
    return buf.getvalue()


@router.get("/{formula_id}/pdf")
async def export_formula_pdf(
    request: Request,
    formula_id: str = Path(..., min_length=8, max_length=64),
    user_id: str = Query(..., description="Owning user UUID, supplied by the Worker"),
):
    """
    Render a single user_formulas row as a PDF and stream it back.

    The Worker is the auth gate (it checks auth.userId against the row's
    user_id via service-role lookup) and forwards `user_id` here so the
    backend can fetch the row scoped to that user — defence in depth in
    case the formula_id is leaked.
    """
    _require_internal(request)

    supabase = request.app.state.supabase
    res = (
        supabase.table("user_formulas")
        .select("*")
        .eq("id", formula_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="not found")

    try:
        pdf_bytes = _render_pdf(res.data)
    except Exception as exc:  # noqa: BLE001
        log.exception("PDF render failed for %s", formula_id)
        raise HTTPException(status_code=500, detail=f"render failed: {exc}") from exc

    safe_name = (
        "".join(c for c in (res.data.get("name") or "formula") if c.isalnum() or c in "-_")
        or "formula"
    )[:60]
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_name}.pdf"',
        "Cache-Control": "private, no-store",
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
