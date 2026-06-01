-- ════════════════════════════════════════════════════════════════════
-- ACTIVATION RATE — the "aha" metric for the Financials dashboard
-- Phase D2 of ROADMAP_TO_10.md (2026-06-01)
--
-- Activation = % of signed-up users who made their FIRST AI call
-- (api_usage row) within 24h of registering. It's the single best early
-- signal that the product delivers value — far more predictive than raw
-- sign-ups.
--
-- NOTE on caller_id: the Worker stores signed-in users as 'user:<uuid>'
-- (auth.js) and guests as 'ip:<addr>'. So we match on 'user:' || id.
--
-- service_role only. The /be/admin/financials endpoint degrades to null
-- if this RPC is absent, so deploying the Worker first is safe.
--
-- Safe to re-run (CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.activation_rate(days INT DEFAULT 90)
RETURNS TABLE (eligible BIGINT, activated BIGINT, pct NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cohort AS (
    SELECT p.id, p.created_at
    FROM public.profiles p
    WHERE p.created_at >= NOW() - make_interval(days => GREATEST(1, LEAST(days, 365)))
  ),
  firsts AS (
    SELECT
      c.created_at AS signed_up,
      (SELECT MIN(u.created_at)
         FROM public.api_usage u
        WHERE u.caller_id = 'user:' || c.id::text) AS first_use
    FROM cohort c
  )
  SELECT
    COUNT(*) AS eligible,
    COUNT(*) FILTER (
      WHERE first_use IS NOT NULL
        AND first_use <= signed_up + INTERVAL '24 hours'
    ) AS activated,
    ROUND(
      100.0 * COUNT(*) FILTER (
        WHERE first_use IS NOT NULL
          AND first_use <= signed_up + INTERVAL '24 hours'
      ) / NULLIF(COUNT(*), 0),
      1
    ) AS pct
  FROM firsts;
$$;

REVOKE EXECUTE ON FUNCTION public.activation_rate(INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.activation_rate(INT) TO service_role;

-- Verify:  SELECT * FROM public.activation_rate(90);
-- ROLLBACK: DROP FUNCTION IF EXISTS public.activation_rate(INT);
-- ════════════════════════════════════════════════════════════════════
