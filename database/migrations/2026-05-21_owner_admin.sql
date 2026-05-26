-- ─────────────────────────────────────────────────────────────────────
-- Owner admin: read-only view of signups + segmentation (2026-05-21)
--
-- Adds three SECURITY DEFINER functions that *only* the site owner can
-- call.  They join auth.users with public.profiles so the owner can see:
--   • the most recent signups with email, name, education, profession
--   • aggregate counts (total users, signups today / week / month)
--   • segmentation by education_field and profession
--
-- Why a function (not a view)?  Direct RLS on auth.users is awkward and
-- risky.  A SECURITY DEFINER function lets us read the table with the
-- definer's elevated rights, but inside the function we enforce
-- "auth.jwt() ->> 'email' = owner-email-only" so nothing leaks to
-- anyone else.  The owner email is hard-coded here as it's a constant.
--
-- Run once in Supabase → SQL Editor.  Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

-- Owner identity (kept as a SQL function so we can change it in one place
-- if the owner email ever changes).  Returns TRUE iff the caller is the
-- site owner.
CREATE OR REPLACE FUNCTION public.is_site_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'jamilaj1@gmail.com',
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_site_owner() TO authenticated;

-- 1) Recent signups (most-recent first, up to `limit_n` rows). ─────────
CREATE OR REPLACE FUNCTION public.admin_recent_signups(limit_n INT DEFAULT 100)
RETURNS TABLE (
  id              UUID,
  email           TEXT,
  full_name       TEXT,
  education_field TEXT,
  profession      TEXT,
  plan            TEXT,
  contributor_badge TEXT,
  verified_formulas_count INT,
  pro_credits_months INT,
  created_at      TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_site_owner() THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  RETURN QUERY
    SELECT u.id,
           u.email::TEXT,
           p.full_name,
           p.education_field,
           p.profession,
           p.plan,
           p.contributor_badge,
           p.verified_formulas_count,
           p.pro_credits_months,
           u.created_at,
           u.last_sign_in_at
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
     ORDER BY u.created_at DESC
     LIMIT GREATEST(1, LEAST(limit_n, 1000));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_recent_signups(INT) TO authenticated;

-- 2) Aggregate counts. ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_signup_stats()
RETURNS TABLE (
  total_users          BIGINT,
  signups_today        BIGINT,
  signups_7d           BIGINT,
  signups_30d          BIGINT,
  paid_users           BIGINT,
  pro_credits_users    BIGINT,
  contributors         BIGINT,
  verified_chemists    BIGINT,
  masters              BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_site_owner() THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  RETURN QUERY
    SELECT
      (SELECT COUNT(*) FROM auth.users) AS total_users,
      (SELECT COUNT(*) FROM auth.users
        WHERE created_at >= date_trunc('day', NOW())) AS signups_today,
      (SELECT COUNT(*) FROM auth.users
        WHERE created_at >= NOW() - INTERVAL '7 days') AS signups_7d,
      (SELECT COUNT(*) FROM auth.users
        WHERE created_at >= NOW() - INTERVAL '30 days') AS signups_30d,
      (SELECT COUNT(*) FROM public.profiles
        WHERE plan IS NOT NULL AND plan <> 'free' AND plan <> 'starter') AS paid_users,
      (SELECT COUNT(*) FROM public.profiles
        WHERE pro_credits_months > COALESCE(pro_credits_used, 0)) AS pro_credits_users,
      (SELECT COUNT(*) FROM public.profiles
        WHERE COALESCE(verified_formulas_count, 0) > 0) AS contributors,
      (SELECT COUNT(*) FROM public.profiles
        WHERE COALESCE(verified_formulas_count, 0) >= 50) AS verified_chemists,
      (SELECT COUNT(*) FROM public.profiles
        WHERE COALESCE(verified_formulas_count, 0) >= 200) AS masters;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_signup_stats() TO authenticated;

-- 3) Segmentation by education_field and profession. ──────────────────
CREATE OR REPLACE FUNCTION public.admin_segmentation()
RETURNS TABLE (
  dimension TEXT,   -- 'education_field' or 'profession'
  value     TEXT,
  count     BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_site_owner() THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  RETURN QUERY
    SELECT 'education_field'::TEXT,
           COALESCE(education_field, '(not set)')::TEXT,
           COUNT(*)::BIGINT
      FROM public.profiles
     GROUP BY education_field
     UNION ALL
    SELECT 'profession'::TEXT,
           COALESCE(profession, '(not set)')::TEXT,
           COUNT(*)::BIGINT
      FROM public.profiles
     GROUP BY profession
     ORDER BY 1, 3 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_segmentation() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- HOW TO USE (owner workflow)
--
--   Visit  https://jamilformula.com/admin.html  while signed in as
--   jamilaj1@gmail.com.  The page calls the three RPCs above and renders
--   the dashboard.  Anyone else who tries (or who is signed out) hits
--   "not authorised" and the page shows a friendly "owner only" notice.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.admin_recent_signups(INT);
--   DROP FUNCTION IF EXISTS public.admin_signup_stats();
--   DROP FUNCTION IF EXISTS public.admin_segmentation();
--   DROP FUNCTION IF EXISTS public.is_site_owner();
-- ─────────────────────────────────────────────────────────────────────
