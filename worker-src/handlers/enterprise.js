/**
 * enterprise.js — Phase 3 Enterprise B2B sales pipeline.
 *
 * Endpoints
 * ---------
 *   POST /be/enterprise/lead    public; visitor submits the "schedule
 *                                a consultation" form on enterprise.html.
 *   GET  /be/enterprise/list    admin-only; list leads for admin tab.
 *
 * Anti-abuse: per-IP rate limit (3 leads / hour). The pg_net trigger
 * emails the owner immediately, so a viable lead never sits in a queue.
 */
import { json, badRequest } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';
import { rateLimit, rateLimitResponse, clientIP } from '../lib/ratelimit.js';

const OWNER_EMAIL = 'jamilaj1@gmail.com';

const TEAM_SIZES   = new Set(['1-10', '11-50', '51-200', '200+']);
const LEAD_STATUS  = new Set(['new', 'contacted', 'demo_booked', 'negotiating', 'won', 'lost']);
const EMAIL_RE     = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v, max) {
  const s = String(v ?? '').normalize('NFKC').trim();
  return max ? s.slice(0, max) : s;
}

/**
 * POST /be/enterprise/lead
 *
 * Body: { full_name, email, company, role?, team_size?, industry?,
 *         use_case?, budget_per_month_usd? }
 */
export async function handleEnterpriseLead(request, auth, env) {
  // Same rate-limit budget as consulting intake — 3/hour is plenty for
  // a serious buyer and tight enough to stop form-spam bots.
  const ip = clientIP(request);
  const rl = await rateLimit(env, {
    bucket: `enterprise-lead:${ip}`,
    limit: 3,
    window: 60 * 60,
  });
  if (!rl.ok) return rateLimitResponse(rl, 'too_many_lead_submissions');

  let body;
  try { body = await request.json(); } catch { return badRequest('invalid_json'); }

  const full_name = clean(body.full_name, 200);
  const email     = clean(body.email, 320).toLowerCase();
  const company   = clean(body.company, 200);
  if (!full_name || !email || !company) return badRequest('missing_fields');
  if (!EMAIL_RE.test(email)) return badRequest('invalid_email');

  const role         = clean(body.role, 120) || null;
  const team_size_in = clean(body.team_size, 16);
  const team_size    = TEAM_SIZES.has(team_size_in) ? team_size_in : null;
  const industry     = clean(body.industry, 80) || null;
  const use_case     = clean(body.use_case, 6000) || null;

  // Budget — defensive parsing. Visitor can leave blank.
  let budget = null;
  if (body.budget_per_month_usd != null && String(body.budget_per_month_usd).trim() !== '') {
    const n = Number(String(body.budget_per_month_usd).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n >= 0 && n < 1_000_000) budget = Math.round(n);
  }

  const row = {
    full_name, email, company, role, team_size, industry, use_case,
    budget_per_month_usd: budget,
    status: 'new',
  };
  if (auth?.kind === 'user' && auth.userId) row.user_id = auth.userId;

  const r = await sbService(env, '/enterprise_leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    console.error('[enterprise.lead] db insert failed', r.status, detail);
    return json({ error: 'db_error', detail }, 500);
  }
  const arr = await r.json();
  return json({ ok: true, id: arr?.[0]?.id || null });
}

/**
 * GET /be/enterprise/list
 * Admin-only. Used by the admin.html tab in 3.x.
 */
export async function handleEnterpriseList(auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) {
    return json({ error: 'forbidden' }, 403);
  }
  const r = await sbService(
    env,
    '/enterprise_leads?select=id,full_name,email,company,role,team_size,industry,use_case,budget_per_month_usd,status,owner_notes,created_at&order=created_at.desc&limit=200'
  );
  if (!r.ok) {
    return json({ error: 'db_error', detail: (await r.text()).slice(0, 200) }, 500);
  }
  return json({ leads: await r.json() });
}

/**
 * PATCH /be/enterprise/lead/{id}
 * Admin-only. Update status / owner_notes from the admin tab.
 */
export async function handleEnterpriseLeadUpdate(request, auth, env, leadId) {
  if (!auth || auth.email !== OWNER_EMAIL) {
    return json({ error: 'forbidden' }, 403);
  }
  const id = clean(leadId, 64);
  if (!id) return badRequest('missing_id');

  let body;
  try { body = await request.json(); } catch { return badRequest('invalid_json'); }

  const patch = {};
  if (body.status !== undefined) {
    const s = clean(body.status, 32);
    if (!LEAD_STATUS.has(s)) return badRequest('invalid_status');
    patch.status = s;
  }
  if (body.owner_notes !== undefined) {
    patch.owner_notes = clean(body.owner_notes, 8000) || null;
  }
  if (Object.keys(patch).length === 0) return badRequest('no_changes');

  const r = await sbService(env, `/enterprise_leads?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    return json({ error: 'db_error', detail: (await r.text()).slice(0, 200) }, 500);
  }
  const arr = await r.json();
  return json({ ok: true, lead: arr?.[0] || null });
}

/**
 * GET /be/enterprise/onepager  (PUBLIC)
 * Streams the enterprise leave-behind PDF rendered by FastAPI. The Worker
 * adds the internal secret so the Render endpoint isn't hit directly.
 * Pure marketing material — no auth, no user data.
 */
export async function handleEnterpriseOnepager(env) {
  const backendUrl = env.CHEM_BACKEND_URL || '';
  const internalSecret = env.BACKEND_INTERNAL_SECRET || '';
  if (!backendUrl || !internalSecret) return json({ error: 'backend_not_configured' }, 503);
  try {
    const br = await fetch(`${backendUrl.replace(/\/+$/, '')}/api/v2/enterprise/onepager.pdf`, {
      headers: { 'x-formula-internal': internalSecret },
    });
    if (!br.ok) {
      return json({ error: 'backend_error', status: br.status }, br.status >= 500 ? 502 : br.status);
    }
    return new Response(br.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Formula-AI-Enterprise.pdf"',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return json({ error: 'backend_unreachable', detail: err?.message || '' }, 502);
  }
}
