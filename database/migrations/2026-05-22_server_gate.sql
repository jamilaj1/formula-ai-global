-- ════════════════════════════════════════════════════════════════════
-- SERVER-SIDE SUBSCRIPTION GATE + ANTI-SCRAPING (2026-05-22)
-- Phase 1.1 of BUILD_ROADMAP.md
--
-- Problem today
-- -------------
-- The `formulas` table is wide-open to anon. Anyone with the public anon
-- key can `SELECT components FROM formulas LIMIT 10000` and walk away
-- with the entire proprietary library in seconds. The "Pro gate" lives
-- only in client JavaScript — DevTools defeats it in two clicks. This
-- migration moves the gate to the server.
--
-- After this runs
-- ---------------
--   1. `formulas` is RLS-locked. Anon + authenticated cannot SELECT it
--      directly any more. Only the service_role (used by our Worker
--      and FastAPI backend, server-side only) keeps full access.
--   2. A view `public.formulas_public` exposes the SAFE columns
--      (name, category, ratings, applications, description, etc.).
--      Listings, search results, the homepage live counter, etc. all
--      read from this view. RLS does NOT apply because the view is
--      `security_invoker = false` and owned by postgres.
--   3. A SECURITY DEFINER function `public.get_formula(uuid)` returns
--      ONE row. Public columns always; gated columns (components,
--      process_conditions, quality_control, safety_warnings,
--      scientific_basis) ONLY if the caller is paid (subscription
--      tier OR pro_credits balance). `source_*` columns are NEVER
--      returned — they remain owner-only forever.
--   4. A helper function `public.is_paid_or_credits(uuid)` centralises
--      the "is this user paid?" check so client code and server code
--      can never drift apart.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Helper: is this user paid? ──────────────────────────────────
-- Mirrors the client-side check in assets/supabase-client.js so the
-- gate cannot be bypassed by JS tampering.
CREATE OR REPLACE FUNCTION public.is_paid_or_credits(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF check_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = check_user_id
      AND (
        COALESCE(p.plan, 'free') NOT IN ('free', 'starter')
        OR COALESCE(p.pro_credits_months, 0) > COALESCE(p.pro_credits_used, 0)
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_paid_or_credits(UUID) TO anon, authenticated;

-- ── 2. Public view (safe columns only) ─────────────────────────────
-- security_invoker=false (the default in PG <15, explicit here) so the
-- view body runs as its OWNER (postgres) and bypasses the RLS we are
-- about to enable on the underlying table.
DROP VIEW IF EXISTS public.formulas_public CASCADE;
CREATE VIEW public.formulas_public WITH (security_invoker = false) AS
  SELECT
    id,
    name,
    name_en,
    category,
    sub_category,
    form_type,
    description,
    final_properties,         -- end-state pH/viscosity — marketing data
    applications,              -- what the formula is used for — marketing
    is_complete,
    completeness_score,
    trust_score,
    environmental_score,
    cost_score,
    quality_score,
    contributor_id,
    verified_at,
    created_at,
    updated_at
  FROM public.formulas;

GRANT SELECT ON public.formulas_public TO anon, authenticated;

COMMENT ON VIEW public.formulas_public IS
  'Anon-safe projection of formulas — excludes components, process_conditions, '
  'quality_control, safety_warnings, scientific_basis, and all source_* columns. '
  'Used by listings, search results, the homepage live counter, etc.';

-- ── 3. The gated single-row reader ─────────────────────────────────
-- Returns ONE row as JSONB. Public columns always. Gated columns only
-- if the caller is paid. Source columns NEVER returned.
CREATE OR REPLACE FUNCTION public.get_formula(formula_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  paid     BOOLEAN;
  row_obj  JSONB;
BEGIN
  -- Start with the full row, then strip what the user is not entitled to.
  SELECT to_jsonb(f) INTO row_obj
    FROM public.formulas f
    WHERE f.id = formula_id;

  IF row_obj IS NULL THEN
    RETURN NULL;  -- formula not found
  END IF;

  -- Source-of-truth fields are ALWAYS stripped (owner-only, never client).
  row_obj := row_obj
    - 'source_type'
    - 'source_title'
    - 'source_author'
    - 'source_year'
    - 'source_page'
    - 'source_url'
    - 'source_doi'
    - 'source_patent_number'
    - 'source_confidence';

  paid := public.is_paid_or_credits(auth.uid());

  IF NOT paid THEN
    -- Strip the proprietary parts — gate them behind a paid plan or credits.
    row_obj := row_obj
      - 'components'
      - 'process_conditions'
      - 'quality_control'
      - 'safety_warnings'
      - 'scientific_basis';
    -- Add a flag so the client can render a "Unlock with Pro" hint.
    row_obj := row_obj || jsonb_build_object('_gated', TRUE);
  ELSE
    row_obj := row_obj || jsonb_build_object('_gated', FALSE);
  END IF;

  RETURN row_obj;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_formula(UUID) TO anon, authenticated;

COMMENT ON FUNCTION public.get_formula(UUID) IS
  'Single-formula reader. Public columns always; components / process / '
  'quality_control / safety_warnings / scientific_basis only when '
  'is_paid_or_credits(auth.uid()) is TRUE. source_* never returned.';

-- ── 4. Lock down direct table access ───────────────────────────────
-- Enable RLS. With NO permissive SELECT policy, anon/authenticated
-- queries against `formulas` directly are denied.
ALTER TABLE public.formulas ENABLE ROW LEVEL SECURITY;

-- Drop any prior permissive policies we might have created in the past.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'formulas'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.formulas', pol.policyname);
  END LOOP;
END;
$$;

-- Belt + suspenders: also revoke the bare table grants.
REVOKE ALL    ON public.formulas FROM anon, authenticated;
GRANT  SELECT ON public.formulas TO postgres;   -- preserve owner read
-- service_role bypasses RLS by design (Supabase default), so the Worker
-- and FastAPI backend keep full access via the server-side service key.

-- ── 5. Quick verification ──────────────────────────────────────────
-- After running, in a fresh anon session in SQL Editor (or via REST):
--   SELECT id FROM public.formulas LIMIT 1;                  -- denied
--   SELECT id FROM public.formulas_public LIMIT 1;           -- one row
--   SELECT public.get_formula((SELECT id FROM public.formulas_public LIMIT 1));
--      -> JSON object WITHOUT components (because anon != paid).
-- Then sign in as a paid user and call get_formula again — components
-- and the other gated fields appear.

-- ── ROLLBACK (if needed) ───────────────────────────────────────────
-- ALTER TABLE public.formulas DISABLE ROW LEVEL SECURITY;
-- GRANT SELECT ON public.formulas TO anon, authenticated;
-- DROP FUNCTION IF EXISTS public.get_formula(UUID);
-- DROP FUNCTION IF EXISTS public.is_paid_or_credits(UUID);
-- DROP VIEW     IF EXISTS public.formulas_public;
-- ════════════════════════════════════════════════════════════════════
