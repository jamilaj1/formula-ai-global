-- ─────────────────────────────────────────────────────────────────────
-- Signup onboarding fields (2026-05-21)
--
-- Adds two optional self-declared fields on every user profile:
--   • education_field — chemistry / sciences / chemical-engineering /
--                       manufacturing-engineering / pharmacy / ...
--   • profession      — factory-owner / production-manager / lab-supervisor /
--                       researcher / consultant / student / ...
--
-- These power three things:
--   1. Audience segmentation for outbound marketing (who actually uses us?).
--   2. Per-role on-site nudges (a "factory owner" sees different CTAs than
--      a "student" — wire in later from app.js).
--   3. Contributor-trust hints when someone submits a formula.
--
-- The trigger handle_new_user_v2() is updated so that values passed via
-- supabase-js signUp({ options: { data: { ... } } }) land directly in the
-- profile row.  No follow-up UPDATE is needed for the email-signup path.
-- For Google OAuth users we collect the values from a banner on the
-- dashboard and write them client-side (RLS-protected).
--
-- Safe to re-run.  Run once in Supabase → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Schema additions on profiles ───────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS education_field TEXT;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profession TEXT;

-- Cheap indexes for marketing-side filters (e.g. "all factory owners").
CREATE INDEX IF NOT EXISTS idx_profiles_education_field
  ON public.profiles(education_field);
CREATE INDEX IF NOT EXISTS idx_profiles_profession
  ON public.profiles(profession);

-- 2) Update profile-creation trigger to read both fields from the
--    raw_user_meta_data payload that supabase-js sends on signUp.
--    Existing rows keep working: COALESCE preserves nulls if absent.
CREATE OR REPLACE FUNCTION public.handle_new_user_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, plan,
    education_field, profession
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    'starter',
    NULLIF(NEW.raw_user_meta_data ->> 'education_field', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'profession', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    education_field = COALESCE(EXCLUDED.education_field, public.profiles.education_field),
    profession      = COALESCE(EXCLUDED.profession,      public.profiles.profession);

  RETURN NEW;
END;
$$;

-- Trigger itself is unchanged but recreated for safety.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_v2();

-- 3) Convenience function for the dashboard "complete your profile"
--    card (Google OAuth users skip register.html).  Writes the two
--    fields for the currently-authenticated user only.
CREATE OR REPLACE FUNCTION public.set_profile_onboarding(
  edu  TEXT,
  prof TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.profiles
     SET education_field = NULLIF(edu,  ''),
         profession      = NULLIF(prof, '')
   WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_profile_onboarding(TEXT, TEXT)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (only if you want to undo this migration):
--   DROP FUNCTION IF EXISTS public.set_profile_onboarding(TEXT, TEXT);
--   -- Restore the previous trigger body from supabase_phase2_addon.sql.
--   -- The two columns can stay; they don't break anything if empty.
-- ─────────────────────────────────────────────────────────────────────
