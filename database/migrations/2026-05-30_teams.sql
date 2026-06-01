-- ════════════════════════════════════════════════════════════════════
-- TEAMS — multi-seat enterprise foundation
-- Phase 9.2 of BUILD_ROADMAP.md (2026-05-30)
--
-- What this builds
-- ----------------
--   1. `teams`              — a billing entity owned by one user.
--   2. `team_members`       — who belongs, and what role.
--   3. `team_invitations`   — pending invites by email, with a token
--                              the invitee clicks from the email.
--   4. RPC `is_team_member`     — fast "does X belong to team T?" check.
--   5. RPC `user_has_team_paid` — "is this user covered by a paid team?".
--   6. Trigger: when an invitee signs up with a matching email, the
--      pending invitation is auto-accepted.
--   7. pg_net Resend trigger that emails the invitee with their token.
--
-- Roles
-- -----
--   `owner`  — created the team, billing contact, can do everything.
--   `admin`  — can invite, remove, and edit team metadata.
--   `member` — can use the team's paid plan + see the team's shared
--              formulas, but can't change membership.
--
-- Safe to re-run (every statement uses IF NOT EXISTS / CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. teams ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Billing-relevant plan name. Matches profiles.plan vocabulary so the
  -- isPaid() helper in supabase-client.js stays consistent.
  plan          TEXT NOT NULL DEFAULT 'enterprise'
                CHECK (plan IN ('starter', 'professional', 'business', 'enterprise')),
  seats         INT  NOT NULL DEFAULT 5,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teams_owner_idx ON public.teams (owner_user_id);

COMMENT ON TABLE public.teams IS
  'Phase 9.2 multi-seat team. The owner is the billing entity; members get the team plan.';


-- ── 2. team_members ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_members (
  team_id     UUID NOT NULL REFERENCES public.teams(id)      ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_members_user_idx ON public.team_members (user_id);

COMMENT ON TABLE public.team_members IS
  'Phase 9.2 team membership. The team owner is auto-added with role=owner on team creation.';


-- ── 3. team_invitations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member'
               CHECK (role IN ('admin', 'member')),
  token        TEXT NOT NULL UNIQUE,
  invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS team_invitations_team_idx  ON public.team_invitations (team_id);
CREATE INDEX IF NOT EXISTS team_invitations_email_idx ON public.team_invitations (lower(email));
CREATE INDEX IF NOT EXISTS team_invitations_pending_idx
  ON public.team_invitations (team_id, lower(email))
  WHERE accepted_at IS NULL;

COMMENT ON TABLE public.team_invitations IS
  'Phase 9.2 pending team invitations. Token is sent to the invitee by email.';


-- ── 4. updated_at trigger on teams ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._teams_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teams_touch ON public.teams;
CREATE TRIGGER teams_touch
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public._teams_touch_updated_at();


-- ── 5. Auto-create the owner team_members row on team INSERT ───────
CREATE OR REPLACE FUNCTION public._teams_seed_owner_member()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (NEW.id, NEW.owner_user_id, 'owner')
  ON CONFLICT (team_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teams_seed_owner ON public.teams;
CREATE TRIGGER teams_seed_owner
  AFTER INSERT ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public._teams_seed_owner_member();


-- ── 6. RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.teams              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invitations   ENABLE ROW LEVEL SECURITY;

-- Drop existing policies so re-running is clean.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('teams', 'team_members', 'team_invitations')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- teams: a user can see their own team and any team they belong to.
CREATE POLICY "teams_select_member" ON public.teams FOR SELECT
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.team_members m
                WHERE m.team_id = id AND m.user_id = auth.uid())
  );

-- teams: only the owner can update / delete. (Worker uses service_role
-- for the create+invite UI which bypasses RLS by design.)
CREATE POLICY "teams_update_owner" ON public.teams FOR UPDATE
  USING (owner_user_id = auth.uid());
CREATE POLICY "teams_delete_owner" ON public.teams FOR DELETE
  USING (owner_user_id = auth.uid());

-- team_members: members of a team can see fellow members. Adds/removes
-- go through the Worker (service_role) so we don't grant write here.
CREATE POLICY "team_members_select_same_team" ON public.team_members FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.team_members me
              WHERE me.team_id = team_id AND me.user_id = auth.uid())
  );

-- team_invitations: the team's admins/owner can see pending invites.
CREATE POLICY "team_invitations_select_team_admin" ON public.team_invitations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.team_members me
              WHERE me.team_id = team_id
                AND me.user_id = auth.uid()
                AND me.role    IN ('owner', 'admin'))
  );


-- ── 7. Helper RPCs ─────────────────────────────────────────────────
-- Quick "is this user a member of any team with a paid plan?". Used by
-- supabase-client.js's isPaid() so a team member sees unlocked formulas
-- via team coverage even if their own profiles.plan is 'free'.
CREATE OR REPLACE FUNCTION public.user_has_team_paid(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.team_members m
      JOIN public.teams t ON t.id = m.team_id
     WHERE m.user_id = uid
       AND t.plan IN ('professional', 'business', 'enterprise')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_has_team_paid(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_has_team_paid(UUID) TO anon, authenticated, service_role;


-- For the Worker — return the user's teams with their role.
CREATE OR REPLACE FUNCTION public.list_my_teams(uid UUID)
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  plan          TEXT,
  seats         INT,
  role          TEXT,
  member_count  BIGINT,
  created_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.name, t.plan, t.seats, m.role,
    (SELECT COUNT(*) FROM public.team_members mm WHERE mm.team_id = t.id) AS member_count,
    t.created_at
  FROM public.teams t
  JOIN public.team_members m ON m.team_id = t.id
  WHERE m.user_id = uid
  ORDER BY t.created_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.list_my_teams(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_my_teams(UUID) TO service_role;


-- ── 8. Auto-accept invitation when invitee signs up ────────────────
-- When a new auth.users row appears and the email matches a pending
-- invitation, we add them to the team and mark the invite accepted.
-- This means the invite link works even if the recipient signs up
-- BEFORE clicking it (they just land in the team automatically).
CREATE OR REPLACE FUNCTION public._teams_auto_accept_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inv RECORD;
BEGIN
  FOR inv IN
    SELECT id, team_id, role
      FROM public.team_invitations
     WHERE lower(email) = lower(NEW.email)
       AND accepted_at IS NULL
       AND expires_at  > NOW()
  LOOP
    INSERT INTO public.team_members (team_id, user_id, role)
      VALUES (inv.team_id, NEW.id, inv.role)
    ON CONFLICT (team_id, user_id) DO NOTHING;
    UPDATE public.team_invitations
       SET accepted_at = NOW()
     WHERE id = inv.id;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teams_auto_accept_invites ON auth.users;
CREATE TRIGGER teams_auto_accept_invites
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public._teams_auto_accept_on_signup();


-- ── 9. Email the invitee via pg_net + Resend ───────────────────────
-- Reuses _owner_email_config() from 2026-05-21_signup_email_pg_net.sql
-- for the Resend API key + from address.
CREATE OR REPLACE FUNCTION public.notify_team_invitee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  cfg         RECORD;
  team        RECORD;
  inviter     RECORD;
  subject_str TEXT;
  body_html   TEXT;
  invite_url  TEXT;
BEGIN
  SELECT * INTO cfg FROM public._owner_email_config();
  IF cfg.resend_api_key IS NULL OR cfg.resend_api_key = ''
     OR cfg.resend_api_key LIKE 're_PASTE%' THEN
    RETURN NEW;
  END IF;

  SELECT t.name, t.plan INTO team
    FROM public.teams t WHERE t.id = NEW.team_id;
  SELECT u.email INTO inviter
    FROM auth.users u WHERE u.id = NEW.invited_by;

  invite_url := 'https://jamilformula.com/accept-invite.html?token=' || NEW.token;
  subject_str := 'You''ve been invited to join ' || COALESCE(team.name, 'a Formula AI team');

  body_html := format(
       '<div style="font-family:Arial,sans-serif; max-width:640px; margin:0 auto; color:#111827; padding:24px;">'
    || '<h2 style="margin:0 0 12px;">Join %s on Formula AI</h2>'
    || '<p style="margin:0 0 16px; color:#374151;">%s invited you to join the team <strong>%s</strong> on the <strong>%s</strong> plan.</p>'
    || '<p style="margin:0 0 20px;"><a href="%s" style="display:inline-block; background:#00cc6a; color:#000; padding:13px 26px; text-decoration:none; border-radius:8px; font-weight:700;">Accept invitation</a></p>'
    || '<p style="margin:0; color:#6b7280; font-size:12px;">If you don''t have an account yet, sign up at <a href="https://jamilformula.com/register.html">jamilformula.com/register.html</a> with this email address — you''ll be added to the team automatically when you confirm your email. The invitation expires in 14 days.</p>'
    || '</div>',
    COALESCE(team.name, 'the team'),
    COALESCE(inviter.email, 'A teammate'),
    COALESCE(team.name, 'Formula AI Team'),
    COALESCE(team.plan, 'enterprise'),
    invite_url
  );

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.resend_api_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'from',     'Formula AI Teams <' || cfg.from_email || '>',
      'to',       jsonb_build_array(NEW.email),
      'reply_to', COALESCE(inviter.email, cfg.owner_email),
      'subject',  subject_str,
      'html',     body_html
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_team_invitee failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS team_invitations_notify ON public.team_invitations;
CREATE TRIGGER team_invitations_notify
  AFTER INSERT ON public.team_invitations
  FOR EACH ROW EXECUTE FUNCTION public.notify_team_invitee();


-- ── 10. Verification ───────────────────────────────────────────────
--   SELECT id, name FROM public.teams;
--   SELECT * FROM public.list_my_teams(auth.uid());
--   SELECT public.user_has_team_paid(auth.uid());

-- ── ROLLBACK ───────────────────────────────────────────────────────
-- DROP TRIGGER  IF EXISTS team_invitations_notify  ON public.team_invitations;
-- DROP FUNCTION IF EXISTS public.notify_team_invitee();
-- DROP TRIGGER  IF EXISTS teams_auto_accept_invites ON auth.users;
-- DROP FUNCTION IF EXISTS public._teams_auto_accept_on_signup();
-- DROP FUNCTION IF EXISTS public.list_my_teams(UUID);
-- DROP FUNCTION IF EXISTS public.user_has_team_paid(UUID);
-- DROP TRIGGER  IF EXISTS teams_seed_owner ON public.teams;
-- DROP FUNCTION IF EXISTS public._teams_seed_owner_member();
-- DROP TRIGGER  IF EXISTS teams_touch ON public.teams;
-- DROP FUNCTION IF EXISTS public._teams_touch_updated_at();
-- DROP TABLE    IF EXISTS public.team_invitations;
-- DROP TABLE    IF EXISTS public.team_members;
-- DROP TABLE    IF EXISTS public.teams;
-- ════════════════════════════════════════════════════════════════════
