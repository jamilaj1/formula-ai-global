#!/usr/bin/env python3
"""
extract_formulas.py — Extract chemical formulations from PDF books using Claude.

USAGE
-----
    python extract_formulas.py <book.pdf> [--out formulas_extracted.json]
                                          [--max-pages 50]
                                          [--start-page 1]
                                          [--model claude-sonnet-4-5]
                                          [--batch-size 4]

PURPOSE
-------
Jamil's chemistry library contains thousands of real industrial formulas.
This tool reads a PDF chapter-by-chapter, asks Claude to extract every
formulation it can find, normalises the output to the same JSON shape used
in `data/formulas_seed.json`, and writes a new file ready to be seeded
into Supabase.

SAFETY / QUALITY
----------------
* Every formula is validated: percentages must sum to 100% ± 0.5%.
* CAS numbers are sanity-checked against the standard regex.
* Formulas that fail validation are dumped to `<out>.rejected.json` for
  manual review — they are NEVER silently dropped.
* Source citation is attached to every extracted formula (book title +
  page range), so we can always trace a claim back to its origin.

REQUIREMENTS
------------
    pip install anthropic pypdf pydantic python-dotenv tqdm
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from pypdf import PdfReader
except ImportError:
    print("ERROR: pypdf not installed. Run: pip install pypdf", file=sys.stderr)
    sys.exit(1)

try:
    import anthropic
except ImportError:
    print("ERROR: anthropic not installed. Run: pip install anthropic", file=sys.stderr)
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv optional


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_MODEL = "claude-sonnet-4-5"
DEFAULT_BATCH_SIZE = 4          # pages per Claude call
DEFAULT_MAX_PAGES = 200
PERCENTAGE_TOLERANCE = 0.5      # how far from 100% we still accept
MAX_OUTPUT_TOKENS = 8000

CAS_REGEX = re.compile(r"^\d{2,7}-\d{2}-\d$")


# ─────────────────────────────────────────────────────────────────────────────
# The extraction prompt — this is the contract with Claude
# ─────────────────────────────────────────────────────────────────────────────

EXTRACTION_SYSTEM_PROMPT = """You are a senior chemical-formulations editor working for Formula AI Global, a regulated B2B platform. You extract EVERY chemical/cosmetic/industrial formulation found in the page excerpts the user provides.

CRITICAL RULES:
1. Output STRICT JSON only — no commentary, no markdown fences, no prose. Wrap the entire output in a single object: {"formulas": [...]}.
2. Each formula's component percentages MUST sum to exactly 100.0 (you may use decimals; tolerance is ±0.5%). If a recipe gives ranges like "1-3%", use the midpoint.
3. Use real CAS numbers when known (format: 1234-56-7). If unknown, use null — DO NOT GUESS.
4. Translate the formula name into Arabic in `name_ar`. If the source is already Arabic, fill `name_en` with an English translation.
5. Pick `category` from this controlled vocabulary:
   hair_care | skin_care | body_care | oral_care | personal_hygiene | color_cosmetics |
   cleaning | disinfectants | laundry | dishwashing | automotive | industrial |
   agriculture | food_beverage | pet_care | adhesives | coatings | specialty
6. `form_type` must be one of: liquid | gel | cream | lotion | paste | powder | solid_bar | spray | aerosol | foam | tablet | granular
7. If a formula is incomplete, ambiguous, or you cannot reach 100% — DO NOT INVENT MISSING DATA. Skip it.
8. Source: cite the book exactly as the user gives it.

SCHEMA (use null for unknowns; never omit required keys):
{
  "name_en": "string",
  "name_ar": "string",
  "category": "enum",
  "sub_category": "string",
  "form_type": "enum",
  "description": "1-2 sentence purpose",
  "components": [
    {
      "name_en": "string",
      "name_ar": "string|null",
      "cas_number": "string|null",
      "percentage": number,
      "function": "emulsifier|surfactant|preservative|solvent|active|thickener|fragrance|colorant|chelating_agent|pH_adjuster|humectant|emollient|propellant|filler|other"
    }
  ],
  "process_conditions": {
    "temperature_c": number|null,
    "ph_target": "string|null",
    "mixing_speed_rpm": number|null,
    "mixing_time_min": number|null,
    "order_of_addition": "string|null"
  },
  "properties": {
    "appearance": "string|null",
    "viscosity_cp": number|null,
    "density_g_ml": number|null,
    "shelf_life_months": number|null
  },
  "safety_warnings": ["string", ...],
  "source": {
    "type": "book",
    "title": "string",
    "author": "string|null",
    "year": number|null,
    "pages": "string"
  }
}

If no formulations are present in the excerpt, return {"formulas": []}.
"""


# ─────────────────────────────────────────────────────────────────────────────
# Data classes
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ExtractionResult:
    accepted: List[Dict[str, Any]] = field(default_factory=list)
    rejected: List[Dict[str, Any]] = field(default_factory=list)
    pages_processed: int = 0
    api_calls: int = 0
    errors: List[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# PDF utilities
# ─────────────────────────────────────────────────────────────────────────────

def read_pdf_pages(pdf_path: Path, start: int, end: int) -> List[Tuple[int, str]]:
    """Return [(page_number, text), ...] for pages [start, end] inclusive (1-indexed)."""
    reader = PdfReader(str(pdf_path))
    total = len(reader.pages)
    end = min(end, total)
    pages: List[Tuple[int, str]] = []
    for i in range(start - 1, end):
        try:
            text = reader.pages[i].extract_text() or ""
            text = text.strip()
            if text:
                pages.append((i + 1, text))
        except Exception as e:
            print(f"[warn] could not read page {i+1}: {e}", file=sys.stderr)
    return pages


def chunk_pages(pages: List[Tuple[int, str]], batch_size: int) -> List[List[Tuple[int, str]]]:
    return [pages[i : i + batch_size] for i in range(0, len(pages), batch_size)]


# ─────────────────────────────────────────────────────────────────────────────
# Claude call
# ─────────────────────────────────────────────────────────────────────────────

def call_claude(
    client: anthropic.Anthropic,
    model: str,
    book_title: str,
    book_author: Optional[str],
    book_year: Optional[int],
    pages: List[Tuple[int, str]],
) -> Dict[str, Any]:
    """Send a batch of pages to Claude and return parsed JSON."""

    page_range = f"{pages[0][0]}-{pages[-1][0]}"
    excerpt = "\n\n".join([f"--- PAGE {n} ---\n{txt}" for n, txt in pages])

    user_msg = (
        f"BOOK: {book_title}\n"
        f"AUTHOR: {book_author or 'unknown'}\n"
        f"YEAR: {book_year or 'unknown'}\n"
        f"PAGES: {page_range}\n\n"
        f"Extract every formulation from these pages. Set source.pages = \"{page_range}\".\n\n"
        f"EXCERPT:\n{excerpt}"
    )

    resp = client.messages.create(
        model=model,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=EXTRACTION_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )

    raw = "".join(
        block.text for block in resp.content if getattr(block, "type", "") == "text"
    ).strip()

    # Strip code fences if Claude added any despite instructions
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        # Try to salvage by finding the first { and last }
        first = raw.find("{")
        last = raw.rfind("}")
        if first != -1 and last != -1 and last > first:
            return json.loads(raw[first : last + 1])
        raise ValueError(f"Claude returned non-JSON for pages {page_range}: {e}\n\n{raw[:500]}")


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

def validate_formula(f: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Return (is_valid, list_of_problems)."""
    problems: List[str] = []

    required_top = ["name_en", "name_ar", "category", "form_type", "components", "source"]
    for key in required_top:
        if key not in f or f[key] in (None, "", []):
            problems.append(f"missing required field: {key}")

    components = f.get("components") or []
    if not components:
        problems.append("no components")
    else:
        total = 0.0
        for i, c in enumerate(components):
            if "percentage" not in c or not isinstance(c["percentage"], (int, float)):
                problems.append(f"component[{i}] missing/invalid percentage")
                continue
            total += float(c["percentage"])
            cas = c.get("cas_number")
            if cas and not CAS_REGEX.match(str(cas)):
                problems.append(f"component[{i}] has malformed CAS: {cas}")
        if abs(total - 100.0) > PERCENTAGE_TOLERANCE:
            problems.append(f"percentages sum to {total:.2f}%, not 100% ± {PERCENTAGE_TOLERANCE}%")

    return len(problems) == 0, problems


def assign_id(index: int) -> str:
    year = datetime.now(timezone.utc).year
    # FA = Formula AI; X = eXtracted (vs S = Seed). Sequence is 5 digits.
    return f"FA-{year}-X{index:04d}"


def normalise_formula(f: Dict[str, Any], index: int) -> Dict[str, Any]:
    """Add the housekeeping fields the seed JSON expects."""
    f = dict(f)  # shallow copy
    f["id"] = assign_id(index)
    f["trust_score"] = f.get("trust_score", 85)  # extracted < curated
    f["compliance"] = f.get("compliance", [])
    f["extracted_at"] = datetime.now(timezone.utc).isoformat()
    return f


# ─────────────────────────────────────────────────────────────────────────────
# Main extraction loop
# ─────────────────────────────────────────────────────────────────────────────

def extract(
    pdf_path: Path,
    out_path: Path,
    book_title: str,
    book_author: Optional[str],
    book_year: Optional[int],
    start_page: int,
    max_pages: int,
    batch_size: int,
    model: str,
) -> ExtractionResult:

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set in environment.", file=sys.stderr)
        sys.exit(2)

    client = anthropic.Anthropic(api_key=api_key)

    end_page = start_page + max_pages - 1
    print(f"[info] reading pages {start_page}-{end_page} from {pdf_path.name}")
    pages = read_pdf_pages(pdf_path, start_page, end_page)
    print(f"[info] {len(pages)} non-empty pages loaded")

    batches = chunk_pages(pages, batch_size)
    print(f"[info] {len(batches)} batches of up to {batch_size} pages each")

    result = ExtractionResult()
    next_index = 1

    for batch_no, batch in enumerate(batches, 1):
        page_range = f"{batch[0][0]}-{batch[-1][0]}"
        print(f"[batch {batch_no}/{len(batches)}] pages {page_range} ...", end=" ", flush=True)
        try:
            data = call_claude(client, model, book_title, book_author, book_year, batch)
            result.api_calls += 1
        except Exception as e:
            err = f"batch {batch_no} ({page_range}) failed: {e}"
            print(f"FAIL")
            result.errors.append(err)
            continue

        formulas = data.get("formulas", []) if isinstance(data, dict) else []
        accepted_in_batch = 0
        rejected_in_batch = 0
        for raw in formulas:
            ok, problems = validate_formula(raw)
            if ok:
                result.accepted.append(normalise_formula(raw, next_index))
                next_index += 1
                accepted_in_batch += 1
            else:
                raw["_validation_errors"] = problems
                result.rejected.append(raw)
                rejected_in_batch += 1
        result.pages_processed += len(batch)
        print(f"{accepted_in_batch} accepted, {rejected_in_batch} rejected")

    # Write outputs
    payload = {
        "_meta": {
            "version": "1.0.0",
            "extracted_at": datetime.now(timezone.utc).isoformat(),
            "source_pdf": str(pdf_path.name),
            "book_title": book_title,
            "book_author": book_author,
            "book_year": book_year,
            "model": model,
            "pages_processed": result.pages_processed,
            "api_calls": result.api_calls,
            "total_formulas": len(result.accepted),
            "license": "Internal — extracted from third-party source. Verify rights before publication.",
        },
        "formulas": result.accepted,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[done] wrote {len(result.accepted)} formulas to {out_path}")

    if result.rejected:
        rejected_path = out_path.with_suffix(".rejected.json")
        rejected_path.write_text(
            json.dumps({"rejected": result.rejected}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"[done] wrote {len(result.rejected)} rejected formulas to {rejected_path}")

    if result.errors:
        print(f"[warn] {len(result.errors)} batches errored:", file=sys.stderr)
        for e in result.errors:
            print(f"  - {e}", file=sys.stderr)

    return result


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Extract chemical formulations from a PDF book using Claude.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("pdf", type=Path, help="Path to the PDF book to mine.")
    p.add_argument("--out", type=Path, default=Path("data/formulas_extracted.json"),
                   help="Output JSON path (default: data/formulas_extracted.json)")
    p.add_argument("--title", type=str, default=None,
                   help="Book title for citation. Defaults to PDF filename stem.")
    p.add_argument("--author", type=str, default=None, help="Book author for citation.")
    p.add_argument("--year", type=int, default=None, help="Publication year for citation.")
    p.add_argument("--start-page", type=int, default=1, help="First PDF page to process (1-indexed).")
    p.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES,
                   help=f"Max pages to process (default: {DEFAULT_MAX_PAGES}).")
    p.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE,
                   help=f"Pages per Claude call (default: {DEFAULT_BATCH_SIZE}).")
    p.add_argument("--model", type=str, default=DEFAULT_MODEL,
                   help=f"Claude model (default: {DEFAULT_MODEL}).")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.pdf.exists():
        print(f"ERROR: PDF not found: {args.pdf}", file=sys.stderr)
        return 1

    title = args.title or args.pdf.stem.replace("_", " ").title()
    extract(
        pdf_path=args.pdf,
        out_path=args.out,
        book_title=title,
        book_author=args.author,
        book_year=args.year,
        start_page=args.start_page,
        max_pages=args.max_pages,
        batch_size=args.batch_size,
        model=args.model,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
