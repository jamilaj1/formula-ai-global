/**
 * Unit tests for worker-src/handlers/testimonials.js (D3 social proof).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleTestimonialSubmit,
  handleTestimonialsApproved,
  handleTestimonialsAdmin,
  handleTestimonialModerate,
} from '../../worker-src/handlers/testimonials.js';

const OWNER = 'jamilaj1@gmail.com';
function kv() {
  const store = new Map();
  return { store, get: vi.fn(async k => store.get(k) ?? null), put: vi.fn(async (k, v) => { store.set(k, v); }), delete: vi.fn(async k => { store.delete(k); }) };
}
function env(over = {}) {
  return { SUPABASE_URL: 'https://t.supabase.co', SUPABASE_SERVICE_KEY: 'k', ...over };
}
function userAuth() { return { kind: 'user', userId: 'u1', email: 'chemist@x.com' }; }
function ownerAuth() { return { kind: 'user', userId: 'owner', email: OWNER }; }
function jreq(body) {
  return new Request('https://w.test/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function arr(d, status = 200) { return new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } }); }

beforeEach(() => vi.restoreAllMocks());

describe('handleTestimonialSubmit', () => {
  it('401 for a guest', async () => {
    const res = await handleTestimonialSubmit(jreq({ quote: 'great tool here' }), { kind: 'guest' }, env());
    expect(res.status).toBe(401);
  });
  it('400 when quote too short', async () => {
    const res = await handleTestimonialSubmit(jreq({ quote: 'hi' }), userAuth(), env());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('quote_too_short');
  });
  it('inserts pending with user_id + clamped rating', async () => {
    let captured = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => { captured = JSON.parse(init.body); return arr([{ id: 't1' }], 201); });
    const res = await handleTestimonialSubmit(jreq({ quote: 'Saved me hours in the lab', rating: 9, role: 'QA', company: 'Acme' }), userAuth(), env());
    expect(res.status).toBe(200);
    expect(captured.user_id).toBe('u1');
    expect(captured.status).toBe('pending');
    expect(captured.rating).toBe(5);       // clamped from 9
    expect(captured.role).toBe('QA');
  });
  it('409 when user already has an active testimonial (unique index)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('duplicate key value violates unique constraint "testimonials_one_active_per_user"', { status: 409 }));
    const res = await handleTestimonialSubmit(jreq({ quote: 'A second testimonial attempt' }), userAuth(), env());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already_submitted');
  });
});

describe('handleTestimonialsApproved (public)', () => {
  it('returns approved-only testimonials, cached after first call', async () => {
    const sharedKv = kv();
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([
      { name: 'A', quote: 'q1', rating: 5, featured: true },
    ]));
    const res1 = await handleTestimonialsApproved(env({ RATELIMIT_KV: sharedKv }));
    const b1 = await res1.json();
    expect(b1.testimonials).toHaveLength(1);
    // verify the query asked for approved-only
    expect(String(spy.mock.calls[0][0])).toContain('status=eq.approved');
    const callsAfter = spy.mock.calls.length;
    const res2 = await handleTestimonialsApproved(env({ RATELIMIT_KV: sharedKv }));
    expect((await res2.json()).cached).toBe(true);
    expect(spy.mock.calls.length).toBe(callsAfter); // served from cache
  });
  it('returns empty list on db error (never throws)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('err', { status: 500 }));
    const res = await handleTestimonialsApproved(env());
    expect((await res.json()).testimonials).toEqual([]);
  });
});

describe('handleTestimonialsAdmin', () => {
  it('403 for non-owner', async () => {
    const res = await handleTestimonialsAdmin(userAuth(), env());
    expect(res.status).toBe(403);
  });
  it('returns all for owner', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([{ id: 't1', status: 'pending' }]));
    const res = await handleTestimonialsAdmin(ownerAuth(), env());
    expect(res.status).toBe(200);
    expect((await res.json()).testimonials[0].status).toBe('pending');
  });
});

describe('handleTestimonialModerate', () => {
  it('403 for non-owner', async () => {
    const res = await handleTestimonialModerate(jreq({ id: 't1', status: 'approved' }), userAuth(), env());
    expect(res.status).toBe(403);
  });
  it('rejects invalid status', async () => {
    const res = await handleTestimonialModerate(jreq({ id: 't1', status: 'published' }), ownerAuth(), env());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_status');
  });
  it('approves: sets status + approved_at + busts cache', async () => {
    let patch = null;
    const sharedKv = kv();
    sharedKv.store.set('cache:testimonials:approved', '[]');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => { patch = JSON.parse(init.body); return arr([{ id: 't1', status: 'approved' }]); });
    const res = await handleTestimonialModerate(jreq({ id: 't1', status: 'approved' }), ownerAuth(), env({ RATELIMIT_KV: sharedKv }));
    expect(res.status).toBe(200);
    expect(patch.status).toBe('approved');
    expect(patch.approved_at).toBeTruthy();
    expect(sharedKv.delete).toHaveBeenCalledWith('cache:testimonials:approved');
  });
  it('feature toggle works without a status change', async () => {
    let patch = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => { patch = JSON.parse(init.body); return arr([{ id: 't1', featured: true }]); });
    const res = await handleTestimonialModerate(jreq({ id: 't1', featured: true }), ownerAuth(), env());
    expect(res.status).toBe(200);
    expect(patch.featured).toBe(true);
    expect(patch.status).toBeUndefined();
  });
});
