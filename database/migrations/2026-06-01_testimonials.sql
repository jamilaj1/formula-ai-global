-- ════════════════════════════════════════════════════════════════════
-- TESTIMONIALS — real, user-submitted, owner-moderated social proof
-- Phase D3 of ROADMAP_TO_10.md (2026-06-01)
--
-- Why
-- ---
-- The homepage testimonials were fabricated placeholders (now hidden).
-- Real proof must come from real users. This table captures testimonials
-- submitted by signed-in users; the owner approves them in admin.html;
-- only APPROVED ones render on the homepage (served by the Worker via
-- service_role, so RLS on the base table stays strict).
--
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE throughout).
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.testimonials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Display fields (user-editable; default name from their profile).
  name         TEXT NOT NULL,
  role         TEXT,
  company      TEXT,
  quote        TEXT NOT NULL CHECK (char_length(quote) BETWEEN 10 AND 600),
  rating       INT  NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  -- Moderation lifecycle. Nothing shows publicly until 'approved'.
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Owner can pin standout quotes to the top of the homepage.
  featured     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS testimonials_status_idx
  ON public.testimonials (status, featured DESC, approved_at DESC);
CREATE INDEX IF NOT EXISTS testimonials_user_idx
  ON public.testimonials (user_id, created_at DESC);

-- One pending/approved testimonial per user keeps the wall honest (a user
-- can't spam 50 quotes). They can resubmit only after a rejection.
CREATE UNIQUE INDEX IF NOT EXISTS testimonials_one_active_per_user
  ON public.testimonials (user_id)
  WHERE status IN ('pending', 'approved');

COMMENT ON TABLE public.testimonials IS
  'D3 real social proof. user submits → owner approves in admin → Worker serves approved-only to the homepage.';

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
     WHERE schemaname='public' AND tablename='testimonials'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.testimonials', pol.policyname);
  END LOOP;
END $$;

-- A signed-in user can submit their own testimonial.
CREATE POLICY "testimonials_insert_own" ON public.testimonials FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- A user can read their own (to see status). Public read of APPROVED rows
-- is intentionally NOT granted here — the Worker serves approved testimonials
-- with the service_role key, so we never expose pending/rejected content or
-- other users' rows to the anon client.
CREATE POLICY "testimonials_select_own" ON public.testimonials FOR SELECT
  USING (user_id = auth.uid());

-- service_role bypasses RLS (Worker: approved list for homepage + owner
-- moderation in admin.html).

-- ── Verification ────────────────────────────────────────────────────
--   INSERT INTO public.testimonials (user_id, name, quote)
--     VALUES (auth.uid(), 'Test User', 'This saved me hours in the lab.');
--   SELECT id, status FROM public.testimonials WHERE user_id = auth.uid();

-- ── ROLLBACK ────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.testimonials;
-- ════════════════════════════════════════════════════════════════════
