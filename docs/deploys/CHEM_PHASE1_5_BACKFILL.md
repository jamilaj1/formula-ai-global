# Phase 1.5 — Enrich the 3,381 formulas with real chemistry

After Phase 1 (RDKit engine deployed) but before Phase 2 (similarity
search), every component in every formula needs to be tied to a real
chemical identity: SMILES + InChIKey + PubChem CID.

This guide walks you through the one-time enrichment process. After it,
every Phase 2+ feature has real chemistry to work with.

---

## What this does

Before:
```json
{ "name_en": "Sodium Laureth Sulfate", "cas_number": "68585-34-2", "percentage": 12.0 }
```

After:
```json
{
  "name_en": "Sodium Laureth Sulfate",
  "cas_number": "68585-34-2",
  "percentage": 12.0,
  "chem": {
    "found": true,
    "cid": 8851,
    "smiles": "CCCCCCCCCCCCOCCOCCOS(=O)(=O)[O-].[Na+]",
    "inchi_key": "...",
    "formula": "C16H33NaO7S",
    "molecular_weight": 384.49,
    "logp": 4.12,
    "lipinski_violations": 1,
    "source": "pubchem",
    "looked_up_at": "2026-05-13T16:00:00Z"
  }
}
```

Multiplied by ~10 components per formula × 3,381 formulas = ~33,000
PubChem lookups. At PubChem's 5 req/sec ceiling, this takes ~30 minutes.

---

## What you get after this runs

| Capability | Before | After |
|---|---|---|
| Find similar formulas | text similarity only | structural (Tanimoto) similarity |
| Find substitute for ingredient | manual | "find compounds within ±10% MW + same functional group" |
| Conflict detection | regex on names | InChIKey-based — catches "ethanol" + "alcohol" + "C2H6O" as the same thing |
| Solubility prediction | LLM guess | computed from logP per ingredient |
| Drug-likeness scoring | n/a | Lipinski violations summed |
| Property aggregation per formula | n/a | weighted average MW, logP, etc. |

This single migration unlocks every Phase 2+ feature.

---

## Step 0 — Prerequisites

You must already have:

- ✅ Phase 1 deployed (Python backend on Render, `/api/chem/health` returns 200)
- ✅ Local `.env` with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
- ✅ A Python environment with `backend/requirements.txt` installed
  (the same one you used to test Phase 1 locally)

If you don't have a local Python env yet:

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\Activate.ps1
# macOS/Linux:
source venv/bin/activate
pip install -r requirements.txt
```

---

## Step 1 — Run the SQL migration

This adds indexes that make Phase 2 queries fast.

1. Open Supabase → SQL Editor
2. Paste the contents of `database/migrations/supabase_phase15_chem_indexes.sql`
3. **Run**
4. Expected output: 4 `CREATE INDEX` + 1 `ALTER TABLE` notices (no errors)

The migration is idempotent — safe to run multiple times.

---

## Step 2 — Dry-run on 5 formulas (1 minute)

Before running on all 3,381, test on a tiny sample:

```bash
cd backend
python -m tools.backfill_smiles --dry-run --limit 5
```

Expected output:

```
[backfill] 2026-05-13T16:00:00+00:00 starting (dry_run=True, limit=5, refresh=False)
[backfill] 5 formulas to process
[backfill] estimated 47 component lookups
[backfill] estimated wall time: ~0.2 min
[   1/5] 'Hand Soap (Clear, Quality)'
    DRY: would patch <uuid> with 8 components
    preview: { "found": true, "cid": 222, "smiles": "...", ... }
[   2/5] 'Laundry Detergent Concentrate'
    ...

[backfill] done
  formulas updated:    0       ← dry-run, no writes
  components found:    32      ← PubChem matched 32 of 47 components
  components missing:  15      ← 15 components weren't in PubChem
  errors:              0
```

If you see `components found > 0` and `errors == 0`, you're ready for
the real run.

---

## Step 3 — Backfill a small batch (10 minutes)

Process 50 formulas to confirm writes work:

```bash
python -m tools.backfill_smiles --limit 50
```

Then verify in Supabase SQL Editor:

```sql
SELECT id, name_en, chemistry_enriched_at,
       jsonb_array_length(components) AS num_components,
       (SELECT COUNT(*) FROM jsonb_array_elements(components) c
        WHERE c->'chem'->>'found' = 'true') AS enriched_count
FROM formulas
WHERE chemistry_enriched_at IS NOT NULL
ORDER BY chemistry_enriched_at DESC
LIMIT 10;
```

You should see 10 rows with `enriched_count` > 0.

---

## Step 4 — Full backfill (30-45 minutes)

When the small batch looks correct:

```bash
# Background it on your machine — the script handles pacing
python -m tools.backfill_smiles
```

Logs print one formula per line. Resume-safe: if interrupted, just
re-run — already-enriched components are skipped (use `--refresh` to
force re-lookup).

### Estimated final stats

For 3,381 formulas × ~10 components = ~33,000 PubChem calls:

- Wall time: 30-45 min (PubChem 5 req/sec ceiling)
- Coverage: typically **70-85%** of components found in PubChem
  - Common organic chemicals, surfactants, preservatives: ~95% hit rate
  - Branded trade-name surfactants ("Tween 80" type): ~60% hit rate
  - Cosmetic INCI-only names: ~70% hit rate
- Cost: $0 (PubChem is free, no API key needed)

---

## Step 5 — Verify

```sql
-- Total enrichment progress
SELECT
  COUNT(*) FILTER (WHERE chemistry_enriched_at IS NOT NULL) AS enriched,
  COUNT(*) FILTER (WHERE chemistry_enriched_at IS NULL)     AS pending,
  COUNT(*) AS total
FROM formulas;

-- Per-formula coverage: which formulas have >80% of components enriched?
SELECT
  id, name_en,
  jsonb_array_length(components) AS total_comps,
  (SELECT COUNT(*) FROM jsonb_array_elements(components) c
   WHERE c->'chem'->>'found' = 'true') AS found_comps
FROM formulas
WHERE chemistry_enriched_at IS NOT NULL
ORDER BY id
LIMIT 20;
```

---

## Step 6 — Try the live endpoints

After backfill, the new endpoints work on real data:

```bash
# Look up a single name (no DB needed, hits PubChem live)
curl -X POST https://formula-ai-brain.jamilaj1.workers.dev/chem/lookup/name \
  -H "Content-Type: application/json" \
  -d '{"name":"glycerin"}'

# Look up by CAS
curl -X POST https://formula-ai-brain.jamilaj1.workers.dev/chem/lookup/cas \
  -H "Content-Type: application/json" \
  -d '{"cas":"56-81-5"}'
```

Both return `{found: true, cid, smiles, inchi_key, formula, mw, ..., rdkit: {...}}`.

---

## What's next (Phase 2 preview)

Once Phase 1.5 is complete, Phase 2 features become trivial to build
because every component has a SMILES + InChIKey:

```python
# Phase 2: similarity search by structure
POST /chem/find_similar
  { "smiles": "CCO", "threshold": 0.7, "limit": 20 }
  → [
      {"formula_id": "...", "match_smiles": "CCO", "similarity": 1.0},
      {"formula_id": "...", "match_smiles": "CCCO", "similarity": 0.85},
      ...
    ]

# Phase 2: substitute search
POST /chem/find_substitute
  { "ingredient": "Triclosan", "function": "antimicrobial" }
  → [
      {"name": "Tea Tree Oil", "similarity_score": 0.7, "function_match": true},
      {"name": "Chlorhexidine", "similarity_score": 0.6, ...},
    ]
```

This is what real chemistry AI looks like — not a chatbot, an engine.

---

## Troubleshooting

### "Connection error: dns" or repeated timeouts
PubChem occasionally has hiccups. Re-run; the script is resume-safe.

### Many components show `found: false`
Normal — PubChem doesn't index every cosmetic trade-name. For those,
you can later either:
1. Add SMILES manually via the new `PUT /library/:id` endpoint
2. Use an LLM to convert "INCI name → IUPAC name" then re-lookup
3. Cross-reference an INCI database (Phase 2.5)

### Backfill running but no writes happening
Check the script output — if you see "DRY:" prefixes, you forgot to
remove `--dry-run`. Re-run without that flag.

### Want to redo enrichment with newer PubChem data
```bash
python -m tools.backfill_smiles --refresh
```
Note this re-fetches ALL components (45+ minutes, more PubChem calls).
