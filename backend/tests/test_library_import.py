"""
Tests for the Phase 9.3 CSV / XLSX → user_formulas import path at
backend/app/api/v2/library_import.py.

Covers the parser (CSV + XLSX), per-row validation, the header gate,
size + row caps, and the commit-time supabase insert glue (mocked).
"""
from __future__ import annotations

import csv
import io
import sys
import types as _types
from pathlib import Path
from unittest.mock import MagicMock

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# Stub `agents` so consulting → ... imports cleanly.
if "agents" not in sys.modules:
    _stub = _types.ModuleType("agents")
    _stub.Orchestrator = type("Orchestrator", (), {})
    sys.modules["agents"] = _stub

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.api.v2 import library_import as li


SECRET = "phase93-secret"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("BACKEND_INTERNAL_SECRET", SECRET)


@pytest.fixture
def fake_supabase():
    """Stand-in for the supabase client used by /commit."""
    sup = MagicMock()
    inserted = []

    def fake_insert(payloads):
        inserted.extend(payloads if isinstance(payloads, list) else [payloads])
        out = MagicMock()
        out.execute.return_value.data = [
            {"id": f"row-{i}", **p} for i, p in enumerate(payloads)
        ]
        return out

    sup.table.return_value.insert.side_effect = fake_insert
    sup._inserted = inserted
    return sup


@pytest.fixture
def client(fake_supabase):
    app = FastAPI()
    app.state.supabase = fake_supabase
    app.include_router(li.router, prefix="/api/v2")
    return TestClient(app)


def _good_headers():
    return {"x-formula-internal": SECRET}


# ─── tiny CSV / XLSX fixtures ────────────────────────────────────


def _csv_bytes(rows: list[dict]) -> bytes:
    if not rows:
        return b""
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue().encode("utf-8")


def _xlsx_bytes(rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    headers = list(rows[0].keys())
    ws.append(headers)
    for r in rows:
        ws.append([r.get(h) for h in headers])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


_VALID_ROWS = [
    {
        "name": "Hand Soap V1",
        "category": "personal_hygiene",
        "ingredients": "Water | 75 | 7732-18-5 | solvent ; SLS | 12 | 151-21-3 | surfactant ; Glycerin | 5 | 56-81-5 | humectant",
        "trust_score": "88",
        "project": "Cleaning 2026",
        "tags": "wip, herbal",
    },
    {
        "name": "Liquid Detergent V2",
        "category": "laundry",
        "ingredients": "Water | 60 | | solvent ; LAS | 18 | 25155-30-0 | surfactant",
        "trust_score": "82",
        "project": "Cleaning 2026",
        "tags": "approved",
    },
]


# ─── auth gate ────────────────────────────────────────────────────


def test_preview_requires_secret(client):
    r = client.post(
        "/api/v2/library/import/preview",
        files={"file": ("test.csv", _csv_bytes(_VALID_ROWS), "text/csv")},
        data={"user_id": "user-uuid-123456"},
    )
    assert r.status_code == 403


def test_commit_requires_secret(client):
    r = client.post(
        "/api/v2/library/import/commit",
        json={"user_id": "user-uuid-123456", "rows": [{"name": "x", "components": [{"name_en": "Water", "percentage": 75}]}]},
    )
    assert r.status_code == 403


# ─── /preview — CSV ───────────────────────────────────────────────


def test_preview_csv_happy_path(client):
    r = client.post(
        "/api/v2/library/import/preview",
        files={"file": ("test.csv", _csv_bytes(_VALID_ROWS), "text/csv")},
        data={"user_id": "user-uuid-123456"},
        headers=_good_headers(),
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    assert j["total_rows"] == 2
    assert j["valid_rows"] == 2
    assert len(j["rows"]) == 2
    assert j["rows"][0]["name"] == "Hand Soap V1"
    assert len(j["rows"][0]["components"]) == 3
    # Tags are parsed from the comma-separated cell
    assert j["rows"][0]["tags"] == ["wip", "herbal"]
    assert j["rows"][0]["project"] == "Cleaning 2026"
    assert j["rows"][0]["trust_score"] == 88


def test_preview_csv_row_with_bad_pct_lands_in_warnings(client):
    rows = list(_VALID_ROWS) + [{
        "name": "Bad Row",
        "category": "x",
        "ingredients": "Water | not-a-number ; SLS | 12",
        "trust_score": "",
        "project": "",
        "tags": "",
    }]
    r = client.post(
        "/api/v2/library/import/preview",
        files={"file": ("t.csv", _csv_bytes(rows), "text/csv")},
        data={"user_id": "user-uuid-123456"},
        headers=_good_headers(),
    )
    j = r.json()
    assert j["valid_rows"] == 3  # bad pct still has SLS valid, so row passes
    assert any(e["severity"] == "warning" for e in j["errors"])


def test_preview_row_with_no_usable_components_is_skipped(client):
    rows = list(_VALID_ROWS) + [{
        "name": "Broken Row",
        "category": "x",
        "ingredients": "",   # no ingredients at all
        "trust_score": "",
        "project": "",
        "tags": "",
    }]
    r = client.post(
        "/api/v2/library/import/preview",
        files={"file": ("t.csv", _csv_bytes(rows), "text/csv")},
        data={"user_id": "user-uuid-123456"},
        headers=_good_headers(),
    )
    j = r.json()
    assert j["valid_rows"] == 2
    skipped = [e for e in j["errors"] if e["severity"] == "skipped"]
    assert len(skipped) == 1
    assert skipped[0]["row_n"] == 4


def test_preview_missing_required_column_returns_422(client):
    rows = [{"name": "X", "category": "y"}]  # no `ingredients`
    r = client.post(
        "/api/v2/library/import/preview",
        files={"file": ("t.csv", _csv_bytes(rows), "text/csv")},
        data={"user_id": "user-uuid-123456"},
        headers=_good_headers(),
    )
    assert r.status_code == 422
    assert "ingredients" in r.json()["detail"]


def test_preview_normalises_headers_case_and_spacing(client):
    # "Sub Category" → sub_category, "  NAME  " → name
    csv_text = "  NAME ,Sub Category,ingredients\nx,foo,Water | 50 ; SLS | 50\n"
    r = client.post(
        "/api/v2/library/import/preview",
        files={"file": ("t.csv", csv_text.encode("utf-8"), "text/csv")},
        data={"user_id": "user-uuid-123456"},
        headers=_good_headers(),
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["rows"][0]["name"] == "x"
    assert j["rows"][0]["sub_category"] == "foo"


def test_preview_surfaces_ignored_columns_in_notes(client):
    rows = [{"name": "X", "ingredients": "W | 100", "weirdcol": "stuff"}]
    r = client.post(
        "/api/v2/library/import/preview",
        files={"file": ("t.csv", _csv_bytes(rows), "text/csv")},
        data={"user_id": "user-uuid-123456"},
        headers=_good_headers(),
    )
    j = r.json()
    assert any("weirdcol" in n for n in j["notes"])


def test_preview_empty_file_400(client):
    r = client.post(
        "/api/v2/library/import/preview",
        files={"file": ("empty.csv", b"", "text/csv")},
        data={"user_id": "user-uuid-123456"},
        headers=_good_headers(),
    )
    assert r.status_code == 400


def test_preview_oversized_file_413(client):
    big = b"name,ingredients\n" + (b"a,b|1\n" * 1_500_000)
    r = client.post(
        "/api/v2/library/import/preview",
        files={"file": ("big.csv", big, "text/csv")},
        data={"user_id": "user-uuid-123456"},
        headers=_good_headers(),
    )
    assert r.status_code == 413


# ─── /preview — XLSX ──────────────────────────────────────────────


def test_preview_xlsx_happy_path(client):
    r = client.post(
        "/api/v2/library/import/preview",
        files={"file": ("test.xlsx", _xlsx_bytes(_VALID_ROWS),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"user_id": "user-uuid-123456"},
        headers=_good_headers(),
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["valid_rows"] == 2
    assert j["rows"][1]["name"] == "Liquid Detergent V2"


# ─── /commit — happy path ─────────────────────────────────────────


def test_commit_inserts_user_id_per_row(client, fake_supabase):
    payload = {
        "user_id": "user-uuid-123456",
        "rows": [
            {"name": "X", "components": [{"name_en": "Water", "percentage": 75}]},
            {"name": "Y", "components": [{"name_en": "SLS",   "percentage": 12}]},
        ],
    }
    r = client.post(
        "/api/v2/library/import/commit",
        json=payload,
        headers=_good_headers(),
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    assert j["inserted"] == 2
    # Both inserted rows carry the user_id from the request, not the row.
    assert all(row["user_id"] == "user-uuid-123456" for row in fake_supabase._inserted)


def test_commit_empty_rows_400(client):
    r = client.post(
        "/api/v2/library/import/commit",
        json={"user_id": "user-uuid-123456", "rows": []},
        headers=_good_headers(),
    )
    assert r.status_code == 400


def test_commit_missing_user_id_400(client):
    r = client.post(
        "/api/v2/library/import/commit",
        json={"user_id": "", "rows": [{"name": "X", "components": [{"name_en": "W", "percentage": 50}]}]},
        headers=_good_headers(),
    )
    assert r.status_code == 400


# ─── _parse_ingredients direct ────────────────────────────────────


def test_parse_ingredients_supports_3_part_and_4_part_items():
    comps, errs = li._parse_ingredients("Water | 75 | 7732-18-5 | solvent ; SLS | 12")
    assert len(comps) == 2
    assert comps[0]["function"] == "solvent"
    assert comps[1]["function"] is None
    assert comps[1]["cas_number"] is None
    assert errs == []


def test_parse_ingredients_skips_unparseable_items_with_message():
    comps, errs = li._parse_ingredients("Water | 75 ; brokenitem ; SLS | 12")
    # Two parsed (Water, SLS), one error (brokenitem has no pipe).
    assert len(comps) == 2
    assert any("brokenitem" in e for e in errs)


def test_parse_tags_handles_csv_in_cell():
    assert li._parse_tags("wip, herbal, R&D") == ["wip", "herbal", "R&D"]
    assert li._parse_tags("") == []
    assert li._parse_tags(None) == []


def test_parse_trust_score_clamps_to_0_100():
    assert li._parse_trust_score("150") == 100
    assert li._parse_trust_score("-5") == 0
    assert li._parse_trust_score("88") == 88
    assert li._parse_trust_score("oops") is None
