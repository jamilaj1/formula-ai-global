"""
Enterprise one-pager (leave-behind) PDF — F2 of ROADMAP_TO_10.md.

A single, polished A4 page a salesperson can email or leave after a
meeting. Pure static branded content (no DB, no user data) — outcomes
first (factories buy results, not "AI"), then what's included,
compliance/security, founder credibility, and pricing.

GET /api/v2/enterprise/onepager.pdf
Gated by the same x-formula-internal secret as the other PDF endpoints;
the Worker proxies it publicly at /be/enterprise/onepager.
"""
from __future__ import annotations

import io
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, ListFlowable, ListItem,
)

router = APIRouter(prefix="/enterprise", tags=["enterprise-pdf"])

INK = colors.HexColor("#0f172a")
MUTE = colors.HexColor("#475569")
GREEN = colors.HexColor("#059669")


def _styles():
    base = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("oH1", parent=base["Heading1"], fontSize=20, leading=23,
                             textColor=INK, spaceAfter=2),
        "tag": ParagraphStyle("oTag", parent=base["Normal"], fontSize=10.5, leading=14,
                              textColor=GREEN, spaceAfter=10),
        "h2": ParagraphStyle("oH2", parent=base["Heading2"], fontSize=12, leading=15,
                             textColor=INK, spaceBefore=10, spaceAfter=5),
        "body": ParagraphStyle("oBody", parent=base["Normal"], fontSize=9.5, leading=13.5,
                               textColor=MUTE),
        "cell": ParagraphStyle("oCell", parent=base["Normal"], fontSize=9, leading=12.5,
                               textColor=INK),
        "note": ParagraphStyle("oNote", parent=base["Normal"], fontSize=8, leading=11,
                               textColor=colors.HexColor("#94a3b8")),
    }


def _render_onepager() -> bytes:
    s = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=16 * mm, rightMargin=16 * mm, topMargin=15 * mm, bottomMargin=14 * mm,
        title="Formula AI Global — Enterprise", author="Formula AI Global",
    )
    story = []

    story.append(Paragraph("Formula AI Global — for chemical manufacturers", s["h1"]))
    story.append(Paragraph("Lower costs · Faster R&amp;D · Audit-ready compliance", s["tag"]))
    story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#e2e8f0"), spaceAfter=8))

    story.append(Paragraph("Your factory doesn't buy AI — it buys results", s["h2"]))
    story.append(Paragraph(
        "A private chemistry-intelligence platform that turns 25 years of industrial "
        "formulation expertise + a 3,381-formula knowledge base into measurable outcomes "
        "for your plant.", s["body"]))

    # Outcomes table (2x2)
    out = [
        [Paragraph("<b>💰 Reduce material cost</b><br/>Substitute intelligence + supplier price alerts.", s["cell"]),
         Paragraph("<b>⚡ Faster time-to-market</b><br/>Hours, not months, from idea to a working draft.", s["cell"])],
        [Paragraph("<b>✅ Consistent quality</b><br/>Stability, compatibility &amp; QC checks built in.", s["cell"]),
         Paragraph("<b>📄 Audit-ready compliance</b><br/>GHS MSDS + EU REACH / FDA / SFDA / SASO docs.", s["cell"])],
    ]
    t = Table(out, colWidths=[88 * mm, 88 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(Spacer(1, 6))
    story.append(t)

    story.append(Paragraph("What's included", s["h2"]))
    items = [
        "<b>Private formula vault</b> — your IP, isolated, never used to train any model.",
        "<b>Multi-seat team accounts</b> — 5–200 users, per-role access, one invoice.",
        "<b>Compliance documents</b> — GHS MSDS + registration docs, signed by a chemist.",
        "<b>AI assistant on your data</b> — answers in-context about your own product line.",
        "<b>Supplier intelligence</b> — trusted/avoid ratings + price-move &amp; shortage alerts.",
        "<b>Batch calculators &amp; QC</b> — cost, scale-up, pH, HLB, stability — in the plant.",
    ]
    story.append(ListFlowable(
        [ListItem(Paragraph(i, s["body"]), leftIndent=6) for i in items],
        bulletType="bullet", start="•", leftIndent=10, spaceBefore=0,
    ))

    story.append(Paragraph("Security &amp; trust", s["h2"]))
    story.append(Paragraph(
        "Mutual NDA on every engagement · data isolated per company · row-level "
        "security · GDPR-aware logging · EU + US + GCC regulatory coverage.", s["body"]))

    story.append(Paragraph("Built by an operator, not a lab", s["h2"]))
    story.append(Paragraph(
        "Founder Jamil Abduljalil: 25+ years of hands-on industrial chemistry across "
        "multiple countries, overseeing 2,000+ tons/month, and founder of the DosLunas "
        "plant (50+ tons/day). The platform solves the problems he lived.", s["body"]))

    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#e2e8f0"), spaceAfter=6))
    pricing = Table([[
        Paragraph("<b>From $500/month</b>, scaled to team size. No setup fee. "
                  "Annual or quarterly. 30-day cancellation.", s["cell"]),
        Paragraph("<b>Book a 30-min consultation</b><br/>jamilformula.com/enterprise.html<br/>jamilaj1@gmail.com", s["cell"]),
    ]], colWidths=[100 * mm, 76 * mm])
    pricing.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(pricing)

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Formula AI Global · jamilformula.com · "
        + datetime.now(timezone.utc).strftime("%Y-%m-%d"), s["note"]))

    doc.build(story)
    return buf.getvalue()


@router.get("/onepager.pdf")
async def enterprise_onepager(request: Request):
    if request.headers.get("x-formula-internal") != os.getenv("BACKEND_INTERNAL_SECRET", "missing-secret"):
        raise HTTPException(status_code=403, detail="forbidden")
    try:
        pdf = _render_onepager()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"render failed: {exc}") from exc
    return Response(
        content=pdf, media_type="application/pdf",
        headers={
            "Content-Disposition": 'inline; filename="Formula-AI-Enterprise.pdf"',
            "Cache-Control": "public, max-age=3600",
        },
    )
