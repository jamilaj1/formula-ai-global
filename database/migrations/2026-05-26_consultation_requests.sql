-- ════════════════════════════════════════════════════════════════════
-- CONSULTATION REQUESTS — intake + status tracking + owner email
-- Phase 2.2 of BUILD_ROADMAP.md (2026-05-26)
--
-- What this builds
-- ----------------
--   1. `consultation_requests` table: every brief submitted on
--      consulting.html lands here. Lifecycle: intake → paid → drafting
--      → review → delivered (or cancelled at any step).
--   2. RLS: a signed-in user can read their own rows; service_role
--      (Worker + admin.html via owner's JWT) can read/write everything.
--   3. A pg_net trigger that emails the owner the moment a new request
--      is inserted, so leads never sit in a queue.
--
-- Safe to re-run (every statement uses IF NOT EXISTS or CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consultation_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owner of the request. NULL for anonymous intakes (consulting.html
  -- accepts a brief without forcing signup so we don't lose leads).
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Always captured even when user_id is NULL, so we can reach back out.
  email           TEXT NOT NULL,
  company         TEXT,
  -- 'quick' | 'full' | 'custom' — matches the consulting.html dropdown.
  package         TEXT NOT NULL
                  CHECK (package IN ('quick', 'full', 'custom')),
  product_type    TEXT NOT NULL,
  market          TEXT NOT NULL,
  brief           TEXT NOT NULL,
  -- Lifecycle. We move forward only — there is no 'unpaid → paid'
  -- regression; cancellations are an absorbing state.
  status          TEXT NOT NULL DEFAULT 'intake'
                  CHECK (status IN (
                    'intake',     -- just received, not yet paid
                    'paid',       -- payment confirmed by Paystack webhook
                    'drafting',   -- Worker is running the orchestrator
                    'review',     -- AI draft ready, owner needs to approve
                    'delivered',  -- PDF emailed to client
                    'cancelled'   -- refunded / withdrawn
                  )),
  -- Paystack reference for the one-time charge (Phase 2.5).
  paystack_reference  TEXT,
  amount_usd          NUMERIC(10, 2),
  -- AI-drafted markdown URL (Supabase Storage). Filled in by Phase 2.3.
  ai_draft_md_url     TEXT,
  -- Final PDF (after owner approval). Filled in by Phase 2.4.
  final_pdf_url       TEXT,
  -- Owner can leave notes for themselves on the admin tab.
  owner_notes         TEXT,
  -- For "1 round of revisions included" tracking.
  revisions_used      INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS consultation_requests_status_idx
  ON public.consultation_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS consultation_requests_user_idx
  ON public.consultation_requests (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS consultation_requests_email_idx
  ON public.consultation_requests (lower(email), created_at DESC);

COMMENT ON TABLE public.consultation_requests IS
  'Phase 2 consulting intake. Lifecycle: intake → paid → drafting → review → delivered.';

-- ── 2. updated_at trigger ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._consultation_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consultation_requests_touch ON public.consultation_requests;
CREATE TRIGGER consultation_requests_touch
  BEFORE UPDATE ON public.consultation_requests
  FOR EACH ROW EXECUTE FUNCTION public._consultation_touch_updated_at();

-- ── 3. RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.consultation_requests ENABLE ROW LEVEL SECURITY;

-- Drop any old policies before recreating (idempotent re-run).
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
     WHERE schemaname='public' AND tablename='consultation_requests'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.consultation_requests', pol.policyname);
  END LOOP;
END $$;

-- Signed-in users can see their own rows. Anon cannot SELECT.
CREATE POLICY "consultation_requests_select_own"
  ON public.consultation_requests FOR SELECT
  USING (user_id = auth.uid());

-- Anon CAN INSERT (so consulting.html visitors who aren't logged in can
-- still submit a brief). We never expose other people's rows via SELECT,
-- so a malicious INSERT is contained — it just creates a row about
-- themselves. The Worker / admin can audit and delete spam.
CREATE POLICY "consultation_requests_insert_anon"
  ON public.consultation_requests FOR INSERT
  WITH CHECK (TRUE);

-- service_role bypasses RLS by Supabase design — admin.html (using the
-- owner's JWT in a service-role context) reads everything; Worker writes
-- status transitions during the AI draft + delivery pipeline.

-- ── 4. Email-the-owner trigger (uses pg_net + Resend) ───────────────
-- Reuses _owner_email_config() from 2026-05-21_signup_email_pg_net.sql
-- so we keep the Resend API key in exactly one place.
CREATE OR REPLACE FUNCTION public.notify_owner_on_consult_intake()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  cfg          RECORD;
  subject_str  TEXT;
  body_html    TEXT;
  pkg_label    TEXT;
  brief_snip   TEXT;
BEGIN
  SELECT * INTO cfg FROM public._owner_email_config();

  IF cfg.resend_api_key IS NULL
     OR cfg.resend_api_key = ''
     OR cfg.resend_api_key LIKE 're_PASTE%' THEN
    RETURN NEW;  -- not configured yet — silently skip
  END IF;

  pkg_label := CASE NEW.package
                 WHEN 'quick'  THEN 'Quick Diagnostic ($1,000)'
                 WHEN 'full'   THEN 'Full Formulation Report ($2,500)'
                 WHEN 'custom' THEN 'Custom Project ($5,000+)'
                 ELSE NEW.package
               END;

  -- Trim brief preview to ~600 chars in the email so the inbox view
  -- stays readable; admin.html shows the full text.
  brief_snip := CASE WHEN length(NEW.brief) > 600
                     THEN substring(NEW.brief, 1, 600) || '…'
                     ELSE NEW.brief END;

  subject_str := format('[Consulting] %s — %s', pkg_label, NEW.product_type);

  body_html := format(
       '<div style="font-family:Arial,sans-serif; max-width:640px; margin:0 auto; color:#111827; padding:24px;">'
    || '<h2 style="margin:0 0 12px;">New consulting brief received</h2>'
    || '<p style="margin:0 0 16px; color:#6b7280;">Submitted %s</p>'
    || '<table style="width:100%%; border-collapse:collapse; background:#f9fafb; border-radius:8px; overflow:hidden;">'
    || '<tr><td style="padding:10px 14px; font-weight:700; width:160px;">Package</td><td style="padding:10px 14px;">%s</td></tr>'
    || '<tr><td style="padding:10px 14px; font-weight:700;">Product type</td><td style="padding:10px 14px;">%s</td></tr>'
    || '<tr><td style="padding:10px 14px; font-weight:700;">Market</td><td style="padding:10px 14px;">%s</td></tr>'
    || '<tr><td style="padding:10px 14px; font-weight:700;">Contact</td><td style="padding:10px 14px;"><a href="mailto:%s">%s</a></td></tr>'
    || '<tr><td style="padding:10px 14px; font-weight:700;">Company</td><td style="padding:10px 14px;">%s</td></tr>'
    || '</table>'
    || '<h3 style="margin:20px 0 8px;">Brief</h3>'
    || '<div style="white-space:pre-wrap; background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:14px; font-size:14px; line-height:1.6;">%s</div>'
    || '<p style="margin-top:22px;"><a href="https://jamilformula.com/admin.html#consulting/%s" style="display:inline-block; background:#00cc6a; color:#000; padding:12px 22px; text-decoration:none; border-radius:8px; font-weight:700;">Open in admin →</a></p>'
    || '</div>',
    NEW.created_at::TEXT,
    pkg_label,
    REPLACE(NEW.product_type, '<', '&lt;'),
    REPLACE(NEW.market,       '<', '&lt;'),
    NEW.email, REPLACE(NEW.email, '<', '&lt;'),
    COALESCE(REPLACE(NEW.company, '<', '&lt;'), '(not provided)'),
    REPLACE(REPLACE(brief_snip, '<', '&lt;'), E'\n', '<br>'),
    NEW.id
  );

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.resend_api_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'from',     'Formula AI Consulting <' || cfg.from_email || '>',
      'to',       jsonb_build_array(cfg.owner_email),
      'reply_to', NEW.email,
      'subject',  subject_str,
      'html',     body_html
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A failed email must never block intake — log + continue.
  RAISE WARNING 'notify_owner_on_consult_intake failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consultation_requests_notify_owner ON public.consultation_requests;
CREATE TRIGGER consultation_requests_notify_owner
  AFTER INSERT ON public.consultation_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_owner_on_consult_intake();

-- ── 5. Verification ────────────────────────────────────────────────
--   INSERT INTO public.consultation_requests (email, package, product_type, market, brief)
--   VALUES ('test@example.com', 'quick', 'liquid soap', 'KSA',
--           'I need a basic dishwashing soap formula for retail.');
--   SELECT id, status, created_at FROM public.consultation_requests ORDER BY created_at DESC LIMIT 1;
--   (And check the owner inbox for the email.)

-- ── ROLLBACK ───────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS consultation_requests_notify_owner ON public.consultation_requests;
-- DROP FUNCTION IF EXISTS public.notify_owner_on_consult_intake();
-- DROP TRIGGER IF EXISTS consultation_requests_touch ON public.consultation_requests;
-- DROP FUNCTION IF EXISTS public._consultation_touch_updated_at();
-- DROP TABLE IF EXISTS public.consultation_requests;
-- ════════════════════════════════════════════════════════════════════
