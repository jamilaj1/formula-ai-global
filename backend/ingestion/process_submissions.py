"""
process_submissions.py — owner tool: structure community uploads.

Reads `user_submissions` rows still 'pending', asks Claude (haiku) to
extract a structured formula, writes it back into `parsed` and flips
review_status to 'processing' (owner then verifies/corrects/rejects via
the user_submissions_queue view). Nothing reaches the public set until
the owner explicitly verifies — same trust discipline as everything
else we built.

Scope (honest, v1): handles pasted text and text/csv attachments
(stored in raw_text). xlsx attachments arrive as base64 in file_b64;
those are flagged in review_notes so the owner runs the proven
excel_formula_ingestor on them instead — we do not silently half-parse
binary spreadsheets here.

Usage
─────
    cd backend
    python -m ingestion.process_submissions --limit 20 --dry-run
    python -m ingestion.process_submissions
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import anthropic
import httpx
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR.parent / ".env", override=True)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
CLAUDE_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")
CALL_DELAY = float(os.getenv("FB_EXTRACT_DELAY", "0.4"))

_claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))

SYSTEM = (
    "You are a senior industrial-chemistry analyst. You read informal "
    "community-submitted formula text (Arabic or English) and extract "
    "structured data. Never invent values. Missing => null. Reply with "
    "ONE valid JSON object only."
)
INSTR = """\
Extract this exact JSON from the submission below:
{ "is_formulation": bool,
  "product_type": str|null, "title": str|null,
  "ingredients": [ {"name":str,"name_en":str|null,
                    "percent":number|null,"function":str|null} ],
  "procedure": str|null,
  "outcome": "success"|"failure"|"partial"|"unknown",
  "failure_reason": str|null, "fix": str|null,
  "owner_notes": str|null, "confidence": number }
Rules: keep Arabic as Arabic; outcome=unknown unless stated; capture
failure_reason/fix when the text explains a problem and its solution;
output ONLY the JSON.

SUBMISSION (title: {title}):
---
{body}
---
"""


def _h(write: bool = False) -> dict:
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    if write:
        h["Content-Type"] = "application/json"
        h["Prefer"] = "return=minimal"
    return h


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _extract(title: str, body: str) -> dict | None:
    prompt = INSTR.replace("{title}", title[:120]).replace("{body}", body[:6000])
    try:
        m = _claude.messages.create(
            model=CLAUDE_MODEL, max_tokens=2000, system=SYSTEM,
            messages=[{"role": "user", "content": prompt}])
        out = m.content[0].text.strip()
    except Exception as e:
        print(f"  claude error: {e}", file=sys.stderr)
        return None
    if "```" in out:
        out = out.split("```")[1].lstrip("json").strip()
    a, b = out.find("{"), out.rfind("}")
    if a == -1 or b == -1:
        return None
    try:
        return json.loads(out[a:b + 1])
    except json.JSONDecodeError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("FATAL: Supabase env missing", file=sys.stderr)
        return 2
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("FATAL: ANTHROPIC_API_KEY missing", file=sys.stderr)
        return 2

    rng = f"0-{(args.limit or 1000) - 1}"
    with httpx.Client() as client:
        r = client.get(
            f"{SUPABASE_URL}/rest/v1/user_submissions"
            "?select=id,title,raw_text,file_b64,file_name,mode"
            "&review_status=eq.pending&order=created_at.asc",
            headers={**_h(), "Range": rng}, timeout=30.0)
        if r.status_code not in (200, 206):
            print(f"FATAL fetch {r.status_code}: {r.text[:200]}", file=sys.stderr)
            return 2
        subs = r.json()
        print(f"[subs] {len(subs)} pending submission(s)")
        st = {"parsed": 0, "flagged_xlsx": 0, "fail": 0, "noise": 0}

        for i, s in enumerate(subs, 1):
            body = (s.get("raw_text") or "").strip()
            if not body and s.get("file_b64"):
                # binary xlsx attachment — defer to the proven excel tool
                st["flagged_xlsx"] += 1
                if not args.dry_run:
                    client.patch(
                        f"{SUPABASE_URL}/rest/v1/user_submissions?id=eq.{s['id']}",
                        headers=_h(write=True),
                        json={"review_notes": "xlsx attachment — run "
                              "excel_formula_ingestor on the decoded file",
                              "processed_at": _now()},
                        timeout=30.0)
                print(f"  [{i}/{len(subs)}] {s.get('title','?')[:40]} -> xlsx flagged")
                continue
            if len(body) < 12:
                st["noise"] += 1
                continue

            k = _extract(s.get("title") or "", body)
            time.sleep(CALL_DELAY)
            if k is None:
                st["fail"] += 1
                print(f"  [{i}/{len(subs)}] parse-fail", file=sys.stderr)
                continue

            if args.dry_run:
                st["parsed"] += 1
                if st["parsed"] <= 3:
                    print(json.dumps(k, ensure_ascii=False, indent=2)[:500])
                continue

            ok = client.patch(
                f"{SUPABASE_URL}/rest/v1/user_submissions?id=eq.{s['id']}",
                headers=_h(write=True),
                json={"parsed": k, "confidence": k.get("confidence"),
                      "extracted_model": CLAUDE_MODEL,
                      "processed_at": _now(),
                      "review_status": "processing"},
                timeout=30.0)
            if ok.status_code in (200, 204):
                st["parsed"] += 1
            else:
                st["fail"] += 1
                print(f"  [{i}] write-fail {ok.status_code}", file=sys.stderr)

    print("\n[subs] done")
    for k, v in st.items():
        print(f"  {k:12}: {v}")
    if args.dry_run:
        print("\n  DRY RUN — nothing written.")
    else:
        print("\n  Review queue: SELECT * FROM user_submissions_queue;"
              "\n  Approve: UPDATE user_submissions SET review_status='verified'"
              " WHERE id='<uuid>';")
    return 0


if __name__ == "__main__":
    sys.exit(main())
