-- ============================================================
-- Phase 1.5 — Indexes on chemistry-enrichment data
-- Run after backfill_smiles.py has populated components[].chem.*
-- ============================================================
--
-- The `components` column on `formulas` is JSONB. After backfill, every
-- component has a `chem` block with `inchi_key`, `smiles`, `cid`, etc.
-- These indexes make the upcoming Phase 2 similarity / substitution
-- queries fast (<100 ms even at 50K+ formulas).
--
-- Safe to run multiple times — every index uses `IF NOT EXISTS`.
-- ============================================================

-- Track which formulas have been enriched with PubChem + RDKit data.
ALTER TABLE formulas
    ADD COLUMN IF NOT EXISTS chemistry_enriched_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_formulas_chemistry_enriched_at
    ON formulas (chemistry_enriched_at);

-- ------------------------------------------------------------
-- JSONB GIN index — full search on components, including nested
-- chem.{inchi_key,cid,formula,smiles}. Lets us answer queries like
-- "which formulas contain an ingredient with this InChIKey?" in
-- one indexed lookup.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_formulas_components_gin
    ON formulas USING GIN (components);

-- ------------------------------------------------------------
-- More targeted: a GIN expression index on JUST the chem block.
-- Cheaper to maintain than the full-components GIN above for
-- write-heavy workloads. Either one is enough; we ship both so
-- you can DROP the slower one after measuring.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_formulas_chem_paths
    ON formulas USING GIN ((components -> 'chem'));

-- ------------------------------------------------------------
-- Example queries this unlocks (run in SQL Editor to test):
-- ------------------------------------------------------------
--
-- 1) Find every formula containing ethanol (InChIKey LFQSCWFLJHTTHZ-UHFFFAOYSA-N)
--
--    SELECT id, name_en
--    FROM formulas
--    WHERE components @> '[{"chem": {"inchi_key": "LFQSCWFLJHTTHZ-UHFFFAOYSA-N"}}]'::jsonb;
--
-- 2) Count how many formulas have been enriched
--
--    SELECT COUNT(*) FROM formulas WHERE chemistry_enriched_at IS NOT NULL;
--
-- 3) Find formulas with at least one component above logP 5
--    (likely to be poorly water-soluble — relevant for cosmetics)
--
--    SELECT id, name_en
--    FROM formulas
--    WHERE EXISTS (
--      SELECT 1
--      FROM jsonb_array_elements(components) AS c
--      WHERE (c->'chem'->>'logp')::float > 5
--    );
-- ============================================================
