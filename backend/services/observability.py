"""
observability.py — Better Stack (Logtail) integration for FastAPI.

Sends structured JSON logs + exception traces to Better Stack via their
HTTPS ingestion endpoint. Falls back to a no-op when BETTER_STACK_TOKEN
is missing, so local development keeps working without setup.

Wire-up
───────
In main.py, after `app = FastAPI(...)`:

    from services.observability import install_observability
    install_observability(app)

That adds:
  • A request-logging middleware (one log line per request, structured)
  • An exception handler that ships the trace before re-raising
  • Two endpoints:
      GET  /health/detailed  → JSON: uptime, version, env summary
      GET  /metrics/summary  → counters since boot (requests, errors, p50/p95)

Environment
───────────
  BETTER_STACK_TOKEN     — source token from Better Stack (Telemetry → Sources)
  BETTER_STACK_HOST      — optional, default https://in.logs.betterstack.com
  SERVICE_NAME           — optional, default "formula-ai-backend"
  SERVICE_ENV            — optional, default "production"

We POST asynchronously (fire-and-forget) so logging never blocks responses.
"""
from __future__ import annotations

import asyncio
import os
import time
import traceback
from collections import deque
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse


# ─── Configuration ────────────────────────────────────────────────

_TOKEN  = os.getenv("BETTER_STACK_TOKEN", "").strip()
_HOST   = os.getenv("BETTER_STACK_HOST", "https://in.logs.betterstack.com").rstrip("/")
_NAME   = os.getenv("SERVICE_NAME", "formula-ai-backend")
_ENV    = os.getenv("SERVICE_ENV", "production")
_ENABLED = bool(_TOKEN)

# Lightweight in-memory metrics (reset on process restart)
_BOOT_TIME = time.monotonic()
_BOOT_AT = datetime.now(timezone.utc).isoformat(timespec="seconds")
_metrics = {
    "requests_total": 0,
    "errors_total": 0,
    "by_path": {},          # path → {count, errors, latencies(deque)}
}
_LATENCY_WINDOW = 1000      # keep last 1000 per path


# ─── Internal helpers ─────────────────────────────────────────────

async def _ship(record: dict[str, Any]) -> None:
    """POST a single log record to Better Stack. Non-blocking, errors swallowed."""
    if not _ENABLED:
        return
    record.setdefault("dt", datetime.now(timezone.utc).isoformat(timespec="milliseconds"))
    record.setdefault("service", _NAME)
    record.setdefault("env", _ENV)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                _HOST,
                headers={
                    "Authorization": f"Bearer {_TOKEN}",
                    "Content-Type": "application/json",
                },
                json=record,
            )
    except Exception:
        # Never let observability break the request path
        pass


def _record_latency(path: str, ms: float, errored: bool) -> None:
    p = _metrics["by_path"].setdefault(
        path, {"count": 0, "errors": 0, "latencies": deque(maxlen=_LATENCY_WINDOW)}
    )
    p["count"] += 1
    if errored:
        p["errors"] += 1
    p["latencies"].append(ms)


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round((q / 100.0) * (len(s) - 1)))))
    return round(s[k], 2)


# ─── Security helpers ─────────────────────────────────────────────


def _check_admin(key_query: str | None, key_header: str | None) -> None:
    """Raise 401/503 unless the caller passes the right ADMIN_API_KEY.

    Mirrors app/api/admin/backfill.py so the admin surface is uniform.
    When ADMIN_API_KEY is unset the protected endpoints return 503 so
    the metrics surface is never world-readable by default.
    """
    expected = os.getenv("ADMIN_API_KEY", "")
    if not expected:
        raise HTTPException(
            503,
            detail={
                "error": "admin_not_configured",
                "detail": "Set ADMIN_API_KEY to enable metrics/observability endpoints.",
            },
        )
    presented = key_header or key_query or ""
    # Constant-time compare to avoid timing oracles on the admin key.
    import hmac
    if not hmac.compare_digest(presented, expected):
        raise HTTPException(401, detail={"error": "invalid_admin_key"})


def _anonymize_ip(ip: str) -> str:
    """GDPR-friendly IP truncation before shipping to a 3rd-party logger.

    IPv4  → zero the last octet      (203.0.113.42  → 203.0.113.0)
    IPv6  → keep only the /48 prefix (2001:db8:1:2::1 → 2001:db8:1::)
    Anything unparseable returns "" so we never ship a raw address.
    """
    if not ip:
        return ""
    try:
        if ":" in ip:  # IPv6
            import ipaddress
            net = ipaddress.ip_network(f"{ip}/48", strict=False)
            return str(net.network_address)
        parts = ip.split(".")
        if len(parts) == 4:
            return ".".join(parts[:3] + ["0"])
        return ""
    except Exception:
        return ""


# ─── Public API ───────────────────────────────────────────────────


def install_observability(app: FastAPI) -> None:
    """Attach middleware, exception handlers, and observability endpoints."""

    @app.middleware("http")
    async def _request_logger(request: Request, call_next):
        start = time.monotonic()
        status = 500
        errored = False
        path = request.url.path

        try:
            response = await call_next(request)
            status = response.status_code
            errored = status >= 500
            return response
        except Exception as exc:
            errored = True
            _metrics["errors_total"] += 1
            asyncio.create_task(_ship({
                "level": "error",
                "message": f"Unhandled exception on {request.method} {path}",
                "method": request.method,
                "path": path,
                "exception": str(exc),
                "traceback": traceback.format_exc(),
            }))
            return JSONResponse(
                {"error": "internal_error", "detail": "Unhandled server exception"},
                status_code=500,
            )
        finally:
            elapsed_ms = (time.monotonic() - start) * 1000.0
            _metrics["requests_total"] += 1
            _record_latency(path, elapsed_ms, errored)
            # Only ship non-noisy request logs (skip health pings & 2xx on /health*)
            should_ship = errored or status >= 400 or not path.startswith("/health")
            if should_ship:
                # GDPR: never ship a raw client IP to the 3rd-party logger.
                raw_ip = request.client.host if request.client else ""
                asyncio.create_task(_ship({
                    "level": "error" if errored else ("warning" if status >= 400 else "info"),
                    "message": f"{request.method} {path} → {status}",
                    "method": request.method,
                    "path": path,
                    "status": status,
                    "duration_ms": round(elapsed_ms, 2),
                    "user_agent": request.headers.get("user-agent", ""),
                    "ip_prefix": _anonymize_ip(raw_ip),
                }))

    @app.get("/health/detailed", include_in_schema=False)
    async def _health_detailed(
        key: str | None = Query(None, description="Admin API key (optional)"),
        x_admin_key: str | None = Header(None),
    ):
        """Public response is intentionally minimal so uptime monitors can
        poll it freely without leaking internals. Pass the admin key to
        get the full diagnostic payload (env, version, counters)."""
        uptime_s = time.monotonic() - _BOOT_TIME
        public = {
            "status": "ok",
            "service": _NAME,
            "uptime_seconds": round(uptime_s, 1),
        }
        # Full detail only for authenticated admins.
        try:
            _check_admin(key, x_admin_key)
        except HTTPException:
            return public
        public.update({
            "env": _ENV,
            "version": app.version,
            "boot_at": _BOOT_AT,
            "uptime_human": _human_duration(uptime_s),
            "observability_enabled": _ENABLED,
            "requests_total": _metrics["requests_total"],
            "errors_total": _metrics["errors_total"],
        })
        return public

    @app.get("/metrics/summary", include_in_schema=False)
    async def _metrics_summary(
        key: str | None = Query(None, description="Admin API key (required)"),
        x_admin_key: str | None = Header(None),
    ):
        """Internal topology + traffic. Admin-only: an open metrics
        endpoint hands an attacker a map of every route, its error rate
        and latency profile."""
        _check_admin(key, x_admin_key)  # raises 401/503 if not authorized
        by_path = {}
        for path, p in _metrics["by_path"].items():
            lat = list(p["latencies"])
            by_path[path] = {
                "count": p["count"],
                "errors": p["errors"],
                "error_rate": round(p["errors"] / p["count"], 4) if p["count"] else 0,
                "p50_ms": _percentile(lat, 50),
                "p95_ms": _percentile(lat, 95),
                "p99_ms": _percentile(lat, 99),
            }
        return {
            "boot_at": _BOOT_AT,
            "uptime_seconds": round(time.monotonic() - _BOOT_TIME, 1),
            "requests_total": _metrics["requests_total"],
            "errors_total": _metrics["errors_total"],
            "by_path": by_path,
        }

    # Ship a "service started" event on boot (if enabled)
    if _ENABLED:
        @app.on_event("startup")
        async def _on_boot():
            with suppress(Exception):
                await _ship({
                    "level": "info",
                    "message": f"{_NAME} started",
                    "version": app.version,
                })


def _human_duration(s: float) -> str:
    s = int(s)
    d, s = divmod(s, 86400)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    parts = []
    if d: parts.append(f"{d}d")
    if h: parts.append(f"{h}h")
    if m: parts.append(f"{m}m")
    parts.append(f"{s}s")
    return " ".join(parts)


# Allow other modules to ship custom events without circular imports
async def log_event(level: str, message: str, **kwargs: Any) -> None:
    """Ship a custom structured event to Better Stack."""
    await _ship({"level": level, "message": message, **kwargs})
