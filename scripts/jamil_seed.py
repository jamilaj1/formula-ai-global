#!/usr/bin/env python3
"""
jamil_seed.py — One-shot Excel → Supabase formula seeder.
==========================================================
WHAT IT DOES
  Reads "ALL MY-FORMULAS-TEMPLATE-V2.xlsx" (in the same folder), converts
  every formula into the schema your Supabase 'formulas' table expects,
  and inserts them in batches.

USAGE
  1) Save this file as `jamil_seed.py` on your Desktop.
  2) Put the Excel file `ALL MY-FORMULAS-TEMPLATE-V2.xlsx` in the SAME folder.
  3) Edit the two values below (SUPABASE_URL and SUPABASE_KEY).
  4) Open PowerShell and run:
        cd C:\\Users\\JAMIL\\Desktop
        pip install pandas openpyxl supabase
        python jamil_seed.py --dry-run
        python jamil_seed.py
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ─── EDIT THESE TWO LINES ────────────────────────────────────────────────────
SUPABASE_URL = "https://ivabcssceeaqgqjzgmdx.supabase.co"
SUPABASE_KEY = "PASTE_YOUR_service_role_KEY_HERE"   # from Supabase → Settings → API
# ─────────────────────────────────────────────────────────────────────────────

XLSX_NAME = "ALL MY-FORMULAS-TEMPLATE-V2.xlsx"
BATCH_SIZE = 100          # how many rows per insert call
PERCENTAGE_TOLERANCE = 1.0
WATER_PATCH_THRESHOLD = 50.0
TRUST_SCORE_DEFAULT = 88

CATEGORY_MAP = {
    "haircare":"hair_care","hair-care":"hair_care","skincare":"skin_care","skin-care":"skin_care",
    "skincare-acne":"skin_care","face-care":"skin_care","bodycare":"body_care","body-care":"body_care",
    "handcare":"body_care","hand-care":"body_care","personal-care":"personal_hygiene",
    "mens-grooming":"personal_hygiene","deodorant":"personal_hygiene","nail-care":"color_cosmetics",
    "eye-makeup":"color_cosmetics","cosmetic":"color_cosmetics","fragrance":"color_cosmetics",
    "sun-care":"skin_care","sunscreen":"skin_care","soap":"personal_hygiene","cleansing":"personal_hygiene",
    "cleaning":"cleaning","industrial-cleaning":"cleaning","laundry":"laundry","disinfectant":"disinfectants",
    "antibacterial":"disinfectants","medical":"specialty","industrial":"industrial","construction":"industrial",
    "textile":"industrial","automotive":"automotive","agricultural":"agriculture","agriculture":"agriculture",
    "aerosol":"specialty","petcare":"pet_care","pet-care":"pet_care","food":"food_beverage",
    "beverage":"food_beverage","food-beverage":"food_beverage","adhesive":"adhesives","adhesives":"adhesives",
    "coating":"coatings","coatings":"coatings",
}

FORM_PATTERNS = [
    (r"\b(cream|lotion|moisturizer)\b","cream"),(r"\b(serum|essence|oil|toner)\b","liquid"),
    (r"\b(gel|hydrogel)\b","gel"),(r"\b(shampoo|body wash|cleanser)\b","liquid"),
    (r"\b(soap|bar|stick)\b","solid_bar"),(r"\b(spray|aerosol|mist)\b","spray"),
    (r"\b(powder|granular|granule)\b","powder"),(r"\b(tablet|tab|capsule)\b","tablet"),
    (r"\b(foam|mousse)\b","foam"),(r"\b(paste|wax|balm)\b","paste"),
    (r"\b(detergent|liquid)\b","liquid"),
]

CAS_RX = re.compile(r"^\d{2,7}-\d{2}-\d$")


def import_pandas():
    try:
        import pandas as pd
        return pd
    except ImportError:
        sys.exit("Missing pandas. Run: pip install pandas openpyxl")


def import_supabase():
    try:
        from supabase import create_client
        return create_client
    except ImportError:
        sys.exit("Missing supabase. Run: pip install supabase")


def normalise_category(raw):
    pd = import_pandas()
    if not raw or pd.isna(raw):
        return "specialty"
    k = str(raw).strip().lower()
    return CATEGORY_MAP.get(k, k.replace("-", "_").replace(" ", "_"))


def guess_form(name, default="liquid"):
    n = (name or "").lower()
    for pat, form in FORM_PATTERNS:
        if re.search(pat, n):
            return form
    return default


def parse_pct(v):
    pd = import_pandas()
    if v is None or pd.isna(v):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().rstrip("%").strip()
    if not s or s.lower() in ("qs", "q.s.", "q.s", "qsp"):
        return None
    if "-" in s:
        try:
            lo, hi = s.split("-", 1)
            return (float(lo) + float(hi)) / 2
        except ValueError:
            pass
    try:
        return float(s)
    except ValueError:
        return None


def clean_str(v):
    pd = import_pandas()
    if v is None or pd.isna(v):
        return None
    s = str(v).strip()
    return s or None


def clean_cas(v):
    s = clean_str(v)
    if not s:
        return None
    s = s.replace(" ", "")
    return s if CAS_RX.match(s) else None


def first_text(series):
    for v in series.dropna():
        s = str(v).strip()
        if s:
            return s
    return None


def split_variants(group):
    pd = import_pandas()
    variants = []
    cur = []
    running = 0.0
    for idx, row in group.iterrows():
        pct = parse_pct(row.get("percentage")) or 0.0
        if running > PERCENTAGE_TOLERANCE and running + pct > 100.0 + PERCENTAGE_TOLERANCE:
            if cur:
                variants.append(group.loc[cur])
            cur = []
            running = 0.0
        cur.append(idx)
        running += pct
    if cur:
        variants.append(group.loc[cur])
    return variants if variants else [group]


def convert_formula(name, group):
    pd = import_pandas()
    components = []
    for _, row in group.iterrows():
        ing = clean_str(row.get("ingredient"))
        if not ing:
            continue
        pct = parse_pct(row.get("percentage"))
        if pct is None:
            continue
        components.append({
            "name_en": ing,
            "cas_number": clean_cas(row.get("cas_number")),
            "percentage": pct,
            "function": clean_str(row.get("function")) or "other",
            "phase": clean_str(row.get("phase")),
        })
    if not components:
        return None

    total = sum(c["percentage"] for c in components)

    # multi-part?
    multi = 1
    detected = False
    for n in (2, 3, 4):
        if abs(total - n*100) <= n*PERCENTAGE_TOLERANCE:
            phase_totals = defaultdict(float)
            unphased = 0.0
            for c in components:
                if c.get("phase"):
                    phase_totals[c["phase"]] += c["percentage"]
                else:
                    unphased += c["percentage"]
            ok = bool(phase_totals) and all(abs(s - 100.0) <= PERCENTAGE_TOLERANCE for s in phase_totals.values())
            if ok or unphased > 0:
                components = [{**c, "percentage": round(c["percentage"]/n, 3)} for c in components]
                multi = n
                detected = True
                break

    total = sum(c["percentage"] for c in components)
    if not detected:
        if total < 99.0 - PERCENTAGE_TOLERANCE and total >= WATER_PATCH_THRESHOLD:
            components.append({
                "name_en": "Water (q.s. to 100%)", "cas_number": "7732-18-5",
                "percentage": round(100.0 - total, 3), "function": "solvent", "phase": None,
            })
            total = 100.0
        if abs(total - 100.0) > PERCENTAGE_TOLERANCE:
            return None

    procedure = first_text(group["procedure"])
    raw_cat   = first_text(group["category"])

    return {
        "name":              name,
        "name_en":           name,
        "category":          normalise_category(raw_cat),
        "sub_category":      (raw_cat or "").lower().replace(" ", "_") or None,
        "form_type":         guess_form(name),
        "components":        components,
        "process_conditions": {"order_of_addition": procedure},
        "final_properties":  {},
        "safety_warnings":   [],
        "source_type":       "private_library",
        "source_title":      "Jamil Abduljaleel — Personal Formula Library v2",
        "source_author":     "Jamil Abduljaleel",
        "source_year":       datetime.now(timezone.utc).year,
        "trust_score":       TRUST_SCORE_DEFAULT,
        "is_complete":       True,
        "language":          "en",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Validate without writing to DB")
    args = ap.parse_args()

    pd = import_pandas()
    create_client = import_supabase() if not args.dry_run else None

    here = Path(__file__).parent
    xlsx = here / XLSX_NAME
    if not xlsx.exists():
        sys.exit(f"ERROR: {xlsx} not found. Put the Excel file next to this script.")

    print(f"[info] reading {xlsx.name}")
    df = pd.read_excel(xlsx, sheet_name="Formulas")
    cols = ["formula_name","category","phase","ingredient","cas_number","percentage","function","procedure","notes"]
    df.columns = cols[:len(df.columns)]
    if str(df.iloc[0]["formula_name"]).strip().lower() == "formula_name":
        df = df.iloc[1:].reset_index(drop=True)
    df = df[df["formula_name"].notna()]
    print(f"[info] {len(df)} rows · {df['formula_name'].nunique()} unique formula names")

    # Convert
    rows = []
    rejected = 0
    for name, group in df.groupby("formula_name", sort=False):
        for v_idx, vg in enumerate(split_variants(group), 1):
            n = str(name).strip()
            variants = split_variants(group)
            if len(variants) > 1:
                n = f"{n} (Variant #{v_idx})"
            f = convert_formula(n, vg)
            if f:
                rows.append(f)
            else:
                rejected += 1

    print(f"[info] converted {len(rows)} formulas, rejected {rejected}")

    if args.dry_run:
        print(f"\n=== DRY-RUN COMPLETE ===\n  ready to insert: {len(rows)}\n  rejected:        {rejected}")
        print("Re-run without --dry-run to actually upload.")
        return

    if SUPABASE_KEY == "PASTE_YOUR_service_role_KEY_HERE":
        sys.exit("ERROR: edit the SUPABASE_KEY at the top of this script first.")

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    print(f"[info] connecting to {SUPABASE_URL}")

    inserted = 0
    failed   = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i+BATCH_SIZE]
        try:
            sb.table("formulas").insert(batch).execute()
            inserted += len(batch)
            print(f"  batch {i//BATCH_SIZE + 1}: +{len(batch)}  (running total: {inserted})")
        except Exception as e:
            failed += len(batch)
            print(f"  batch {i//BATCH_SIZE + 1}: FAILED — {e}")

    print(f"\n=== DONE ===")
    print(f"  inserted: {inserted}")
    print(f"  failed:   {failed}")
    print(f"  rejected: {rejected}")


if __name__ == "__main__":
    main()
