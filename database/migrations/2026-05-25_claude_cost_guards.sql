-- ════════════════════════════════════════════════════════════════════
-- CLAUDE COST GUARDS — usage tracking + daily cost report (2026-05-25)
-- Phase 1.2 of BUILD_ROADMAP.md
--
-- Problem today
-- -------------
-- `api_usage` records one row per Worker call but knows nothing about
-- WHICH calls hit Claude vs which were a cheap save_formula. A viral
-- spike can detonate the Anthropic bill into the thousands before we
-- notice. Today we have a global per-day cap but no per-model tracking,
-- no cache-hit accounting, and no cost visibility.
--
-- After this runs
-- ---------------
--   1. `api_usage` gets four new nullable columns: `model`,
--      `input_tokens`, `output_tokens`, `est_cost_usd`, and a
--      `cache_hit` flag. Non-Claude callers (save_formula, cost,
--      scale, etc.) leave them NULL and behave exactly as before.
--   2. Index on `(created_at)` for the daily aggregation query, and
--      a partial index on Claude-only rows for the cost report.
--   3. View `public.claude_cost_today` — one row per model with
--      call count, total tokens, total cost, cache-hit ratio.
--      Read-only, used by the 9 AM cost-report Cron handler.
--   4. RPC `public.claude_cost_report(target_date DATE)` — same
--      shape as the view but for any chosen UTC day. Used by the
--      Worker's scheduled() handler to build the email body.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. New columns on api_usage ────────────────────────────────────
-- All nullable: existing rows (and non-Claude future rows) are unaffected.
ALTER TABLE public.api_usage
  ADD COLUMN IF NOT EXISTS model         TEXT,           -- 'claude-sonnet-4-5' | 'claude-haiku-4-5' | NULL
  ADD COLUMN IF NOT EXISTS input_tokens  INTEGER,        -- prompt + system + tool defs
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,        -- assistant reply tokens
  ADD COLUMN IF NOT EXISTS est_cost_usd  NUMERIC(12, 6), -- computed in Worker from PRICING_USD
  ADD COLUMN IF NOT EXISTS cache_hit     BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.api_usage.model         IS 'Anthropic model id when this call hit Claude; NULL for non-Claude endpoints.';
COMMENT ON COLUMN public.api_usage.input_tokens  IS 'Prompt tokens reported by Anthropic usage object.';
COMMENT ON COLUMN public.api_usage.output_tokens IS 'Completion tokens reported by Anthropic usage object.';
COMMENT ON COLUMN public.api_usage.est_cost_usd  IS 'Worker-computed cost: (in × in_rate + out × out_rate) / 1e6. Source of truth for the daily report.';
COMMENT ON COLUMN public.api_usage.cache_hit     IS 'TRUE if the Claude response was served from the Worker KV cache (no API call billed).';

-- ── 2. Indexes for the daily report ────────────────────────────────
-- Composite (created_at, model) so the GROUP BY in the view is index-only.
CREATE INDEX IF NOT EXISTS api_usage_created_model_idx
  ON public.api_usage (created_at DESC, model)
  WHERE model IS NOT NULL;

-- ── 3. "Today" cost view (UTC) ─────────────────────────────────────
-- Used by the cron handler when it fires at 09:00 UTC: reports the
-- *previous* UTC day's spend. Owner just looks at today's email to
-- see yesterday's bill. Convenient for the impatient.
DROP VIEW IF EXISTS public.claude_cost_today;
CREATE VIEW public.claude_cost_today AS
  SELECT
    COALESCE(model, '(unknown)')                    AS model,
    COUNT(*)                                        AS calls,
    COUNT(*) FILTER (WHERE cache_hit)               AS cache_hits,
    COUNT(*) FILTER (WHERE NOT cache_hit)           AS live_calls,
    COALESCE(SUM(input_tokens),  0)::BIGINT         AS input_tokens,
    COALESCE(SUM(output_tokens), 0)::BIGINT         AS output_tokens,
    COALESCE(SUM(est_cost_usd),  0)::NUMERIC(14, 4) AS total_cost_usd
  FROM public.api_usage
  WHERE model IS NOT NULL
    AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
  GROUP BY COALESCE(model, '(unknown)')
  ORDER BY total_cost_usd DESC;

COMMENT ON VIEW public.claude_cost_today IS
  'One row per Claude model, summing today (UTC) only. Cron at 09:00 UTC '
  'reports YESTERDAY via claude_cost_report() — this view is for the live '
  'admin dashboard.';

-- Grant SELECT on the view to authenticated only (the owner reads it via
-- admin.html using their own JWT; service_role bypasses RLS anyway).
GRANT SELECT ON public.claude_cost_today TO authenticated;

-- ── 4. Per-date cost report RPC ────────────────────────────────────
-- The Worker's scheduled() handler calls this with yesterday's date,
-- formats the rows into HTML, and emails the owner.
CREATE OR REPLACE FUNCTION public.claude_cost_report(target_date DATE)
RETURNS TABLE (
  model          TEXT,
  calls          BIGINT,
  cache_hits     BIGINT,
  live_calls     BIGINT,
  input_tokens   BIGINT,
  output_tokens  BIGINT,
  total_cost_usd NUMERIC(14, 4)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(u.model, '(unknown)')                    AS model,
    COUNT(*)                                          AS calls,
    COUNT(*) FILTER (WHERE u.cache_hit)               AS cache_hits,
    COUNT(*) FILTER (WHERE NOT u.cache_hit)           AS live_calls,
    COALESCE(SUM(u.input_tokens),  0)::BIGINT         AS input_tokens,
    COALESCE(SUM(u.output_tokens), 0)::BIGINT         AS output_tokens,
    COALESCE(SUM(u.est_cost_usd),  0)::NUMERIC(14, 4) AS total_cost_usd
  FROM public.api_usage u
  WHERE u.model IS NOT NULL
    AND u.created_at >= target_date::TIMESTAMP AT TIME ZONE 'UTC'
    AND u.created_at <  (target_date + INTERVAL '1 day')::TIMESTAMP AT TIME ZONE 'UTC'
  GROUP BY COALESCE(u.model, '(unknown)')
  ORDER BY total_cost_usd DESC;
$$;

-- Only the service_role (Worker) needs to call this. authenticated +
-- anon do not — keep the attack surface small.
REVOKE ALL ON FUNCTION public.claude_cost_report(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claude_cost_report(DATE) TO service_role;

COMMENT ON FUNCTION public.claude_cost_report(DATE) IS
  'Daily cost rollup for one UTC date. Called by the Worker cron at 09:00 UTC '
  'with (CURRENT_DATE - 1) to produce yesterday''s spend report.';

-- ── 5. Daily cost report email (called by Cloudflare Cron) ─────────
-- Builds an HTML table of yesterday's spend per model and POSTs it to
-- Resend via pg_net. Reuses _owner_email_config() from the signup-email
-- migration so the API key + addresses live in exactly one place.
--
-- Returns the email subject as a sanity-check value (useful for the
-- Worker logs). If pg_net or the config is missing the function returns
-- NULL and logs a NOTICE — it must NEVER raise, because the cron caller
-- will see the failure in its own logs and we don't want a half-built
-- cost report to break Worker uptime checks.
CREATE OR REPLACE FUNCTION public.send_daily_cost_report()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  cfg          RECORD;
  yesterday    DATE;
  row_rec      RECORD;
  rows_html    TEXT := '';
  total_cost   NUMERIC(14, 4) := 0;
  total_calls  BIGINT := 0;
  subject_str  TEXT;
  body_html    TEXT;
BEGIN
  SELECT * INTO cfg FROM public._owner_email_config();

  IF cfg.resend_api_key IS NULL
     OR cfg.resend_api_key = ''
     OR cfg.resend_api_key LIKE 're_PASTE%' THEN
    RAISE NOTICE 'send_daily_cost_report: Resend key not configured; skipping';
    RETURN NULL;
  END IF;

  yesterday := (NOW() AT TIME ZONE 'UTC')::DATE - INTERVAL '1 day';

  FOR row_rec IN
    SELECT * FROM public.claude_cost_report(yesterday::DATE)
  LOOP
    rows_html := rows_html || format(
         '<tr>'
      || '<td style="padding:8px 12px; border-bottom:1px solid #e5e7eb;">%s</td>'
      || '<td style="padding:8px 12px; border-bottom:1px solid #e5e7eb; text-align:right;">%s</td>'
      || '<td style="padding:8px 12px; border-bottom:1px solid #e5e7eb; text-align:right;">%s</td>'
      || '<td style="padding:8px 12px; border-bottom:1px solid #e5e7eb; text-align:right;">%s</td>'
      || '<td style="padding:8px 12px; border-bottom:1px solid #e5e7eb; text-align:right;">%s</td>'
      || '<td style="padding:8px 12px; border-bottom:1px solid #e5e7eb; text-align:right; font-weight:700;">$%s</td>'
      || '</tr>',
      row_rec.model,
      to_char(row_rec.calls,          'FM999,999,990'),
      to_char(row_rec.cache_hits,     'FM999,999,990'),
      to_char(row_rec.input_tokens,   'FM999,999,990'),
      to_char(row_rec.output_tokens,  'FM999,999,990'),
      to_char(row_rec.total_cost_usd, 'FM999,990.0099')
    );
    total_cost  := total_cost  + row_rec.total_cost_usd;
    total_calls := total_calls + row_rec.calls;
  END LOOP;

  IF rows_html = '' THEN
    rows_html :=
         '<tr><td colspan="6" style="padding:14px; text-align:center; color:#9ca3af;">'
      || 'No Claude calls recorded on ' || yesterday::TEXT
      || '</td></tr>';
  END IF;

  subject_str := format(
    '[Formula AI] Claude cost on %s: $%s (%s calls)',
    to_char(yesterday, 'YYYY-MM-DD'),
    to_char(total_cost,  'FM999,990.0099'),
    to_char(total_calls, 'FM999,999,990')
  );

  body_html := format(
       '<div style="font-family:Arial,sans-serif; max-width:680px; margin:0 auto; color:#111827; padding:24px;">'
    || '<h2 style="margin:0 0 6px;">Daily Claude cost report</h2>'
    || '<p style="margin:0 0 18px; color:#6b7280;">UTC day: <strong>%s</strong></p>'
    || '<table style="width:100%%; border-collapse:collapse; background:#fff; border:1px solid #e5e7eb;">'
    || '<thead><tr style="background:#f9fafb;">'
    || '<th style="padding:10px 12px; text-align:left;  font-size:12px; color:#374151;">Model</th>'
    || '<th style="padding:10px 12px; text-align:right; font-size:12px; color:#374151;">Calls</th>'
    || '<th style="padding:10px 12px; text-align:right; font-size:12px; color:#374151;">Cache hits</th>'
    || '<th style="padding:10px 12px; text-align:right; font-size:12px; color:#374151;">Input tok</th>'
    || '<th style="padding:10px 12px; text-align:right; font-size:12px; color:#374151;">Output tok</th>'
    || '<th style="padding:10px 12px; text-align:right; font-size:12px; color:#374151;">Cost (USD)</th>'
    || '</tr></thead>'
    || '<tbody>%s</tbody>'
    || '<tfoot><tr style="background:#f9fafb;">'
    || '<td style="padding:12px; font-weight:700;">Total</td>'
    || '<td colspan="4" style="padding:12px; text-align:right; color:#6b7280;">%s calls</td>'
    || '<td style="padding:12px; text-align:right; font-weight:700; color:#059669;">$%s</td>'
    || '</tr></tfoot>'
    || '</table>'
    || '<p style="margin:18px 0 0; font-size:13px; color:#6b7280;">'
    || 'Generated by Cloudflare Cron Trigger via Supabase pg_net. '
    || '<a href="https://jamilformula.com/admin.html" style="color:#2563eb; text-decoration:none;">Open admin</a>'
    || '</p></div>',
    yesterday::TEXT,
    rows_html,
    to_char(total_calls, 'FM999,999,990'),
    to_char(total_cost,  'FM999,990.0099')
  );

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.resend_api_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'from',    'Formula AI Reports <' || cfg.from_email || '>',
      'to',      jsonb_build_array(cfg.owner_email),
      'subject', subject_str,
      'html',    body_html
    )
  );

  RETURN subject_str;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'send_daily_cost_report failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

-- Worker calls this with the service_role key, so only service_role needs EXECUTE.
REVOKE ALL ON FUNCTION public.send_daily_cost_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_daily_cost_report() TO service_role;

COMMENT ON FUNCTION public.send_daily_cost_report() IS
  'Emails yesterday''s Claude-cost breakdown to the owner via Resend (pg_net). '
  'Triggered daily by the Cloudflare Cron at 09:00 UTC (handler in worker-src/handlers/cost_report.js).';

-- ── 6. Quick verification ──────────────────────────────────────────
-- After running:
--   \d public.api_usage          -- should now show 4 new columns
--   SELECT * FROM public.claude_cost_today;             -- empty until first call
--   SELECT * FROM public.claude_cost_report(CURRENT_DATE);
--   -- Then trigger one chat call from the live site; rerun the SELECT
--   -- and you should see one row with model + tokens + a few cents of cost.

-- ── ROLLBACK (if needed) ───────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.claude_cost_report(DATE);
-- DROP VIEW     IF EXISTS public.claude_cost_today;
-- DROP INDEX    IF EXISTS public.api_usage_created_model_idx;
-- ALTER TABLE public.api_usage
--   DROP COLUMN IF EXISTS cache_hit,
--   DROP COLUMN IF EXISTS est_cost_usd,
--   DROP COLUMN IF EXISTS output_tokens,
--   DROP COLUMN IF EXISTS input_tokens,
--   DROP COLUMN IF EXISTS model;
-- ════════════════════════════════════════════════════════════════════
