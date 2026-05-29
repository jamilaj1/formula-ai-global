-- ════════════════════════════════════════════════════════════════════
-- VECTOR SEARCH — Phase 9.1 of BUILD_ROADMAP.md (2026-05-29)
--
-- What this builds
-- ----------------
--   1. `vector` extension (pgvector) — Supabase Pro ships it ready.
--   2. `embedding vector(1536)` column on `formulas`. 1536 dims matches
--      OpenAI text-embedding-3-small, which is what the backfill script
--      (`scripts/embed_formulas.py`) writes. Storage cost: ~6 KB / row
--      × 3,381 rows ≈ 20 MB total. Negligible.
--   3. HNSW index for fast cosine-similarity ANN queries (sub-10ms for
--      our 3,381-row table; scales to millions before we'd need IVF).
--   4. `public.match_formulas(query_embedding, top_k, min_similarity)`
--      RPC. SECURITY DEFINER + REVOKE EXECUTE FROM PUBLIC so only
--      service_role can call it — RLS-style anti-scraping protection
--      identical to Phase 1.1 for direct SELECT.
--
-- Why this matters
-- ----------------
-- The chat tool currently retries 3-4 ILIKE variants when the user's
-- query doesn't lexically match a formula name (e.g. "I need something
-- that cuts oily residue without leaving a film" → no ILIKE hit, Claude
-- burns tokens guessing synonyms). Vector retrieval returns semantically
-- relevant formulas on the FIRST shot, so the tool loop exits earlier
-- and Claude bills us less.
--
-- Safe to re-run (every statement uses IF NOT EXISTS / CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Extension ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 2. Column ───────────────────────────────────────────────────────
ALTER TABLE public.formulas
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

COMMENT ON COLUMN public.formulas.embedding IS
  'OpenAI text-embedding-3-small (1536 dims) of name_en + sub_category + top-5 components. Backfilled by scripts/embed_formulas.py.';

-- ── 3. HNSW index ───────────────────────────────────────────────────
-- HNSW is the right choice at this scale: builds in seconds for ~3k
-- rows, sub-10ms queries, no maintenance. Switch to IVFFLAT only if
-- this table grows past ~1M rows.
--
-- m=16 and ef_construction=64 are sensible defaults for our row count
-- — higher numbers give a tiny recall boost at the cost of much more
-- build time and memory.
CREATE INDEX IF NOT EXISTS formulas_embedding_hnsw
  ON public.formulas
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── 4. RPC: match_formulas ──────────────────────────────────────────
-- The Worker calls this with the embedded user query and gets back the
-- top-k most similar formulas (cosine similarity, threshold-filtered).
--
-- Return shape mirrors what /chat's search_formulas tool already uses —
-- the same SELECT columns so the merge logic in worker-src/handlers/chat.js
-- can treat ILIKE rows and vector rows interchangeably.
CREATE OR REPLACE FUNCTION public.match_formulas(
  query_embedding   vector(1536),
  top_k             INT     DEFAULT 10,
  min_similarity    FLOAT   DEFAULT 0.30
)
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  name_en       TEXT,
  category      TEXT,
  sub_category  TEXT,
  form_type     TEXT,
  trust_score   NUMERIC,
  source_title  TEXT,
  source_year   INT,
  similarity    FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.id,
    f.name,
    f.name_en,
    f.category,
    f.sub_category,
    f.form_type,
    f.trust_score,
    f.source_title,
    f.source_year,
    1 - (f.embedding <=> query_embedding) AS similarity
  FROM public.formulas f
  WHERE
    f.embedding IS NOT NULL
    AND (1 - (f.embedding <=> query_embedding)) >= min_similarity
  ORDER BY f.embedding <=> query_embedding   -- cosine distance ascending = most similar first
  LIMIT GREATEST(1, LEAST(top_k, 50));        -- clamp to avoid runaway queries
$$;

COMMENT ON FUNCTION public.match_formulas IS
  'Phase 9.1 vector search. Returns top-k formulas by cosine similarity. service_role only.';

-- Lock down EXECUTE — same anti-scraping pattern as Phase 1.1. Only the
-- Worker (service_role) gets to call this; anon and authenticated do not.
REVOKE EXECUTE ON FUNCTION public.match_formulas(vector(1536), INT, FLOAT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.match_formulas(vector(1536), INT, FLOAT)
  TO service_role;

-- ── 5. Backfill check view ──────────────────────────────────────────
-- Handy for `scripts/embed_formulas.py` and any future health-check —
-- shows how many formulas still need an embedding.
CREATE OR REPLACE VIEW public.formula_embedding_progress AS
  SELECT
    COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
    COUNT(*) FILTER (WHERE embedding IS NULL)     AS pending,
    COUNT(*)                                       AS total,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE embedding IS NOT NULL) / NULLIF(COUNT(*), 0),
      2
    ) AS pct_embedded
  FROM public.formulas;

GRANT SELECT ON public.formula_embedding_progress TO service_role;

-- ── 6. Verification (uncomment after running) ──────────────────────
-- SELECT extname, extversion FROM pg_extension WHERE extname='vector';
-- SELECT * FROM public.formula_embedding_progress;
-- -- After backfill, smoke-test (the embedding here is a placeholder vector):
-- WITH q AS (
--   SELECT ARRAY(SELECT 0.001::float8 FROM generate_series(1,1536))::vector(1536) AS v
-- )
-- SELECT id, name_en, similarity FROM public.match_formulas((SELECT v FROM q), 5, 0.0);

-- ── ROLLBACK ───────────────────────────────────────────────────────
-- DROP VIEW     IF EXISTS public.formula_embedding_progress;
-- DROP FUNCTION IF EXISTS public.match_formulas(vector(1536), INT, FLOAT);
-- DROP INDEX    IF EXISTS public.formulas_embedding_hnsw;
-- ALTER TABLE   public.formulas DROP COLUMN IF EXISTS embedding;
-- DROP EXTENSION IF EXISTS vector;
-- ════════════════════════════════════════════════════════════════════
