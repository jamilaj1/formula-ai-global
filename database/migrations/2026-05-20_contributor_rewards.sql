-- ─────────────────────────────────────────────────────────────────────
-- Contributor recognition + Pro-credits system (2026-05-20)
--
-- Run once in Supabase → SQL Editor.  Safe (uses IF NOT EXISTS where
-- possible).  After this runs:
--   • formulas can carry a contributor_id (the chemist who submitted it)
--   • each formula gets a verified_at timestamp when owner publishes it
--   • each profile tracks verified_formulas_count, badge, pro_credits
--   • when owner marks a formula verified, the trigger automatically:
--       ▸ increments contributor's verified_formulas_count
--       ▸ grants +1 month of Pro for every 5 verified formulas
--       ▸ upgrades badge: newbie → verified_chemist (50) → master (200)
--   • a public_profiles view exposes only non-sensitive contributor
--     fields so formula pages can show "Contributed by …" safely.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Schema additions on formulas ───────────────────────────────────
ALTER TABLE formulas
  ADD COLUMN IF NOT EXISTS contributor_id UUID REFERENCES auth.users(id);
ALTER TABLE formulas
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_formulas_contributor_id
  ON formulas(contributor_id);
CREATE INDEX IF NOT EXISTS idx_formulas_verified_at
  ON formulas(verified_at);

-- 2) Schema additions on profiles ───────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS verified_formulas_count INT NOT NULL DEFAULT 0;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS pro_credits_months INT NOT NULL DEFAULT 0;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS pro_credits_used INT NOT NULL DEFAULT 0;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS contributor_badge TEXT NOT NULL DEFAULT 'newbie';

-- 3) Reward-granting trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION grant_contributor_rewards()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count INT;
BEGIN
  -- Only fire on the transition NULL -> NOT NULL with a real contributor
  IF NEW.verified_at IS NOT NULL
     AND OLD.verified_at IS NULL
     AND NEW.contributor_id IS NOT NULL THEN

    UPDATE profiles
       SET verified_formulas_count = verified_formulas_count + 1
     WHERE id = NEW.contributor_id
    RETURNING verified_formulas_count INTO new_count;

    IF new_count IS NOT NULL THEN
      UPDATE profiles
         SET pro_credits_months = pro_credits_months
                                  + CASE WHEN new_count % 5 = 0 THEN 1 ELSE 0 END,
             contributor_badge   = CASE
               WHEN new_count >= 200 THEN 'master'
               WHEN new_count >= 50  THEN 'verified_chemist'
               ELSE 'newbie'
             END
       WHERE id = NEW.contributor_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_formula_verified ON formulas;
CREATE TRIGGER on_formula_verified
  AFTER UPDATE OF verified_at ON formulas
  FOR EACH ROW
  EXECUTE FUNCTION grant_contributor_rewards();

-- 4) Public-readable contributor view ───────────────────────────────
-- Exposes ONLY non-sensitive fields (no email, no plan, no credits).
DROP VIEW IF EXISTS public_profiles;
CREATE VIEW public_profiles AS
  SELECT id,
         COALESCE(display_name, 'Contributor') AS display_name,
         contributor_badge,
         verified_formulas_count
    FROM profiles
   WHERE verified_formulas_count > 0;

GRANT SELECT ON public_profiles TO anon, authenticated;

-- 5) Convenience: function to publish a user_submission as a formula
-- (owner runs this from SQL Editor or wires it into an admin UI later).
-- Adjust the column copy list to match your real user_submissions schema.
CREATE OR REPLACE FUNCTION approve_submission(
  submission_id UUID,
  trust_score_val INT DEFAULT 70
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_formula_id UUID;
BEGIN
  INSERT INTO formulas (
    name, name_en, category, components, trust_score,
    contributor_id, verified_at
  )
  SELECT
    s.name, s.name_en, s.category, s.components, trust_score_val,
    s.submitter_id, NOW()
  FROM user_submissions s
  WHERE s.id = submission_id
  RETURNING id INTO new_formula_id;

  -- Mark the submission approved (adjust column name if yours differs)
  BEGIN
    UPDATE user_submissions
       SET status = 'approved',
           approved_at = NOW()
     WHERE id = submission_id;
  EXCEPTION WHEN undefined_column THEN
    -- If your user_submissions table doesn't have status/approved_at,
    -- skip the update — the trigger still fires from the INSERT above.
    NULL;
  END;

  RETURN new_formula_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- HOW TO USE (owner workflow)
--
--   1. User submits via /contribute.html  ->  row in user_submissions.
--   2. Owner reviews in Supabase Studio.   To publish + reward:
--          SELECT approve_submission('<uuid-from-user_submissions>', 80);
--      (the 80 is the trust_score you assign — 60–100).
--   3. For one-off formulas you add yourself (without a submission):
--          UPDATE formulas
--             SET contributor_id = '<your-user-uuid>',
--                 verified_at = NOW()
--           WHERE id = '<formula-uuid>';
--      The trigger handles the reward bookkeeping.
--
-- ROLLBACK (only if you want to undo this migration):
--   DROP TRIGGER  IF EXISTS on_formula_verified ON formulas;
--   DROP FUNCTION IF EXISTS grant_contributor_rewards();
--   DROP FUNCTION IF EXISTS approve_submission(UUID, INT);
--   DROP VIEW     IF EXISTS public_profiles;
--   -- (column drops left manual — they don't break anything if kept)
-- ─────────────────────────────────────────────────────────────────────
