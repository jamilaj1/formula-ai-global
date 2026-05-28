-- ════════════════════════════════════════════════════════════════════
-- ENTERPRISE PLAN + enterprise_details + enterprise_leads
-- Phase 3.1 + 3.2 of BUILD_ROADMAP.md (2026-05-28)
--
-- What this builds
-- ----------------
--   1. `enterprise_details` — 1:1 child of profiles for companies on
--      the Enterprise plan. Holds company name, factory location,
--      industry sector, monthly quota override, API access flag.
--   2. `enterprise_leads` — capture form submissions from
--      enterprise.html before a sale closes. Owner reviews in admin.
--   3. RLS so each company sees only its own row.
--   4. pg_net trigger that emails the owner the moment a new lead
--      lands.
--   5. Helper view `enterprise_profile` that joins profiles +
--      enterprise_details so the Worker / admin can pull both in one
--      query.
--
-- profiles.plan: already TEXT (no enum to extend). 'enterprise' is
-- just one more valid value. is_paid_or_credits() in 2026-05-22 already
-- accepts anything that isn't 'free' or 'starter' as paid — so no SQL
-- change needed there for unlocking gated formulas to enterprise users.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. enterprise_details (1:1 child of profiles) ─────────────────
CREATE TABLE IF NOT EXISTS public.enterprise_details (
  user_id            UUID PRIMARY KEY
                     REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_name       TEXT NOT NULL,
  factory_location   TEXT,          -- e.g. "Accra, Ghana"
  industry_sector    TEXT,          -- 'cosmetics' | 'cleaning' | 'food' …
  monthly_quota      INTEGER,       -- overrides PLAN_DAILY_LIMITS for this account
  api_access_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Account manager assigned (owner sets in admin). NULL until assigned.
  account_manager    TEXT,
  -- Free-form notes the owner keeps for themselves.
  owner_notes        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enterprise_details_company_idx
  ON public.enterprise_details (lower(company_name));

COMMENT ON TABLE public.enterprise_details IS
  'Phase 3 Enterprise B2B accounts. 1:1 with profiles for users whose plan=''enterprise''.';

-- ── 2. enterprise_leads (intake before purchase) ──────────────────
CREATE TABLE IF NOT EXISTS public.enterprise_leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Anon submission is allowed; user_id is NULL until owner converts
  -- the lead into a real enterprise_details row.
  user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name           TEXT NOT NULL,
  email               TEXT NOT NULL,
  company             TEXT NOT NULL,
  role                TEXT,                -- "VP R&D", "Plant manager", …
  team_size           TEXT,                -- "1-10" | "11-50" | "51-200" | "200+"
  industry            TEXT,
  use_case            TEXT,                -- free-form: what they want to do
  budget_per_month_usd INTEGER,            -- self-reported, just a signal
  status              TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'contacted', 'demo_booked', 'negotiating', 'won', 'lost')),
  owner_notes         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS enterprise_leads_status_idx
  ON public.enterprise_leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS enterprise_leads_email_idx
  ON public.enterprise_leads (lower(email), created_at DESC);

COMMENT ON TABLE public.enterprise_leads IS
  'Phase 3 Enterprise sales pipeline. Capture form on enterprise.html lands here. Owner converts winning leads into enterprise_details + profile upgrade.';

-- ── 3. updated_at triggers ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._enterprise_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS enterprise_details_touch ON public.enterprise_details;
CREATE TRIGGER enterprise_details_touch
  BEFORE UPDATE ON public.enterprise_details
  FOR EACH ROW EXECUTE FUNCTION public._enterprise_touch_updated_at();

DROP TRIGGER IF EXISTS enterprise_leads_touch ON public.enterprise_leads;
CREATE TRIGGER enterprise_leads_touch
  BEFORE UPDATE ON public.enterprise_leads
  FOR EACH ROW EXECUTE FUNCTION public._enterprise_touch_updated_at();

-- ── 4. RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.enterprise_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_leads   ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE pol RECORD; BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
              WHERE schemaname='public'
                AND tablename IN ('enterprise_details', 'enterprise_leads')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   pol.policyname,
                   CASE WHEN pol.policyname LIKE 'enterprise_details_%'
                        THEN 'enterprise_details'
                        ELSE 'enterprise_leads' END);
  END LOOP;
END $$;

-- enterprise_details: signed-in user reads OWN row only. No INSERT
-- from clients — only service_role provisions a row when a lead
-- converts. UPDATE: the user can edit their own company_name +
-- factory_location etc., but cannot touch monthly_quota or api flag.
CREATE POLICY "enterprise_details_select_own"
  ON public.enterprise_details FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "enterprise_details_update_own_self_fields"
  ON public.enterprise_details FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
-- (For finer column-level control, owner-side scripts use service_role
--  to write monthly_quota / api_access_enabled / account_manager.)

-- enterprise_leads: anon INSERT (so the website form works), no SELECT
-- (the lead never sees other leads), service_role for admin.
CREATE POLICY "enterprise_leads_insert_anon"
  ON public.enterprise_leads FOR INSERT
  WITH CHECK (TRUE);

-- ── 5. Helper view: profile + enterprise_details join ─────────────
DROP VIEW IF EXISTS public.enterprise_profile;
CREATE VIEW public.enterprise_profile WITH (security_invoker = true) AS
  SELECT
    p.id              AS user_id,
    p.email,
    p.full_name,
    p.plan,
    p.pro_credits_months,
    p.pro_credits_used,
    ed.company_name,
    ed.factory_location,
    ed.industry_sector,
    ed.monthly_quota,
    ed.api_access_enabled,
    ed.account_manager,
    ed.created_at      AS enterprise_since
  FROM public.profiles p
  LEFT JOIN public.enterprise_details ed ON ed.user_id = p.id
  WHERE p.plan = 'enterprise';

GRANT SELECT ON public.enterprise_profile TO authenticated;

COMMENT ON VIEW public.enterprise_profile IS
  'Read-only view joining profiles + enterprise_details for users on the Enterprise plan.';

-- ── 6. pg_net trigger: notify owner when a new lead arrives ──────
CREATE OR REPLACE FUNCTION public.notify_owner_on_enterprise_lead()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net AS $$
DECLARE
  cfg          RECORD;
  subject_str  TEXT;
  body_html    TEXT;
  uc_snip      TEXT;
BEGIN
  SELECT * INTO cfg FROM public._owner_email_config();
  IF cfg.resend_api_key IS NULL
     OR cfg.resend_api_key = ''
     OR cfg.resend_api_key LIKE 're_PASTE%' THEN
    RETURN NEW;
  END IF;

  uc_snip := CASE WHEN length(COALESCE(NEW.use_case, '')) > 500
                  THEN substring(NEW.use_case, 1, 500) || '…'
                  ELSE COALESCE(NEW.use_case, '(not provided)') END;

  subject_str := format(
    '[Enterprise lead] %s — %s%s',
    NEW.company,
    NEW.full_name,
    CASE WHEN NEW.team_size IS NOT NULL
         THEN ' (' || NEW.team_size || ')'
         ELSE '' END
  );

  body_html := format(
       '<div style="font-family:Arial,sans-serif; max-width:640px; margin:0 auto; color:#111827; padding:24px;">'
    || '<h2 style="margin:0 0 12px;">🏭 New Enterprise lead</h2>'
    || '<table style="width:100%%; border-collapse:collapse; background:#f9fafb; border-radius:8px;">'
    || '<tr><td style="padding:10px 14px; font-weight:700; width:160px;">Company</td><td style="padding:10px 14px;">%s</td></tr>'
    || '<tr><td style="padding:10px 14px; font-weight:700;">Contact</td><td style="padding:10px 14px;">%s &lt;<a href="mailto:%s">%s</a>&gt;</td></tr>'
    || '<tr><td style="padding:10px 14px; font-weight:700;">Role</td><td style="padding:10px 14px;">%s</td></tr>'
    || '<tr><td style="padding:10px 14px; font-weight:700;">Team size</td><td style="padding:10px 14px;">%s</td></tr>'
    || '<tr><td style="padding:10px 14px; font-weight:700;">Industry</td><td style="padding:10px 14px;">%s</td></tr>'
    || '<tr><td style="padding:10px 14px; font-weight:700;">Budget/mo (USD)</td><td style="padding:10px 14px;">%s</td></tr>'
    || '</table>'
    || '<h3 style="margin:20px 0 8px;">Use case</h3>'
    || '<div style="white-space:pre-wrap; background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:14px; font-size:14px; line-height:1.6;">%s</div>'
    || '<p style="margin-top:22px;"><a href="https://jamilformula.com/admin.html#enterprise/%s" style="display:inline-block; background:#00cc6a; color:#000; padding:12px 22px; text-decoration:none; border-radius:8px; font-weight:700;">Open in admin →</a></p>'
    || '</div>',
    REPLACE(NEW.company, '<', '&lt;'),
    REPLACE(NEW.full_name, '<', '&lt;'),
    NEW.email, REPLACE(NEW.email, '<', '&lt;'),
    COALESCE(REPLACE(NEW.role, '<', '&lt;'), '—'),
    COALESCE(NEW.team_size, '—'),
    COALESCE(NEW.industry, '—'),
    CASE WHEN NEW.budget_per_month_usd IS NULL THEN '(not provided)'
         ELSE '$' || to_char(NEW.budget_per_month_usd, 'FM999,999,999') END,
    REPLACE(REPLACE(uc_snip, '<', '&lt;'), E'\n', '<br>'),
    NEW.id
  );

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.resend_api_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'from',     'Formula AI Enterprise <' || cfg.from_email || '>',
      'to',       jsonb_build_array(cfg.owner_email),
      'reply_to', NEW.email,
      'subject',  subject_str,
      'html',     body_html
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_owner_on_enterprise_lead failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enterprise_leads_notify_owner ON public.enterprise_leads;
CREATE TRIGGER enterprise_leads_notify_owner
  AFTER INSERT ON public.enterprise_leads
  FOR EACH ROW EXECUTE FUNCTION public.notify_owner_on_enterprise_lead();

-- ── Verification ───────────────────────────────────────────────────
-- INSERT INTO public.enterprise_leads (full_name, email, company, role, team_size, industry, use_case)
-- VALUES ('Test User', 'test@acme.com', 'Acme Industries', 'VP R&D', '51-200', 'cosmetics',
--         'We want to centralise our R&D library + reduce time-to-market for new product launches.');
-- SELECT id, company, status, created_at FROM public.enterprise_leads ORDER BY created_at DESC LIMIT 1;
-- ════════════════════════════════════════════════════════════════════
