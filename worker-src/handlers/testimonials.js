/**
 * testimonials.js — real social proof (Phase D3 of ROADMAP_TO_10.md).
 *
 *   POST /be/testimonial/submit     (signed-in user) → status='pending'
 *   GET  /be/testimonials/approved   (PUBLIC, cached) → homepage wall
 *   GET  /be/testimonials/admin      (owner)         → moderation queue
 *   POST /be/testimonial/moderate    (owner)         → approve / reject / feature
 *
 * Strict honesty model: nothing renders publicly until the owner approves
 * it. Approved rows are served by the Worker via service_role, so the
 * base table's RLS stays locked (anon never reads pending/rejected/other
 * users' rows).
 */
import { json, badRequest, unauthorized } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';

const OWNER_EMAIL = 'jamilaj1@gmail.com';
const APPROVED_CACHE_KEY = 'cache:testimonials:approved';
const APPROVED_TTL = 300; // 5 min

function clean(s, max) {
  const v = String(s ?? '').normalize('NFKC').trim();
  return max ? v.slice(0, max) : v;
}

/** POST /be/testimonial/submit — a signed-in user shares their experience. */
export async function handleTestimonialSubmit(request, auth, env) {
  if (!auth || auth.kind !== 'user') return unauthorized();

  let body;
  try { body = await request.json(); } catch { return badRequest('invalid_json'); }

  const quote = clean(body.quote, 600);
  if (quote.length < 10) return badRequest('quote_too_short');
  const rating = Math.max(1, Math.min(parseInt(body.rating, 10) || 5, 5));
  const name = clean(body.name, 80) || clean(auth.email?.split('@')[0], 80) || 'Formula AI user';
  const role = clean(body.role, 80) || null;
  const company = clean(body.company, 120) || null;

  const payload = {
    user_id: auth.userId,
    name,
    role,
    company,
    quote,
    rating,
    status: 'pending',
  };

  const r = await sbService(env, '/testimonials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    // Unique-index violation = the user already has a pending/approved one.
    if (detail.includes('testimonials_one_active_per_user') || r.status === 409) {
      return json({ error: 'already_submitted', detail: 'You already have a testimonial awaiting review or published.' }, 409);
    }
    return json({ error: 'submit_failed', detail }, 500);
  }
  return json({ ok: true, status: 'pending', message: 'Thank you! Your testimonial is awaiting review.' });
}

/** GET /be/testimonials/approved — PUBLIC. Approved-only, cached 5 min. */
export async function handleTestimonialsApproved(env) {
  if (env.RATELIMIT_KV) {
    try {
      const cached = await env.RATELIMIT_KV.get(APPROVED_CACHE_KEY);
      if (cached) return json({ testimonials: JSON.parse(cached), cached: true });
    } catch { /* fall through */ }
  }

  const r = await sbService(
    env,
    '/testimonials?status=eq.approved&select=name,role,company,quote,rating,featured&order=featured.desc,approved_at.desc&limit=12'
  );
  if (!r.ok) return json({ testimonials: [] });
  const rows = await r.json();
  const testimonials = Array.isArray(rows) ? rows : [];

  if (env.RATELIMIT_KV) {
    try {
      await env.RATELIMIT_KV.put(APPROVED_CACHE_KEY, JSON.stringify(testimonials), {
        expirationTtl: APPROVED_TTL,
      });
    } catch { /* non-fatal */ }
  }
  return json({ testimonials });
}

/** GET /be/testimonials/admin — owner-only moderation queue (pending first). */
export async function handleTestimonialsAdmin(auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) return json({ error: 'forbidden' }, 403);
  const r = await sbService(
    env,
    '/testimonials?select=id,name,role,company,quote,rating,status,featured,created_at&order=status.asc,created_at.desc&limit=200'
  );
  if (!r.ok) return json({ error: 'db_error' }, 500);
  return json({ testimonials: await r.json() });
}

/** POST /be/testimonial/moderate — owner sets status / featured. */
export async function handleTestimonialModerate(request, auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) return json({ error: 'forbidden' }, 403);

  let body;
  try { body = await request.json(); } catch { return badRequest('invalid_json'); }
  const id = clean(body.id, 64);
  if (!id) return badRequest('missing_id');

  const patch = {};
  if (body.status !== undefined) {
    const s = clean(body.status, 16);
    if (!['pending', 'approved', 'rejected'].includes(s)) return badRequest('invalid_status');
    patch.status = s;
    patch.approved_at = s === 'approved' ? new Date().toISOString() : null;
  }
  if (body.featured !== undefined) patch.featured = !!body.featured;
  if (!Object.keys(patch).length) return badRequest('no_fields');

  const r = await sbService(env, `/testimonials?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return json({ error: 'update_failed', detail: (await r.text()).slice(0, 200) }, 500);

  // Bust the public approved-cache so changes show within seconds.
  if (env.RATELIMIT_KV) {
    try { await env.RATELIMIT_KV.delete(APPROVED_CACHE_KEY); } catch { /* non-fatal */ }
  }
  const arr = await r.json();
  return json({ ok: true, testimonial: arr[0] || null });
}
