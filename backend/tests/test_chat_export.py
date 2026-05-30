"""
Tests for the Phase 9.4 chat → PDF render endpoint at
backend/app/api/v2/chat_export.py.

We exercise it as a pure FastAPI handler with TestClient — small enough
to test inside the existing pytest setup. The header gate, size limits,
and the actual reportlab PDF output are all covered.
"""
from __future__ import annotations

import os
import sys
import types as _types
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# Stub `agents` so importing consulting (transitively required) doesn't
# pull the heavy Orchestrator graph.
if "agents" not in sys.modules:
    _stub = _types.ModuleType("agents")
    _stub.Orchestrator = type("Orchestrator", (), {})
    sys.modules["agents"] = _stub

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v2 import chat_export


INTERNAL_SECRET = "test-secret-xyz"


@pytest.fixture(autouse=True)
def _set_internal_secret(monkeypatch):
    monkeypatch.setenv("BACKEND_INTERNAL_SECRET", INTERNAL_SECRET)


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(chat_export.router, prefix="/api/v2")
    return TestClient(app)


def _good_headers():
    return {"x-formula-internal": INTERNAL_SECRET}


# ─── auth gate ─────────────────────────────────────────────────────


def test_render_pdf_requires_internal_secret(client):
    r = client.post(
        "/api/v2/chat/render-pdf",
        json={"markdown": "# Chat\n\nhi", "title": "x"},
    )
    assert r.status_code == 403


def test_render_pdf_rejects_wrong_secret(client):
    r = client.post(
        "/api/v2/chat/render-pdf",
        json={"markdown": "# Chat\n\nhi", "title": "x"},
        headers={"x-formula-internal": "WRONG"},
    )
    assert r.status_code == 403


# ─── input validation ─────────────────────────────────────────────


def test_render_pdf_rejects_empty_markdown(client):
    r = client.post(
        "/api/v2/chat/render-pdf",
        json={"markdown": "  ", "title": "x"},
        headers=_good_headers(),
    )
    assert r.status_code == 422


def test_render_pdf_rejects_huge_markdown(client):
    r = client.post(
        "/api/v2/chat/render-pdf",
        json={"markdown": "X" * 1_500_000, "title": "x"},
        headers=_good_headers(),
    )
    assert r.status_code == 413


# ─── success path ─────────────────────────────────────────────────


def test_render_pdf_returns_valid_pdf_bytes(client):
    md = (
        "# Cream R&D\n\n"
        "**Session:** `sess-1`  \n"
        "**Turns:** 2\n\n"
        "---\n\n"
        "## You · 2026-05-29 10:01:00 UTC\n\n"
        "I need a moisturising cream\n\n"
        "## Formula AI · 2026-05-29 10:01:08 UTC\n\n"
        "Here are 3 options that match your brief.\n\n"
        "**Formulas referenced**\n\n"
        "- Light Day Cream · trust 88/100\n"
        "- Rich Night Cream · trust 81/100\n"
    )
    r = client.post(
        "/api/v2/chat/render-pdf",
        json={"markdown": md, "title": "Cream R&D"},
        headers=_good_headers(),
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert ".pdf" in cd
    body = r.content
    assert body[:5] == b"%PDF-"
    assert b"%%EOF" in body[-32:]
    # Real PDFs are bigger than a trivial header — sanity-check the
    # parser actually rendered the content (not just an empty PDF).
    assert len(body) > 1_000


def test_render_pdf_filename_strips_unsafe_chars(client):
    r = client.post(
        "/api/v2/chat/render-pdf",
        json={"markdown": "# Hello\n\nfoo bar baz body text long enough", "title": "My Chat (10/2026)!"},
        headers=_good_headers(),
    )
    assert r.status_code == 200
    cd = r.headers["content-disposition"]
    assert "(" not in cd
    assert "/" not in cd
    assert "!" not in cd
    assert ".pdf" in cd


def test_render_pdf_falls_back_when_title_missing(client):
    r = client.post(
        "/api/v2/chat/render-pdf",
        json={"markdown": "# h\n\nbody text long enough to pass the 10-char floor"},
        headers=_good_headers(),
    )
    assert r.status_code == 200
    assert r.content[:5] == b"%PDF-"
