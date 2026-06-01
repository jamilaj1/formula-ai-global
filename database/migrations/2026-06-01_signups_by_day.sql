-- ════════════════════════════════════════════════════════════════════
-- SIGNUPS BY DAY — time-series for the admin Financials dashboard
-- Phase E3 of ROADMAP_TO_10.md (2026-06-01)
--
-- Returns a COMPLETE daily series (zero-filled) of profile sign-ups for
-- the last N days, so the dashboard can draw a trend chart without the
-- PostgREST 1000-row cap or client-side bucketing. service_role only
-- (the Worker's /be/admin/financials calls it; owner-gated upstream).
--
-- The financials endpoint degrades gracefully if this RPC is absent, so
-- it is safe to deploy the Worker before running this migration.
--
-- Safe to re-run (CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.signups_by_day(days INT DEFAULT 30)
RETURNS TABLE (day DATE, n BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d::date AS day,
    COUNT(p.id) AS n
  FROM generate_series(
         (NOW() - make_interval(days => GREATEST(1, LEAST(days, 90))))::date,
         NOW()::date,
         INTERVAL '1 day'
       ) AS d
  LEFT JOIN public.profiles p
         ON p.created_at::date = d::date
  GROUP BY d::date
  ORDER BY d::date;
$$;

REVOKE EXECUTE ON FUNCTION public.signups_by_day(INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.signups_by_day(INT) TO service_role;

-- Verify:  SELECT * FROM public.signups_by_day(30);
-- ROLLBACK: DROP FUNCTION IF EXISTS public.signups_by_day(INT);
-- ════════════════════════════════════════════════════════════════════
