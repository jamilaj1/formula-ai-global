"""sync_formula_count.py - refresh the hard-coded formula count site-wide.

The count is baked as plain text into ~27 places across the site (<title>
tags, meta descriptions, schema.org JSON-LD, the formulas-page button,
dashboard copy, etc.). Those are static HTML and would otherwise drift.

This script fixes all of them in one pass. It gets the live count from,
in order:
  1. SUPABASE_SERVICE_KEY in .env at the repo root (direct count; bypasses
     RLS) — used when running locally.
  2. The public `formula_count()` RPC via the anon key in assets/auth.js —
     used in CI. (The `formulas` table is RLS-gated, so a *direct* anon
     count returns 401 — that's why a plain anon count silently failed and
     the number was frozen. The RPC is SECURITY DEFINER so anon can read
     just the count.)

Migration needed once (Supabase SQL editor) for the CI path:
    create or replace function public.formula_count()
    returns integer language sql stable security definer
    set search_path = public as $$ select count(*)::int from public.formulas $$;
    grant execute on function public.formula_count() to anon, authenticated;

Run after every ingestion / backfill, then rebuild + upload:
    python scripts/sync_formula_count.py
    python scripts/build_phase3.py
"""
import glob
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = os.path.join(ROOT, "scripts", "formula_count.txt")
DEFAULT_OLD = 3381
SANITY_FLOOR = 100


def load_env():
    env = {}
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def read_anon_creds():
    auth_js = os.path.join(ROOT, "assets", "auth.js")
    with open(auth_js, "r", encoding="utf-8") as f:
        src = f.read()
    url_m = re.search(r'SUPABASE_URL\s*=\s*"([^"]+)"', src)
    key_m = re.search(r'SUPABASE_ANON\s*=\s*"([^"]+)"', src)
    if not url_m or not key_m:
        print("ERROR: SUPABASE_URL / SUPABASE_ANON not found in assets/auth.js",
              file=sys.stderr)
        sys.exit(2)
    return url_m.group(1).rstrip("/"), key_m.group(1)


def _request(url, key, extra=None, data=None, method=None):
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"apikey": key, "Authorization": "Bearer " + key, **(extra or {})})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.headers.get("Content-Range", ""), resp.read()


def fetch_count():
    env = load_env()
    url = env.get("SUPABASE_URL", "").rstrip("/")
    skey = env.get("SUPABASE_SERVICE_KEY", "")

    # 1) Direct count with the service key (bypasses RLS) — local runs.
    if url and skey:
        try:
            cr, _ = _request(
                url + "/rest/v1/formulas?select=id", skey,
                {"Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"})
            m = re.search(r"/(\d+)\s*$", cr)
            if m:
                return int(m.group(1))
        except Exception as e:  # noqa: BLE001
            print("  note: service-key count failed (", e, ") — trying RPC", file=sys.stderr)

    # 2) Public formula_count() RPC via the anon key — CI path.
    aurl, akey = read_anon_creds()
    try:
        _, body = _request(
            aurl + "/rest/v1/rpc/formula_count", akey,
            {"Content-Type": "application/json"}, data=b"{}", method="POST")
        return int(json.loads(body.decode()))
    except Exception as e:  # noqa: BLE001
        print("ERROR: could not read the formula count.", e, file=sys.stderr)
        print("  Create the formula_count() RPC (see this file's header).", file=sys.stderr)
        sys.exit(2)


def read_old_count():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return DEFAULT_OLD


def save_count(n):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        f.write(str(n))


def main():
    new = fetch_count()
    if new < SANITY_FLOOR:
        print("ERROR: count came back as", new, "- refusing to overwrite. Aborting.",
              file=sys.stderr)
        return 2

    old = read_old_count()
    print("formula count:  old =", old, " new =", new)
    if new == old:
        print("No change. Nothing to update.")
        save_count(new)
        return 0

    old_plain, old_comma = str(old), "{:,}".format(old)
    new_plain, new_comma = str(new), "{:,}".format(new)
    re_comma = re.compile(r"(?<!\d)" + re.escape(old_comma) + r"(?!\d)")
    re_plain = re.compile(r"(?<!\d)" + re.escape(old_plain) + r"(?!\d)")

    paths = sorted(glob.glob(os.path.join(ROOT, "*.html")))
    paths += sorted(glob.glob(os.path.join(ROOT, "industries", "*.html")))

    files_changed, total_hits = 0, 0
    for p in paths:
        with open(p, "r", encoding="utf-8") as f:
            src = f.read()
        updated, n1 = re_comma.subn(new_comma, src)
        updated, n2 = re_plain.subn(new_plain, updated)
        if n1 + n2:
            with open(p, "w", encoding="utf-8") as f:
                f.write(updated)
            files_changed += 1
            total_hits += n1 + n2
            print("  {}: {} replacement(s)".format(os.path.relpath(p, ROOT), n1 + n2))

    save_count(new)
    print("\nDone. {} replacement(s) across {} file(s).".format(total_hits, files_changed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
