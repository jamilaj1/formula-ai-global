"""Tests for the F2 enterprise one-pager PDF endpoint."""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v2 import enterprise_pdf

SECRET = "ent-secret-xyz"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("BACKEND_INTERNAL_SECRET", SECRET)


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(enterprise_pdf.router, prefix="/api/v2")
    return TestClient(app)


def test_requires_internal_secret(client):
    r = client.get("/api/v2/enterprise/onepager.pdf")
    assert r.status_code == 403


def test_rejects_wrong_secret(client):
    r = client.get("/api/v2/enterprise/onepager.pdf", headers={"x-formula-internal": "nope"})
    assert r.status_code == 403


def test_returns_valid_pdf(client):
    r = client.get("/api/v2/enterprise/onepager.pdf", headers={"x-formula-internal": SECRET})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    body = r.content
    assert body[:5] == b"%PDF-"
    assert b"%%EOF" in body[-32:]
    assert len(body) > 2000  # a real one-pager, not an empty doc


def test_render_function_is_pure_and_repeatable():
    a = enterprise_pdf._render_onepager()
    b = enterprise_pdf._render_onepager()
    assert a[:5] == b"%PDF-" and b[:5] == b"%PDF-"
    # Same structural size ballpark (timestamps differ but layout is fixed).
    assert abs(len(a) - len(b)) < 500
