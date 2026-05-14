"""
Admin: PubChem + RDKit backfill on the Render server.

Endpoints (under /api/admin):
  POST /backfill/start   kick off enrichment in a background task
  GET  /backfill/status  poll progress
  POST /backfill/cancel  request a cancel (cooperative; takes effect on the
                         next component iteration)

All admin routes require a strong key in `?key=...` or `X-Admin-Key:` header.
The key is read from env var ADMIN_API_KEY. If the env var is missing the
endpoints return 503 (not configured) so the admin surface is never open
by default.

The backfill itself is the same logic as `tools/backfill_smiles.py` —
inlined here so we don't have to import a __main__-style script. It is
resume-safe: components that already have a `chem.smiles` value are
skipped (unless `?refresh=true`).
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Header, HTTPException, Query

from services.chemistry import compute_properties
from services.pubchem import RATE_LIMIT_DELAY, lookup_by_cas, lookup_by_name

router = APIRouter(prefix="/admin", tags=["admin"])


# ─── Module-global progress (single-instance only) ────────────────


_state: dict[str, Any] = {
    "status": "idle",       # idle | running | done | error | cancelled
    "started_at": None,
    "finished_at": None,
    "limit": None,
    "refresh": False,
    "formulas_total": 0,
    "formulas_done": 0,
    "components_total": 0,
    "components_done": 0,
    "components_found": 0,
    "components_missing": 0,
    "errors": 0,
    "current_formula": None,
    "cancel_requested": False,
    "last_error": None,
}
_lock = asyncio.Lock()


# ─── Auth helpers ─────────────────────────────────────────────────


def _expected_key() -> str:
    return os.getenv("ADMIN_API_KEY", "")


def _check_key(key_query: str | None, key_header: str | None) -> None:
    """Raise 401/503 if the caller didn't pass the right admin key."""
    expected = _expected_key()
    if not expected:
        raise HTTPException(
            503,
            detail={
                "error": "admin_not_configured",
                "detail": "Set ADMIN_API_KEY env var on Render to enable admin endpoints.",
            },
        )
    presented = key_header or key_query or ""
    if presented != expected:
        raise HTTPException(401, detail={"error": "invalid_admin_key"})


# ─── Backfill worker ──────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def _list_formulas(
    client: httpx.AsyncClient,
    supabase_url: str,
    service_key: str,
    *,
    limit: int | None,
    refresh: bool,
) -> list[dict[str, Any]]:
    headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
    path = "/rest/v1/formulas?select=id,name,name_en,components&order=id.asc"
    if limit:
        path += f"&limit={limit}"
    r = await client.get(f"{supabase_url}{path}", headers=headers, timeout=30.0)
    r.raise_for_status()
    rows = r.json()
    if refresh:
        return rows
    return [
        row for row in rows
        if any(not (c.get("chem") and (c["chem"] or {}).get("smiles"))
               for c in (row.get("components") or []))
    ]


async def _enrich_component(
    client: httpx.AsyncClient,
    comp: dict[str, Any],
    *,
    refresh: bool,
) -> dict[str, Any]:
    if not refresh and comp.get("chem") and (comp["chem"] or {}).get("smiles"):
        return comp

    name = (comp.get("name_en") or comp.get("name") or "").strip()
    cas = (comp.get("cas_number") or "").strip()

    pc = None
    if cas:
        try:
            pc = await lookup_by_cas(client, cas)
        except Exception:
            pc = None
    if (not pc or not pc.get("found")) and name:
        try:
            pc = await lookup_by_name(client, name)
        except Exception:
            pc = None

    if not pc or not pc.get("found"):
        comp["chem"] = {
            "found": False,
            "smiles": None,
            "looked_up_at": _now_iso(),
            "source": "pubchem",
        }
        return comp

    smiles = pc.get("smiles")
    props = compute_properties(smiles) if smiles else {"valid": False}

    comp["chem"] = {
        "found": True,
        "cid": pc.get("cid"),
        "smiles": smiles,
        "smiles_isomeric": pc.get("smiles_isomeric"),
        "inchi": pc.get("inchi"),
        "inchi_key": pc.get("inchi_key"),
        "formula": pc.get("formula"),
        "molecular_weight": props.get("molecular_weight"),
        "logp": props.get("logp"),
        "tpsa": props.get("tpsa"),
        "h_bond_donors": props.get("h_bond_donors"),
        "h_bond_acceptors": props.get("h_bond_acceptors"),
        "lipinski_violations": props.get("lipinski_violations"),
        "iupac_name": pc.get("iupac_name"),
        "source": "pubchem",
        "source_url": pc.get("source_url"),
        "looked_up_at": _now_iso(),
    }
    return comp


async def _patch_formula(
    client: httpx.AsyncClient,
    supabase_url: str,
    service_key: str,
    formula_id: str,
    components: list[dict[str, Any]],
) -> bool:
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    r = await client.patch(
        f"{supabase_url}/rest/v1/formulas?id=eq.{formula_id}",
        headers=headers,
        json={
            "components": components,
            "chemistry_enriched_at": _now_iso(),
        },
        timeout=30.0,
    )
    return r.status_code in (200, 204)


async def _run_backfill(*, limit: int | None, refresh: bool) -> None:
    """The actual long-running task. Updates _state as it goes."""
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not supabase_url or not service_key:
        async with _lock:
            _state["status"] = "error"
            _state["last_error"] = "SUPABASE_URL / SUPABASE_SERVICE_KEY missing"
            _state["finished_at"] = _now_iso()
        return

    async with _lock:
        _state.update({
            "status": "running",
            "started_at": _now_iso(),
            "finished_at": None,
            "limit": limit,
            "refresh": refresh,
            "formulas_total": 0,
            "formulas_done": 0,
            "components_total": 0,
            "components_done": 0,
            "components_found": 0,
            "components_missing": 0,
            "errors": 0,
            "current_formula": None,
            "cancel_requested": False,
            "last_error": None,
        })

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            formulas = await _list_formulas(
                client, supabase_url, service_key, limit=limit, refresh=refresh
            )
            total_comps = sum(len(f.get("components") or []) for f in formulas)
            async with _lock:
                _state["formulas_total"] = len(formulas)
                _state["components_total"] = total_comps

            for i, f in enumerate(formulas, start=1):
                async with _lock:
                    if _state["cancel_requested"]:
                        _state["status"] = "cancelled"
                        _state["finished_at"] = _now_iso()
                        return
                    _state["current_formula"] = (
                        f.get("name_en") or f.get("name") or str(f.get("id"))
                    )

                new_components = []
                for comp in f.get("components") or []:
                    try:
                        enriched = await _enrich_component(client, comp, refresh=refresh)
                    except Exception as e:
                        enriched = comp
                        async with _lock:
                            _state["errors"] += 1
                            _state["last_error"] = str(e)[:200]
                    async with _lock:
                        _state["components_done"] += 1
                        if (enriched.get("chem") or {}).get("found"):
                            _state["components_found"] += 1
                        else:
                            _state["components_missing"] += 1
                    new_components.append(enriched)
                    await asyncio.sleep(RATE_LIMIT_DELAY)

                ok = await _patch_formula(
                    client, supabase_url, service_key, f["id"], new_components
                )
                async with _lock:
                    _state["formulas_done"] += 1
                    if not ok:
                        _state["errors"] += 1

        async with _lock:
            _state["status"] = "done"
            _state["finished_at"] = _now_iso()
            _state["current_formula"] = None
    except Exception as e:
        async with _lock:
            _state["status"] = "error"
            _state["last_error"] = str(e)[:500]
            _state["finished_at"] = _now_iso()


# ─── HTTP endpoints ───────────────────────────────────────────────


@router.post("/backfill/start")
async def start_backfill(
    limit: int | None = Query(None, ge=1, le=10000,
                              description="Optional: cap how many formulas to process"),
    refresh: bool = Query(False,
                          description="If true, re-fetch even already-enriched components"),
    key: str | None = Query(None, description="Admin API key"),
    x_admin_key: str | None = Header(None),
) -> dict[str, Any]:
    """
    Kick off a backfill in the background. Returns immediately.

    The actual work runs asynchronously; poll `/admin/backfill/status` for
    progress. Only one backfill can be in flight at a time — calling
    `/start` while another is `running` returns 409.
    """
    _check_key(key, x_admin_key)

    async with _lock:
        if _state["status"] == "running":
            raise HTTPException(409, detail={
                "error": "backfill_already_running",
                "started_at": _state["started_at"],
                "formulas_done": _state["formulas_done"],
            })

    # Fire-and-forget background task
    asyncio.create_task(_run_backfill(limit=limit, refresh=refresh))

    return {
        "ok": True,
        "message": "Backfill started in background.",
        "limit": limit,
        "refresh": refresh,
        "poll_at": "/api/admin/backfill/status",
    }


@router.get("/backfill/status")
async def backfill_status(
    key: str | None = Query(None),
    x_admin_key: str | None = Header(None),
) -> dict[str, Any]:
    """
    Current state of the most recent backfill. Safe to poll every few
    seconds — it's an in-memory read with no DB access.
    """
    _check_key(key, x_admin_key)
    async with _lock:
        snapshot = dict(_state)
    # Derived progress fields
    if snapshot["components_total"]:
        snapshot["progress_pct"] = round(
            100 * snapshot["components_done"] / snapshot["components_total"], 1
        )
    else:
        snapshot["progress_pct"] = 0.0
    return snapshot


@router.post("/backfill/cancel")
async def cancel_backfill(
    key: str | None = Query(None),
    x_admin_key: str | None = Header(None),
) -> dict[str, Any]:
    """
    Cooperative cancel. The running task checks `cancel_requested` once
    per formula and stops cleanly. May take up to ~5 seconds to take effect.
    """
    _check_key(key, x_admin_key)
    async with _lock:
        if _state["status"] != "running":
            return {"ok": True, "no_op": True, "status": _state["status"]}
        _state["cancel_requested"] = True
    return {"ok": True, "message": "Cancel requested; backfill will stop after current formula."}
