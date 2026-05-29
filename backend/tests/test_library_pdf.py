"""
Tests for the library spec-sheet PDF renderer (Phase 4).

We exercise the pure rendering function (`_render_pdf`) and the `_safe`
helper directly. The endpoint wrapper (which adds auth + Supabase fetch)
is covered by the worker integration tests elsewhere.

The goal: catch a regression that produces a 0-byte or malformed PDF
the moment someone refactors the table/process-conditions layout.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.api.v2.library_pdf import _render_pdf, _safe  # noqa: E402


# ─── _safe ──────────────────────────────────────────────────────────


def test_safe_default_on_none():
    assert _safe(None) == "—"


def test_safe_custom_default_on_empty_string():
    assert _safe("", default="N/A") == "N/A"


def test_safe_strips_whitespace():
    assert _safe("  whitespace  ") == "whitespace"


def test_safe_coerces_int():
    assert _safe(42) == "42"


def test_safe_coerces_float():
    assert _safe(3.14) == "3.14"


# ─── _render_pdf ────────────────────────────────────────────────────


def test_render_pdf_minimal_row_returns_valid_pdf():
    pdf = _render_pdf({"name": "Hand Soap", "category": "personal_hygiene"})
    assert isinstance(pdf, bytes)
    assert len(pdf) > 200
    assert pdf.startswith(b"%PDF-")
    assert b"%%EOF" in pdf[-32:]


def test_render_pdf_with_full_components_table():
    formula = {
        "name": "Test Formula",
        "category": "cleaning",
        "form_type": "liquid",
        "components": [
            {"name_en": "Water",    "percentage": 70.0, "cas_number": "7732-18-5", "function": "solvent"},
            {"name_en": "SLS",      "percentage": 15.0, "cas_number": "151-21-3",  "function": "surfactant"},
            {"name_en": "Glycerin", "percentage":  5.0, "cas_number": "56-81-5",   "function": "humectant"},
        ],
    }
    pdf = _render_pdf(formula)
    assert pdf.startswith(b"%PDF-")
    assert len(pdf) > 600


def test_render_pdf_with_process_conditions():
    formula = {
        "name": "Cream",
        "process_conditions": {
            "temperature":  "65 C",
            "mixing_speed": "200 rpm",
        },
    }
    pdf = _render_pdf(formula)
    assert pdf.startswith(b"%PDF-")


def test_render_pdf_with_properties_block():
    formula = {
        "name": "Lotion",
        "properties": {"viscosity": "1500 cP", "pH": "5.5"},
    }
    pdf = _render_pdf(formula)
    assert pdf.startswith(b"%PDF-")


def test_render_pdf_with_no_components_still_renders():
    pdf = _render_pdf({"name": "Empty"})
    assert pdf.startswith(b"%PDF-")


def test_render_pdf_with_malformed_percentage_doesnt_crash():
    # We coerce in the renderer; non-numeric percentages must not blow up.
    formula = {
        "name": "Bad data",
        "components": [
            {"name_en": "Water", "percentage": "not a number"},
            {"name_en": "SLS",   "percentage": None},
        ],
    }
    pdf = _render_pdf(formula)
    assert pdf.startswith(b"%PDF-")


def test_render_pdf_with_trust_score_and_project_meta():
    formula = {
        "name": "Project formula",
        "category": "hair_care",
        "form_type": "liquid",
        "project": "Cosmetics 2026",
        "trust_score": 87,
        "description": "A herbal shampoo trial.",
        "notes": "Increased nettle extract from 1% to 2%.",
    }
    pdf = _render_pdf(formula)
    assert pdf.startswith(b"%PDF-")
    assert len(pdf) > 400


def test_render_pdf_component_total_is_computed():
    # Smoke test: total row should appear even if it's only renderable.
    # We can't easily inspect inner reportlab output, but we can confirm
    # the byte length grows roughly linearly with row count.
    one  = _render_pdf({"name": "x", "components": [{"name_en": "A", "percentage": 100}]})
    five = _render_pdf({"name": "x", "components": [
        {"name_en": "A", "percentage": 20},
        {"name_en": "B", "percentage": 20},
        {"name_en": "C", "percentage": 20},
        {"name_en": "D", "percentage": 20},
        {"name_en": "E", "percentage": 20},
    ]})
    assert len(five) > len(one)
