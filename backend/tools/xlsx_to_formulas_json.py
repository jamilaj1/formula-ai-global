#!/usr/bin/env python3
"""
xlsx_to_formulas_json.py — Convert Jamil's Excel template into formulas_seed.json schema.

USAGE
-----
    python xlsx_to_formulas_json.py <input.xlsx> [--out formulas_jamil.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd


# ─── Tunables ─────────────────────────────────────────────────────────────────

PERCENTAGE_TOLERANCE = 1.0
WATER_PATCH_THRESHOLD = 50.0
TRUST_SCORE_DEFAULT = 88


# ─── Category normalisation ───────────────────────────────────────────────────

CATEGORY_MAP: Dict[str, str] = {
    "haircare":            "hair_care",
    "hair-care":           "hair_care",
    "skincare":            "skin_care",
    "skin-care":           "skin_care",
    "skincare-acne":       "skin_care",
    "face-care":           "skin_care",
    "bodycare":            "body_care",
    "body-care":           "body_care",
    "handcare":            "body_care",
    "hand-care":           "body_care",
    "personal-care":       "personal_hygiene",
    "mens-grooming":       "personal_hygiene",
    "deodorant":           "personal_hygiene",
    "nail-care":           "color_cosmetics",
    "eye-makeup":          "color_cosmetics",
    "cosmetic":            "color_cosmetics",
    "fragrance":           "color_cosmetics",
    "sun-care":            "skin_care",
    "sunscreen":           "skin_care",
    "soap":                "personal_hygiene",
    "cleansing":           "personal_hygiene",
    "cleaning":            "cleaning",
    "industrial-cleaning": "cleaning",
    "laundry":             "laundry",
    "disinfectant":        "disinfectants",
    "antibacterial":       "disinfectants",
    "medical":             "specialty",
    "industrial":          "industrial",
    "construction":        "industrial",
    "textile":             "industrial",
    "automotive":          "automotive",
    "agricultural":        "agriculture",
    "agriculture":         "agriculture",
    "aerosol":             "specialty",
    "petcare":             "pet_care",
    "pet-care":            "pet_care",
    "food":                "food_beverage",
    "beverage":            "food_beverage",
    "food-beverage":       "food_beverage",
    "adhesive":            "adhesives",
    "adhesives":           "adhesives",
    "coating":             "coatings",
    "coatings":            "coatings",
}


def normalise_category(raw: Optional[str]) -> str:
    if not raw or pd.isna(raw):
        return "specialty"
    key = str(raw).strip().lower()
    return CATEGORY_MAP.get(key, key.replace("-", "_").replace(" ", "_"))


# ─── Form type heuristic ──────────────────────────────────────────────────────

FORM_TYPE_PATTERNS: List[Tuple[str, str]] = [
    (r"\b(cream|lotion|moisturizer)\b",   "cream"),
    (r"\b(serum|essence|oil|toner)\b",    "liquid"),
    (r"\b(gel|hydrogel)\b",               "gel"),
    (r"\b(shampoo|body wash|cleanser)\b", "liquid"),
    (r"\b(soap|bar|stick)\b",             "solid_bar"),
    (r"\b(spray|aerosol|mist)\b",         "spray"),
    (r"\b(powder|granular|granule)\b",    "powder"),
    (r"\b(tablet|tab|capsule)\b",         "tablet"),
    (r"\b(foam|mousse)\b",                "foam"),
    (r"\b(paste|wax|balm)\b",             "paste"),
    (r"\b(detergent|liquid)\b",           "liquid"),
]


def guess_form_type(name: str, default: str = "liquid") -> str:
    n = (name or "").lower()
    for pattern, form in FORM_TYPE_PATTERNS:
        if re.search(pattern, n):
            return form
    return default


# ─── Helpers ──────────────────────────────────────────────────────────────────

CAS_REGEX = re.compile(r"^\d{2,7}-\d{2}-\d$")


def parse_percentage(val: Any) -> Optional[float]:
    if val is None or pd.isna(val):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().rstrip("%").strip()
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


def first_text(series: pd.Series) -> Optional[str]:
    for v in series.dropna():
        s = str(v).strip()
        if s:
            return s
    return None


def make_id(seq: int) -> str:
    year = datetime.now(timezone.utc).year
    return f"FA-{year}-X{seq:05d}"


def clean_str(val: Any) -> Optional[str]:
    if val is None or pd.isna(val):
        return None
    s = str(val).strip()
    return s or None


def clean_cas(val: Any) -> Optional[str]:
    s = clean_str(val)
    if not s:
        return None
    s = s.replace(" ", "")
    return s if CAS_REGEX.match(s) else None


# ─── Variant splitting ────────────────────────────────────────────────────────

def split_into_variants(group: pd.DataFrame) -> List[pd.DataFrame]:
    """
    Walk rows in order; whenever the cumulative percentage hits ~100%, cut and
    start a new variant. This handles Excel rows that share a formula_name but
    actually hold N independent recipes (each summing to 100%).

    Returns a list of DataFrames (always at least 1).
    """
    variants: List[pd.DataFrame] = []
    current_idxs: List[int] = []
    running = 0.0

    for idx, row in group.iterrows():
        pct = parse_percentage(row.get("percentage")) or 0.0
        # If adding this row would overshoot 100% by more than tolerance,
        # close the current variant and start a new one.
        if running > PERCENTAGE_TOLERANCE and running + pct > 100.0 + PERCENTAGE_TOLERANCE:
            if current_idxs:
                variants.append(group.loc[current_idxs])
            current_idxs = []
            running = 0.0
        current_idxs.append(idx)
        running += pct

    if current_idxs:
        variants.append(group.loc[current_idxs])

    # If the splitter didn't actually split (single variant), return original
    return variants if variants else [group]


# ─── Conversion ───────────────────────────────────────────────────────────────

def convert_formula(name: str, group: pd.DataFrame, seq: int) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    problems: List[str] = []

    # Components
    components: List[Dict[str, Any]] = []
    for _, row in group.iterrows():
        ingredient = clean_str(row.get("ingredient"))
        if not ingredient:
            continue
        pct = parse_percentage(row.get("percentage"))
        if pct is None:
            continue
        components.append({
            "name_en":    ingredient,
            "name_ar":    None,
            "cas_number": clean_cas(row.get("cas_number")),
            "percentage": pct,
            "function":   clean_str(row.get("function")) or "other",
            "phase":      clean_str(row.get("phase")),
        })

    if not components:
        problems.append("no usable components")
        return None, problems

    total = sum(c["percentage"] for c in components)

    # Multi-part detection (epoxy: Part A + Part B = 200%, etc.)
    multi_part_count = 1
    multi_part_detected = False
    for n_parts in (2, 3, 4):
        target = n_parts * 100.0
        if abs(total - target) <= n_parts * PERCENTAGE_TOLERANCE:
            phase_totals: Dict[str, float] = defaultdict(float)
            unphased_total = 0.0
            for c in components:
                if c.get("phase"):
                    phase_totals[c["phase"]] += c["percentage"]
                else:
                    unphased_total += c["percentage"]

            phase_ok = bool(phase_totals) and all(
                abs(s - 100.0) <= PERCENTAGE_TOLERANCE for s in phase_totals.values()
            )
            if phase_ok or unphased_total > 0:
                # Renormalise into a single 100% scale (averaging across parts)
                renormalised = []
                for c in components:
                    cc = dict(c)
                    cc["percentage"] = round(c["percentage"] / n_parts, 3)
                    renormalised.append(cc)
                components = renormalised
                multi_part_count = n_parts
                multi_part_detected = True
                break

    # Re-check sum after potential renormalisation
    total = sum(c["percentage"] for c in components)

    if not multi_part_detected:
        if total < 99.0 - PERCENTAGE_TOLERANCE and total >= WATER_PATCH_THRESHOLD:
            components.append({
                "name_en":    "Water (q.s. to 100%)",
                "name_ar":    "ماء",
                "cas_number": "7732-18-5",
                "percentage": round(100.0 - total, 3),
                "function":   "solvent",
                "phase":      None,
            })
            total = 100.0
        if abs(total - 100.0) > PERCENTAGE_TOLERANCE:
            problems.append(f"percentages sum to {total:.2f}%, not 100% ± {PERCENTAGE_TOLERANCE}%")
            return None, problems

    # Form-level fields
    procedure = first_text(group["procedure"])
    notes     = first_text(group["notes"])
    raw_cat   = first_text(group["category"])

    formula = {
        "id":           make_id(seq),
        "name_en":      name,
        "name_ar":      None,
        "category":     normalise_category(raw_cat),
        "sub_category": (raw_cat or "").lower().replace(" ", "_") or None,
        "form_type":    guess_form_type(name),
        "description":  None,
        "components":   components,
        "process_conditions": {
            "order_of_addition": procedure,
            "temperature_c":     None,
            "ph_target":         None,
            "mixing_speed_rpm":  None,
            "mixing_time_min":   None,
        },
        "properties": {
            "appearance":        None,
            "viscosity_cp":      None,
            "density_g_ml":      None,
            "shelf_life_months": None,
        },
        "safety_warnings": [],
        "source": {
            "type":   "private_library",
            "title":  "Jamil Abduljaleel — Personal Formula Library v2",
            "author": "Jamil Abduljaleel",
            "year":   datetime.now(timezone.utc).year,
            "pages":  None,
        },
        "compliance":  [],
        "trust_score": TRUST_SCORE_DEFAULT,
        "notes":       notes,
        "multi_part":  multi_part_count if multi_part_count > 1 else None,
    }
    return formula, problems


def convert_xlsx(xlsx_path: Path, out_path: Path) -> None:
    print(f"[info] reading {xlsx_path.name}")
    df = pd.read_excel(xlsx_path, sheet_name="Formulas")

    canonical = ["formula_name", "category", "phase", "ingredient",
                 "cas_number", "percentage", "function", "procedure", "notes"]
    df.columns = canonical[:len(df.columns)]
    if len(df.columns) < 9:
        for col in canonical[len(df.columns):]:
            df[col] = None

    if str(df.iloc[0]["formula_name"]).strip().lower() == "formula_name":
        df = df.iloc[1:].reset_index(drop=True)

    df = df[df["formula_name"].notna()]
    print(f"[info] {len(df)} rows · {df['formula_name'].nunique()} unique formulas")

    accepted: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []

    seq = 0
    for name, group in df.groupby("formula_name", sort=False):
        # Some Excel rows share a formula_name but really hold separate
        # variants (each variant's components sum to ~100%, total exceeds 100%).
        # Split into variants by walking the rows and cutting where the running
        # sum hits ~100%.
        variants = split_into_variants(group)
        for v_idx, variant_group in enumerate(variants, start=1):
            seq += 1
            v_name = str(name).strip()
            if len(variants) > 1:
                v_name = f"{v_name} (Variant #{v_idx})"
            formula, problems = convert_formula(v_name, variant_group, seq)
            if formula:
                accepted.append(formula)
            else:
                rejected.append({
                    "formula_name": v_name,
                    "row_count":    len(variant_group),
                    "problems":     problems,
                })

    payload = {
        "_meta": {
            "version":          "1.0.0",
            "generated_at":     datetime.now(timezone.utc).isoformat(),
            "source_file":      xlsx_path.name,
            "total_formulas":   len(accepted),
            "rejected_count": len(rejected),
            "tolerance_pct":    PERCENTAGE_TOLERANCE,
            "trust_score":      TRUST_SCORE_DEFAULT,
            "license":          "Private — Jamil Abduljaleel personal library. Do NOT redistribute without consent.",
        },
        "formulas": accepted,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[done] wrote {len(accepted)} formulas → {out_path}")

    if rejected:
        rej_path = out_path.with_suffix(".rejected.json")
        rej_path.write_text(json.dumps({"rejected": rejected}, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[done] wrote {len(rejected)} rejects → {rej_path}")

    # Quick stats
    cats = {}
    multi = {}
    for f in accepted:
        cats[f["category"]] = cats.get(f["category"], 0) + 1
        mp = f.get("multi_part") or 1
        multi[mp] = multi.get(mp, 0) + 1
    print()
    print("Category breakdown:")
    for c, n in sorted(cats.items(), key=lambda kv: -kv[1]):
        print(f"  {c:25s} {n:5d}")
    print()
    print("Multi-part distribution:")
    for k, n in sorted(multi.items()):
        label = "single-part" if k == 1 else f"{k}-part"
        print(f"  {label:15s} {n:5d}")


def main() -> int:
    p = argparse.ArgumentParser(description="Convert XLSX template to formulas seed JSON.")
    p.add_argument("xlsx", type=Path, help="Input .xlsx file")
    p.add_argument("--out", type=Path, default=Path("data/formulas_jamil.json"),
                   help="Output JSON path (default: data/formulas_jamil.json)")
    args = p.parse_args()

    if not args.xlsx.exists():
        print(f"ERROR: {args.xlsx} not found", file=sys.stderr)
        return 1

    convert_xlsx(args.xlsx, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
