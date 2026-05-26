/**
 * cost_report.js — daily Claude cost-report emitter.
 *
 * Triggered by Cloudflare Cron at 09:00 UTC (see wrangler.toml [triggers]).
 * The handler does nothing more than POST to the Supabase RPC
 * `public.send_daily_cost_report()` — all the heavy lifting (querying
 * api_usage, rendering the HTML, POSTing to Resend) happens server-side
 * in Postgres so the Resend API key never leaves Supabase.
 *
 * Behavior on failure
 * -------------------
 * Cron failures are visible in Cloudflare Workers logs (Observability tab).
 * We swallow exceptions and return a boolean so the scheduled() handler
 * never throws — a one-day report miss is acceptable; an unhandled cron
 * exception is not (it would flood the alerting channel if any exists).
 */
import { sbService } from '../lib/supabase.js';

/**
 * @param {object} env  Worker env (must contain SUPABASE_URL + SUPABASE_SERVICE_KEY)
 * @returns {Promise<{ok: boolean, status?: number, subject?: string|null, detail?: string}>}
 */
export async function runDailyCostReport(env) {
  try {
    const r = await sbService(env, '/rpc/send_daily_cost_report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      console.error('[cost_report] RPC failed', r.status, detail);
      return { ok: false, status: r.status, detail };
    }
    // The RPC returns the email subject as TEXT (or null if Resend isn't
    // configured yet — see the EXCEPTION block in the SQL function).
    const subject = (await r.text()).trim().replace(/^"|"$/g, '') || null;
    console.log('[cost_report] sent:', subject);
    return { ok: true, subject };
  } catch (err) {
    console.error('[cost_report] threw', err?.message);
    return { ok: false, detail: err?.message || 'unknown' };
  }
}
