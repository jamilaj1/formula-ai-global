"""
daily_health_report.py — daily stats summary.

Pulls counters from Supabase, formats them as a brief, and POSTs to a
Slack/Discord webhook OR prints to stdout (so cron logs capture them).

Useful for:
  - "how many new formulas did the system extract overnight?"
  - "how many users signed up this week?"
  - "any error spikes in api_usage?"

Configure via env:
  HEALTH_REPORT_WEBHOOK   Slack/Discord incoming webhook URL (optional)
  HEALTH_REPORT_RECIPIENT email recipient (if you wire SendGrid/SES later)
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

load_dotenv(BACKEND_DIR.parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
WEBHOOK = os.getenv("HEALTH_REPORT_WEBHOOK", "")


async def _count(client: httpx.AsyncClient, table: str, *,
                 since: str | None = None) -> int:
    """Use PostgREST's Prefer: count=exact to get total rows efficiently."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "count=exact",
    }
    path = f"/rest/v1/{table}?select=id"
    if since:
        path += f"&created_at=gte.{since}"
    try:
        r = await client.head(f"{SUPABASE_URL}{path}", headers=headers, timeout=15.0)
    except Exception:
        return -1
    if not r.is_success:
        return -1
    rng = r.headers.get("content-range", "")
    if "/" in rng:
        tail = rng.split("/")[1]
        if tail.isdigit():
            return int(tail)
    return -1


async def collect_stats() -> dict:
    """Pull yesterday's counts + total counts for each user-visible table."""
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    stats = {"as_of": datetime.now(timezone.utc).isoformat()}
    async with httpx.AsyncClient() as client:
        for table in ("formulas", "profiles", "user_formulas", "uploaded_books",
                      "chat_sessions", "discovery_jobs", "discovered_sources"):
            stats[f"total_{table}"] = await _count(client, table)
            stats[f"new_24h_{table}"] = await _count(client, table, since=yesterday)
    return stats


def format_brief(stats: dict) -> str:
    lines = [
        "Formula AI — daily health report",
        f"as of {stats['as_of']}",
        "",
        f"📚 Total formulas:    {stats.get('total_formulas')}  (+{stats.get('new_24h_formulas')} in 24h)",
        f"👤 Total profiles:    {stats.get('total_profiles')}  (+{stats.get('new_24h_profiles')} in 24h)",
        f"🧪 User-saved:        {stats.get('total_user_formulas')}  (+{stats.get('new_24h_user_formulas')} in 24h)",
        f"📖 Books uploaded:    {stats.get('total_uploaded_books')}  (+{stats.get('new_24h_uploaded_books')} in 24h)",
        f"💬 Chat sessions:     {stats.get('total_chat_sessions')}  (+{stats.get('new_24h_chat_sessions')} in 24h)",
        f"🔍 Discovery jobs:    {stats.get('total_discovery_jobs')}  (+{stats.get('new_24h_discovery_jobs')} in 24h)",
        f"📄 Papers ingested:   {stats.get('total_discovered_sources')}  (+{stats.get('new_24h_discovered_sources')} in 24h)",
    ]
    return "\n".join(lines)


async def post_to_webhook(text: str) -> bool:
    if not WEBHOOK:
        return False
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(WEBHOOK, json={"text": text}, timeout=10.0)
            return r.is_success
        except Exception:
            return False


def main() -> int:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL + SUPABASE_SERVICE_KEY must be set", file=sys.stderr)
        return 2
    stats = asyncio.run(collect_stats())
    brief = format_brief(stats)
    print(brief)
    if WEBHOOK:
        sent = asyncio.run(post_to_webhook(brief))
        print(f"\nWebhook delivery: {'ok' if sent else 'failed'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
