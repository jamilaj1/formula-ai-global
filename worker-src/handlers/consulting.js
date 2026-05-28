/**
 * consulting.js — Phase 2 consulting intake + draft pipeline.
 *
 * Endpoints
 * ---------
 *   POST /be/consulting/intake   public; visitor submits a brief.
 *   POST /be/consulting/draft    admin-only; runs the AI orchestrator
 *                                 against an existing request and stores
 *                                 the markdown draft.
 *   GET  /be/consulting/list     admin-only; list all requests for the
 *                                 admin tab.
 *
 * The intake endpoint INTENTIONALLY accepts anonymous requests — we do
 * not want to lose a $2,500 lead just because the visitor hasn't created
 * an account. Spam mitigation: per-IP rate limit (3/hour) via the
 * existing RATELIMIT_KV namespace.
 */
import { json, badRequest } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';
import { rateLimit, rateLimitResponse, clientIP } from '../lib/ratelimit.js';

// ── Validation helpers ─────────────────────────────────────────────

const PACKAGES = new Set(['quick', 'full', 'custom']);
const PACKAGE_USD = { quick: 1000, full: 2500, custom: 5000 };

/** Trim, NFKC-normalise, cap at maxLen. Returns '' on null/undefined. */
function clean(value, maxLen) {
  const s = String(value ?? '').normalize('NFKC').trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

/** RFC 5322-lite — good enough to reject obvious garbage. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /be/consulting/intake
 *
 * Body: { package, product_type, market, brief, email, company? }
 * Returns: { ok: true, id } on success, { error } on validation/db failure.
 */
export async function handleConsultingIntake(request, auth, env) {
  // Rate-limit by IP. 3 inquiries/hour is way more than a real human
  // submits and still lets a curious tester submit a few during dev.
  const ip = clientIP(request);
  const rl = await rateLimit(env, {
    bucket: `consult-intake:${ip}`,
    limit: 3,
    window: 60 * 60,
  });
  if (!rl.ok) return rateLimitResponse(rl, 'too_many_intake_submissions');

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const pkg = clean(body.package, 16).toLowerCase();
  if (!PACKAGES.has(pkg)) return badRequest('invalid_package');

  const email = clean(body.email, 320).toLowerCase();
  if (!EMAIL_RE.test(email)) return badRequest('invalid_email');

  const product_type = clean(body.product_type, 200);
  const market       = clean(body.market, 200);
  const brief        = clean(body.brief, 6000);
  const company      = clean(body.company, 200) || null;

  if (!product_type || !market || !brief) return badRequest('missing_fields');

  // Build the row. user_id is set only if the caller is signed in —
  // anon intakes still work, but they don't link to a profile until
  // the user signs up + the admin manually claims the row on review.
  const row = {
    email,
    company,
    package: pkg,
    product_type,
    market,
    brief,
    amount_usd: PACKAGE_USD[pkg],
    status: 'intake',
  };
  if (auth?.kind === 'user' && auth.userId) row.user_id = auth.userId;

  // service_role bypass — RLS allows anon INSERT too, but using sbService
  // here is consistent with every other write in the worker and avoids
  // depending on policy specifics that may shift later.
  const r = await sbService(env, '/consultation_requests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    console.error('[consulting.intake] db insert failed', r.status, detail);
    return json({ error: 'db_error', detail }, 500);
  }
  const arr = await r.json();
  const id  = arr?.[0]?.id || null;

  return json({ ok: true, id, package: pkg, amount_usd: PACKAGE_USD[pkg] });
}

/**
 * GET /be/consulting/list
 * Admin-only (resolved via auth.email === owner email).
 */
const OWNER_EMAIL = 'jamilaj1@gmail.com';

export async function handleConsultingList(auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) {
    return json({ error: 'forbidden' }, 403);
  }
  const r = await sbService(
    env,
    '/consultation_requests?select=id,email,company,package,product_type,market,brief,status,amount_usd,paystack_reference,ai_draft_md_url,final_pdf_url,revisions_used,created_at,updated_at&order=created_at.desc&limit=200'
  );
  if (!r.ok) {
    return json({ error: 'db_error', detail: (await r.text()).slice(0, 300) }, 500);
  }
  return json({ requests: await r.json() });
}

/**
 * POST /be/consulting/draft
 * Admin-only. Triggers the AI draft for a given consultation_request id.
 *
 * Phase 2.3: this now POSTs to the FastAPI backend on Render
 * (CHEM_BACKEND_URL), which runs Orchestrator.formulate() with the
 * request brief and stores the resulting markdown in Supabase Storage.
 * The Worker is the public gate; the FastAPI does the heavy lifting.
 *
 * Why split this way:
 *   - Cloudflare Workers can't import `anthropic` SDK (Node only) or
 *     RDKit/numpy. The chem backend already has all of them.
 *   - The Worker stays a thin auth + routing layer.
 *   - Defence-in-depth: FastAPI also checks an internal shared secret
 *     header so it can't be called directly from the public internet.
 */
export async function handleConsultingDraft(request, auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) {
    return json({ error: 'forbidden' }, 403);
  }
  let body;
  try { body = await request.json(); } catch { return badRequest('invalid_json'); }
  const id = clean(body.id, 64);
  if (!id) return badRequest('missing_id');

  // Mark as drafting first so the admin sees immediate feedback while
  // the orchestrator runs (typically 3-8 seconds, but Sonnet on Full
  // packages can take 20+ if the formula is complex).
  const updateR = await sbService(env, `/consultation_requests?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'drafting' }),
  });
  if (!updateR.ok) {
    return json({ error: 'db_error', detail: (await updateR.text()).slice(0, 300) }, 500);
  }

  // Forward to the FastAPI orchestrator. The shared secret stops anyone
  // who finds the public Render URL from running the orchestrator
  // directly — only requests signed by THIS Worker get through.
  const backendUrl = env.CHEM_BACKEND_URL || '';
  if (!backendUrl) {
    return json({ error: 'backend_not_configured' }, 500);
  }
  const internalSecret = env.BACKEND_INTERNAL_SECRET || '';
  if (!internalSecret) {
    console.warn('[consulting.draft] BACKEND_INTERNAL_SECRET missing — call will be rejected');
  }

  try {
    const br = await fetch(`${backendUrl.replace(/\/+$/, '')}/api/v2/consulting/draft/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-formula-internal': internalSecret,
      },
      body: JSON.stringify({ force: !!body.force }),
    });
    const data = await br.json().catch(() => ({}));
    if (!br.ok) {
      // Roll status back to 'paid' (or 'intake') so the admin can retry.
      await sbService(env, `/consultation_requests?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'review',
          owner_notes: `Draft failed at backend: ${data.detail || br.status}`,
        }),
      });
      return json({ error: 'backend_error', status: br.status, detail: data.detail || '' }, 502);
    }
    return json({ ok: true, ...data });
  } catch (err) {
    return json({ error: 'backend_unreachable', detail: err?.message || '' }, 502);
  }
}
