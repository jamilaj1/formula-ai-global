"""
Tests for the consulting markdown + PDF rendering paths.

These exercise the pure-function rendering layer (_render_markdown,
_render_pdf_from_markdown, _md_inline_to_html, _safe_pdf_filename) so
we catch a regression the moment someone breaks the deliverable shape
the customer pays $1k-$5k for.

We do NOT touch the orchestrator, OpenAI, or Supabase here — those are
covered by integration tests elsewhere. The agents module is stubbed
before importing consulting.py because consulting.py's top-level
`from agents import Orchestrator` would otherwise pull in heavy
chemistry deps we don't need for rendering tests.
"""
from __future__ import annotations

import sys
import types as _types
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# Stub `agents` so consulting.py imports without dragging in Orchestrator.
if "agents" not in sys.modules:
    _stub = _types.ModuleType("agents")
    _stub.Orchestrator = type("Orchestrator", (), {})
    sys.modules["agents"] = _stub

from app.api.v2 import consulting as cons  # noqa: E402


# ─── _render_markdown ────────────────────────────────────────────────


def _base_req(**overrides):
    base = {
        "id": "req-1",
        "email": "client@example.com",
        "company": "Test Co",
        "package": "quick",
        "product_type": "Liquid hand soap",
        "market": "KSA",
        "brief": "I need a clean-label liquid hand soap.",
    }
    base.update(overrides)
    return base


def test_render_markdown_includes_required_sections():
    md = cons._render_markdown(
        _base_req(),
        {
            "summary": "We recommend the SLS-based formulation.",
            "overall_verdict": "ready",
            "agent_results": {},
            "proposals": [],
            "recommendations": ["Use 0.5% Optiphen as preservative."],
        },
    )
    assert "# Quick Diagnostic" in md
    assert "client@example.com" in md
    assert "Test Co" in md
    assert "Liquid hand soap" in md
    assert "KSA" in md
    assert "Executive summary" in md
    assert "Client brief" in md
    assert "Recommendations" in md
    assert "Notes & disclaimers" in md
    assert "Use 0.5% Optiphen" in md


def test_render_markdown_full_package_label():
    md = cons._render_markdown(_base_req(package="full"), {})
    assert "# Full Formulation Report" in md


def test_render_markdown_custom_package_label():
    md = cons._render_markdown(_base_req(package="custom"), {})
    assert "# Custom Project" in md


def test_render_markdown_unknown_package_falls_back():
    md = cons._render_markdown(_base_req(package="weird"), {})
    assert "# Formulation Report" in md  # fallback header


def test_render_markdown_with_proposal_renders_ingredient_table():
    result = {
        "summary": "ok",
        "overall_verdict": "ready",
        "proposals": [{
            "name": "Soap V1",
            "description": "A starter formulation",
            "components": [
                {"name_en": "Water", "percentage": 75.0,
                 "cas_number": "7732-18-5", "function": "solvent"},
                {"name_en": "SLS",  "percentage": 12.0,
                 "cas_number": "151-21-3", "function": "surfactant"},
            ],
        }],
    }
    md = cons._render_markdown(_base_req(), result)
    assert "Recommended formulation" in md
    assert "Soap V1" in md
    assert "Water" in md
    assert "75.00" in md
    assert "7732-18-5" in md
    # The markdown table header should be present
    assert "| # | Ingredient |" in md


def test_render_markdown_with_alternative_proposals():
    result = {
        "summary": "s",
        "overall_verdict": "ready",
        "proposals": [
            {"name": "Primary", "components": []},
            {"name": "Alt A",   "components": []},
            {"name": "Alt B",   "components": []},
        ],
    }
    md = cons._render_markdown(_base_req(), result)
    assert "Alternative formulations considered" in md
    assert "Option 2" in md
    assert "Option 3" in md


def test_render_markdown_handles_empty_result():
    md = cons._render_markdown(_base_req(), {})
    # Still produces a coherent document with the title + brief block.
    assert "# Quick Diagnostic" in md
    assert "client@example.com" in md
    assert "Notes & disclaimers" in md
    # No fake summary should appear if the orchestrator returned nothing.
    assert "(no summary returned)" in md


def test_render_markdown_handles_safety_agent_block():
    result = {
        "summary": "ok",
        "overall_verdict": "ready",
        "agent_results": {
            "safety": {
                "verdict": "pass",
                "confidence": 0.92,
                "issues": [{"severity": "low", "message": "watch pH"}],
                "evidence": ["EU Cosmetic Regulation 1223/2009"],
                "suggestions": [{"text": "Add 0.05% EDTA"}],
            },
        },
    }
    md = cons._render_markdown(_base_req(), result)
    assert "Safety analysis" in md
    assert "PASS" in md
    assert "[LOW]" in md
    assert "watch pH" in md
    assert "EU Cosmetic Regulation 1223/2009" in md


# ─── _md_inline_to_html ─────────────────────────────────────────────


def test_inline_html_escapes_then_formats_bold():
    h = cons._md_inline_to_html("hello **world** <script>")
    assert "<b>world</b>" in h
    assert "&lt;script&gt;" in h


def test_inline_html_renders_italic():
    h = cons._md_inline_to_html("the _word_ here")
    assert "<i>word</i>" in h


def test_inline_html_renders_code():
    h = cons._md_inline_to_html("call `foo()` here")
    assert "<font face='Courier'>foo()</font>" in h


# ─── _render_pdf_from_markdown ──────────────────────────────────────


def test_pdf_from_markdown_returns_valid_pdf_bytes():
    md = "# Hello\n\nThis is a **bold** test.\n\n## Section\n\n- Item A\n- Item B\n"
    pdf = cons._render_pdf_from_markdown(md)
    assert isinstance(pdf, bytes)
    assert len(pdf) > 200
    assert pdf.startswith(b"%PDF-")
    # PDF files end with %%EOF (sometimes followed by newline / nothing)
    assert b"%%EOF" in pdf[-32:]


def test_pdf_from_markdown_handles_table():
    md = (
        "# Test\n\n"
        "| # | Ingredient | % | CAS | Function |\n"
        "|---|---|---|---|---|\n"
        "| 1 | Water | 75 | 7732 | solvent |\n"
        "| 2 | SLS   | 12 | 151  | surfactant |\n"
    )
    pdf = cons._render_pdf_from_markdown(md)
    assert pdf.startswith(b"%PDF-")
    assert len(pdf) > 500


def test_pdf_from_markdown_handles_blockquote():
    md = "# T\n\n> a quoted line\n> a second quoted line\n"
    pdf = cons._render_pdf_from_markdown(md)
    assert pdf.startswith(b"%PDF-")


def test_pdf_from_markdown_handles_hr():
    md = "# T\n\nfirst para\n\n---\n\nsecond para\n"
    pdf = cons._render_pdf_from_markdown(md)
    assert pdf.startswith(b"%PDF-")


def test_pdf_from_markdown_uses_fallback_title_when_no_h1():
    md = "some body text only"
    pdf = cons._render_pdf_from_markdown(md, title_fallback="My Report")
    assert pdf.startswith(b"%PDF-")


# ─── _safe_pdf_filename ─────────────────────────────────────────────


def test_safe_pdf_filename_strips_unsafe_chars_and_lowercases():
    name = cons._safe_pdf_filename({
        "id": "abcdefghij",
        "product_type": "Hand Soap (Clear, Quality)",
        "package": "quick",
    })
    assert name.endswith(".pdf")
    assert "(" not in name
    assert "," not in name
    assert " " not in name
    assert name == name.lower()
    assert name.startswith("hand-soap")


def test_safe_pdf_filename_falls_back_when_product_type_missing():
    name = cons._safe_pdf_filename({"id": "abcdefghij", "package": "full"})
    assert name.endswith(".pdf")
    assert "report" in name


# ─── PKG_LABELS map sanity ──────────────────────────────────────────


def test_pkg_labels_cover_the_three_packages():
    assert cons.PKG_LABELS["quick"]  == "Quick Diagnostic"
    assert cons.PKG_LABELS["full"]   == "Full Formulation Report"
    assert cons.PKG_LABELS["custom"] == "Custom Project"
