# Data growth playbook — 3,381 → 10,000+ formulas

> Goal: lift the library from **3,381 verified formulas (today)** to
> **10,000+** so the "world's first AI chemical platform" claim is
> backed by real depth, and so SEO/search ranking compound naturally.
>
> This is **owner-run ops** — the tools already exist in the repo;
> they need execution + monitoring, not new code.

---

## Step 0 — Baseline (where we are now)

| Metric | Value (2026-05-19) | Source |
|---|---|---|
| Total formulas | **3,381** | Supabase `formulas` count |
| Chem-enriched (have SMILES) | ~992 | `components[*].chem.smiles != null` |
| Components found on PubChem | 4,941 | `tools.backfill_smiles` last run |
| Components not on PubChem | 3,411 | trade names / polymers / proprietary — expected |
| Categories indexed | 37 used / 40 mapped | `INDUSTRIES` list in `scripts/build_industries.py` |

Empty-category landing pages (0 formulas, captured by the SEO generator
but worth filling early): `food-beverage`, `pet-care`, `adhesives`,
`coatings`. Fill these first — they're under-served and easy SEO wins.

---

## Step 1 — Finish SMILES backfill (2,389 remaining)

Why first: every enriched component improves search ranking, ML model
accuracy (especially compatibility), and the Vision/Discover pipelines.

```powershell
cd backend
.\venv\Scripts\activate
python -m tools.backfill_smiles            # runs ~992 per pass (Supabase 1000 cap)
# Repeat until "no rows left to enrich":
python -m tools.backfill_smiles
python -m tools.backfill_smiles
python -m tools.backfill_smiles            # ~3 passes for the remaining 2,389
```

Verify after each pass: spot-check 10 random formulas — confirm
`components[].chem.smiles` populated where PubChem has the substance.

## Step 2 — Retrain ML on the larger enriched set

After backfill, compatibility/stability/logP models gain real signal:

```powershell
cd backend
python -m ml.train_logp
python -m ml.train_compatibility   # benefits most from the new data
python -m ml.train_stability
git add ml/models/*.joblib
git commit -m "ml: retrain on backfilled dataset"
git push                           # Render auto-redeploys
```

`GET /api/chem/ml/status` should show the new `n_train` numbers and
slightly better held-out metrics.

## Step 3 — Ingest NEW formulas from academic sources

The `Discover` pipeline (`worker-src/handlers/discover.js`) is already
built: it fans out to arXiv, PubMed and Crossref/Lens (patents),
extracts formulas via Claude, and stores them in Supabase.

### 3.a — Identify gaps to target

Run a quick coverage report (one-off, ad-hoc):

```sql
-- in Supabase SQL editor
select category, count(*) as n
from formulas
group by category
order by n asc;
```

Focus harvesting on categories with `n < 50`: `food_beverage`,
`pet_care`, `adhesives`, `coatings`, `pest_control`, plus any sub-50
specialty. Aim for 100–300 formulas per under-served category.

### 3.b — Run Discover for each target query

```bash
# Example queries (run one at a time, results land in `formulas` via worker)
curl -X POST "https://formula-ai-brain.jamilaj1.workers.dev/discover" \
     -H "Authorization: Bearer <admin-jwt>" \
     -H "content-type: application/json" \
     -d '{"query":"food emulsifier formulation","sources":["pubmed","arxiv","crossref"],"max":50}'

curl -X POST .../discover -d '{"query":"polyurethane adhesive formulation","max":50}'
curl -X POST .../discover -d '{"query":"acrylic coating formulation industrial","max":50}'
# … etc.
```

Each batch adds ~10–40 fresh rows after dedup. Review and verify the
top-scoring rows in Supabase before publishing widely (a trust column
< 60 should be hidden from search until a chemist reviews).

### 3.c — Manual seeding from owner's own books

`contribute.html` is live for signed-in users. Use the owner account
to upload personal recipe books / patent PDFs; the Teach-AI pipeline
extracts formulations (Phase 5).

## Step 4 — Track progress weekly

Add a one-line note each week (or use `MORNING_BRIEFING.md`):

```
2026-05-26: backfill pass 2 → enriched 1,847/3,381 (was 992).
2026-06-02: discover food_beverage +73 (now 84 in category).
…
```

When `count(formulas) >= 10000` and median trust >= 80 → regenerate the
sitemap + industry pages (one command each), bump cache version, and
re-deploy:

```powershell
python scripts/build_sitemap.py
python scripts/build_industries.py
python scripts/build_phase3.py        # rolls everything into DEPLOY_PHASE3.zip
# Upload to Hostinger
```

---

## Realistic timeline

| Weeks | Activity | Outcome |
|---|---|---|
| 1 | Backfill passes + retrain | enriched ≥ 3,000 / 3,381 |
| 2–3 | Discover sweep — under-served categories | +500 to +1,000 new rows |
| 4–6 | Discover sweep — high-volume categories | +1,500 to +3,000 |
| 6–10 | Owner-book ingestion + Teach-AI | +1,000 to +2,000 |
| Result | | **~7,000–10,000 formulas, 80%+ enriched** |

---

## Quality bar (do NOT trade for quantity)

A formula joins the public index only if it:
1. Has a non-empty `name_en` (English title).
2. Has at least 3 components with non-zero percentages summing 90–110%.
3. Has `trust_score >= 60` after the 7-stage validation in
   `backend/services` (already in code).
4. Has a real `category` from the canonical list (37 + 3 cross
   groupings — see `INDUSTRIES` in `scripts/build_industries.py`).

Anything failing these stays in a staging state, invisible to public
search / sitemap, until a chemist reviews. That keeps the bar high
while the count climbs.
