# Formula AI Global — Data Tools

دليل سريع لتعبئة قاعدة البيانات بفورمولات حقيقية موثّقة.

This folder contains the two tools that take Formula AI Global from
"empty database" to "real, citable formulas an investor can audit":

| File | Purpose |
| --- | --- |
| `extract_formulas.py` | Read a PDF chemistry book and extract every formulation Claude can find, into the same JSON shape as `data/formulas_seed.json`. |
| `seed_database.py` | Validate a JSON file (curated seed or AI-extracted) and upsert it into the Supabase `formulas` table. |

---

## 0 · Why this exists

The site claims **200,000+ formulas across 40 industries**. Today the
`formulas` table is empty. The two-step pipeline below is how we close
that gap honestly, with **provenance attached to every row**:

```
┌──────────────────────┐    extract_formulas.py    ┌──────────────────────┐
│ Jamil's PDF library  │  ───────────────────────▶ │ formulas_*.json      │
│ (40+ chemistry books)│       (Claude API)        │ (validated, sourced) │
└──────────────────────┘                           └──────────┬───────────┘
                                                              │
                                            seed_database.py  │
                                                              ▼
                                                    ┌──────────────────┐
                                                    │ Supabase formulas│
                                                    │     table        │
                                                    └──────────────────┘
```

---

## 1 · Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
pip install pypdf                  # only needed for extract_formulas.py
cp .env.example .env                # then fill in real values
```

Required env vars (in `backend/.env`):

```
ANTHROPIC_API_KEY=sk-ant-…
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>     # NOT the anon key
```

---

## 2 · Extract formulas from a PDF

```bash
cd backend/tools

python extract_formulas.py \
    /path/to/jamil_book.pdf \
    --title "موسوعة الصناعات الكيميائية" \
    --author "جميل عبد الجليل" \
    --year 2018 \
    --start-page 12 \
    --max-pages 80 \
    --batch-size 4 \
    --out ../data/formulas_extracted_book1.json
```

What happens:

1. The script reads pages 12–91 from the PDF.
2. Every 4 pages are sent to Claude with a strict extraction prompt.
3. Claude returns JSON; the script validates each formula:
   - percentages must sum to 100% ± 0.5%
   - CAS numbers must match the standard regex
   - all required fields must be present
4. Accepted formulas → `data/formulas_extracted_book1.json`
5. Anything that fails validation → `data/formulas_extracted_book1.rejected.json`
   (so you can review and either fix the source page or fix the prompt).

### Cost estimate

At Sonnet 4.5 prices (~$3 input / $15 output per million tokens):

- 4 pages ≈ 6,000 input tokens + ~3,000 output tokens
- ≈ **$0.063 per batch** → ≈ **$1.50 per 100-page chapter**

A whole 500-page book costs roughly **$7–$10** and yields hundreds of
formulas. Budget conservatively: **$200 covers extracting your top 20
books**.

### Tips

- Start with `--max-pages 20` on a new book to sanity-check the output
  before committing to the full extraction.
- If a chapter is mostly theory, use `--start-page` to skip to the
  recipe sections.
- Reduce `--batch-size` to 2 if a book has very dense pages — it
  improves recall (fewer formulas slip past Claude per call).

---

## 3 · Seed Supabase

Always dry-run first:

```bash
python seed_database.py --dry-run \
    ../data/formulas_seed.json \
    ../data/formulas_extracted_book1.json
```

You'll see something like:

```
[file] ../data/formulas_seed.json
[file] running totals → inserted=50, updated=0, rejected=0
[file] ../data/formulas_extracted_book1.json
[file] running totals → inserted=187, updated=0, rejected=3
============================================================
  RESULT: 237 inserted, 0 updated, 3 rejected
  Mode  : DRY-RUN (no DB writes)
============================================================
```

If the rejection count is acceptable, run for real:

```bash
python seed_database.py \
    ../data/formulas_seed.json \
    ../data/formulas_extracted_book1.json
```

The script is **idempotent** — it upserts by the human-readable
formula code (`FA-2026-…`), so re-running won't create duplicates.

---

## 4 · Schema notes

`seed_database.py` writes to the `formulas` table defined in
`database/schema.sql`. The mapping:

| JSON field | DB column | Notes |
| --- | --- | --- |
| `id` (e.g. `FA-2026-00001`) | `source_url` | Used as the de-dupe key |
| `name_en`, `name_ar` | `name_en`, `name` | Arabic preferred for `name` |
| `category`, `sub_category`, `form_type` | same | |
| `description` | same | |
| `components` (array) | `components` JSONB | Stays inline |
| `process_conditions` | same JSONB | |
| `properties` | `final_properties` JSONB | Renamed |
| `safety_warnings` | same JSONB | |
| `source.{type,title,author,year,pages}` | `source_type`, `source_title`, `source_author`, `source_year`, `source_page` | Flattened |
| `trust_score` (0-100) | `trust_score` + `source_confidence` (÷100) | Both populated |

If you later want a normalised `formula_components` join table for
heavy querying, add it via migration and update `seed_database.py`'s
`map_to_db_row()` function.

---

## 5 · Provenance & legal hygiene

Every row carries its source. Before publishing extracted recipes:

1. **Confirm Jamil owns / is licensed for** the PDFs you mine.
2. Mark proprietary recipes as private in the DB so they aren't
   surfaced on the public search page.
3. For public formulas, prefer sources already in the public domain:
   FDA OTC monographs, USP, WHO guidelines, ASTM tests, expired
   patents, peer-reviewed Open Access papers, CC-BY content.

`formulas_seed.json` was hand-curated from public sources with
trust scores 91–99. Extracted formulas default to trust_score=85
because automated extraction is not yet human-verified — bump them to
≥90 only after a chemist reviews the recipe.

---

## 6 · Troubleshooting

**`Claude returned non-JSON`** — The book likely has unusual
formatting (multi-column layouts, images of recipes). Try a smaller
batch size, or pre-process the PDF with OCR (e.g. `ocrmypdf`).

**`percentages sum to 97.50%, not 100%`** — Common when the source
recipe omits "q.s. water". You can either:

- Fix the rejected JSON manually and re-run `seed_database.py`, or
- Improve the system prompt in `extract_formulas.py` to add water
  to balance whenever the recipe is short.

**`pip install supabase` fails on Python 3.13** — Pin to Python 3.11:
`pyenv install 3.11.10 && pyenv local 3.11.10`.

---

## 7 · Roadmap

- [ ] Add `--language ar` flag to handle Arabic-only books with explicit
      RTL hints in the prompt.
- [ ] Optional `--review` mode that pauses after each batch and lets
      a human accept/reject formulas before they hit the JSON.
- [ ] Auto-tag duplicate formulas across books (same components + same
      percentages) and merge their citations.
- [ ] Embed every formula with `text-embedding-3-large` and store the
      vector in `pgvector` so search by similarity works on day one.
