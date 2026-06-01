/**
 * Unit tests for worker-src/handlers/team.js — Phase 9.2 multi-seat teams.
 *
 * Covers the auth/role gates and the Supabase-call wiring for create,
 * list, members, invite, accept, leave, and remove. globalThis.fetch is
 * mocked per test to stand in for PostgREST + RPC calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleTeamList,
  handleTeamCreate,
  handleTeamMembers,
  handleTeamInvite,
  handleTeamAccept,
  handleTeamLeave,
  handleTeamRemoveMember,
} from '../../worker-src/handlers/team.js';

function env() {
  return {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_KEY: 'service-test',
    SUPABASE_ANON_KEY: 'anon-test',
  };
}
function userAuth(userId = 'me-uuid', email = 'me@x.com') {
  return { kind: 'user', userId, email, id: 'auth-1', plan: 'free' };
}
function jsonReq(body) {
  return new Request('https://w.test/be/team/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
/** Reply helper for an array JSON body. */
function arr(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => vi.restoreAllMocks());

/* ─── list ─────────────────────────────────────────────────────── */

describe('handleTeamList', () => {
  it('401 for a guest', async () => {
    const res = await handleTeamList({ kind: 'guest' }, env());
    expect(res.status).toBe(401);
  });

  it('returns teams from the list_my_teams RPC', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([
      { id: 't1', name: 'Acme', plan: 'enterprise', seats: 5, role: 'owner', member_count: 3 },
    ]));
    const res = await handleTeamList(userAuth(), env());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams[0].name).toBe('Acme');
    expect(body.teams[0].role).toBe('owner');
  });
});

/* ─── create ───────────────────────────────────────────────────── */

describe('handleTeamCreate', () => {
  it('401 for guest', async () => {
    const res = await handleTeamCreate(jsonReq({ name: 'X' }), { kind: 'guest' }, env());
    expect(res.status).toBe(401);
  });

  it('400 when name missing', async () => {
    const res = await handleTeamCreate(jsonReq({ seats: 5 }), userAuth(), env());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_name');
  });

  it('400 on invalid plan', async () => {
    const res = await handleTeamCreate(jsonReq({ name: 'X', plan: 'platinum' }), userAuth(), env());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_plan');
  });

  it('creates with owner_user_id stamped from auth and clamps seats', async () => {
    let captured = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      captured = JSON.parse(init.body);
      return arr([{ id: 't9', name: captured.name, seats: captured.seats }], 201);
    });
    const res = await handleTeamCreate(
      jsonReq({ name: 'Acme R&D', seats: 9999 }),
      userAuth('owner-1'),
      env()
    );
    expect(res.status).toBe(200);
    expect(captured.owner_user_id).toBe('owner-1');
    expect(captured.seats).toBe(500);          // clamped to max
    expect(captured.plan).toBe('enterprise');  // default
  });
});

/* ─── members (role gate) ──────────────────────────────────────── */

describe('handleTeamMembers', () => {
  it('403 when caller is not a member', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([]));  // getMyRole → none
    const res = await handleTeamMembers('t1', userAuth(), env());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('not_a_member');
  });

  it('returns members hydrated with email/profile', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      // getMyRole
      if (u.includes('/team_members') && u.includes('user_id=eq.me-uuid')) {
        return arr([{ role: 'owner' }]);
      }
      // members list
      if (u.includes('/team_members') && u.includes('order=joined_at')) {
        return arr([
          { user_id: 'me-uuid', role: 'owner',  joined_at: '2026-05-30T00:00:00Z' },
          { user_id: 'u2',      role: 'member', joined_at: '2026-05-31T00:00:00Z' },
        ]);
      }
      // profiles hydrate
      if (u.includes('/profiles')) {
        return arr([
          { id: 'me-uuid', email: 'me@x.com',  full_name: 'Me' },
          { id: 'u2',      email: 'u2@x.com',  full_name: 'Two' },
        ]);
      }
      return arr([]);
    });
    const res = await handleTeamMembers('t1', userAuth(), env());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.my_role).toBe('owner');
    expect(body.members).toHaveLength(2);
    expect(body.members.find(m => m.user_id === 'u2').email).toBe('u2@x.com');
  });
});

/* ─── invite (role gate + validation) ──────────────────────────── */

describe('handleTeamInvite', () => {
  it('403 when caller is only a member', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([{ role: 'member' }]));
    const res = await handleTeamInvite('t1', jsonReq({ email: 'a@b.com' }), userAuth(), env());
    expect(res.status).toBe(403);
  });

  it('400 on invalid email', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([{ role: 'owner' }]));
    const res = await handleTeamInvite('t1', jsonReq({ email: 'not-an-email' }), userAuth(), env());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_email');
  });

  it('409 already_member when invitee already on the team', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/team_members') && u.includes('user_id=eq.me-uuid')) return arr([{ role: 'owner' }]);
      if (u.includes('/profiles')) return arr([{ id: 'existing-uuid' }]);
      if (u.includes('/team_members') && u.includes('user_id=eq.existing-uuid')) return arr([{ user_id: 'existing-uuid' }]);
      return arr([]);
    });
    const res = await handleTeamInvite('t1', jsonReq({ email: 'existing@x.com' }), userAuth(), env());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already_member');
  });

  it('creates an invitation with a generated token when seats available', async () => {
    let inserted = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('/team_members') && u.includes('user_id=eq.me-uuid')) return arr([{ role: 'admin' }]);
      if (u.includes('/profiles')) return arr([]);              // invitee has no account yet
      if (u.includes('/team_invitations') && u.includes('accepted_at=is.null') && (init?.method || 'GET') === 'GET') {
        // both the dedupe check and the seat-count call hit this; return
        // empty + a zero count header.
        return new Response('[]', { status: 200, headers: { 'content-range': '0-0/0', 'Content-Type': 'application/json' } });
      }
      if (u.includes('/teams?id=eq.')) return arr([{ seats: 5 }]);
      if (u.includes('/team_members') && (init?.headers?.Prefer || '').includes('count')) {
        return new Response('[]', { status: 200, headers: { 'content-range': '0-0/1' } });
      }
      if (u.includes('/team_invitations') && init?.method === 'POST') {
        inserted = JSON.parse(init.body);
        return arr([{ id: 'inv1', expires_at: '2026-06-14T00:00:00Z' }]);
      }
      return arr([]);
    });
    const res = await handleTeamInvite('t1', jsonReq({ email: 'new@x.com', role: 'member' }), userAuth(), env());
    expect(res.status).toBe(200);
    expect(inserted.email).toBe('new@x.com');
    expect(inserted.token).toMatch(/^[a-f0-9]{64}$/);   // 32-byte hex
    expect(inserted.invited_by).toBe('me-uuid');
  });
});

/* ─── accept ───────────────────────────────────────────────────── */

describe('handleTeamAccept', () => {
  it('404 on unknown token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([]));
    const res = await handleTeamAccept(jsonReq({ token: 'deadbeef' }), userAuth(), env());
    expect(res.status).toBe(404);
  });

  it('410 when the invitation has expired', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([{
      id: 'inv1', team_id: 't1', email: 'me@x.com', role: 'member',
      expires_at: '2000-01-01T00:00:00Z', accepted_at: null,
    }]));
    const res = await handleTeamAccept(jsonReq({ token: 'x' }), userAuth(), env());
    expect(res.status).toBe(410);
  });

  it('403 on email mismatch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([{
      id: 'inv1', team_id: 't1', email: 'someone@else.com', role: 'member',
      expires_at: '2099-01-01T00:00:00Z', accepted_at: null,
    }]));
    const res = await handleTeamAccept(jsonReq({ token: 'x' }), userAuth('me-uuid', 'me@x.com'), env());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('email_mismatch');
  });

  it('joins the team on a valid invitation', async () => {
    let joined = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('/team_invitations?token=')) {
        return arr([{
          id: 'inv1', team_id: 't1', email: 'me@x.com', role: 'member',
          expires_at: '2099-01-01T00:00:00Z', accepted_at: null,
        }]);
      }
      if (u.includes('/team_members') && init?.method === 'POST') {
        joined = JSON.parse(init.body);
        return new Response(null, { status: 201 });
      }
      return new Response(null, { status: 204 });
    });
    const res = await handleTeamAccept(jsonReq({ token: 'x' }), userAuth('me-uuid', 'me@x.com'), env());
    expect(res.status).toBe(200);
    expect(joined.team_id).toBe('t1');
    expect(joined.user_id).toBe('me-uuid');
  });
});

/* ─── leave ────────────────────────────────────────────────────── */

describe('handleTeamLeave', () => {
  it('409 when owner tries to leave', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([{ role: 'owner' }]));
    const res = await handleTeamLeave('t1', userAuth(), env());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('owner_cannot_leave');
  });

  it('removes a member who leaves', async () => {
    let deleted = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/team_members') && (init?.method || 'GET') === 'GET') return arr([{ role: 'member' }]);
      if (init?.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }); }
      return arr([]);
    });
    const res = await handleTeamLeave('t1', userAuth(), env());
    expect(res.status).toBe(200);
    expect(deleted).toBe(true);
  });
});

/* ─── remove member ────────────────────────────────────────────── */

describe('handleTeamRemoveMember', () => {
  it('403 when caller is only a member', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([{ role: 'member' }]));
    const res = await handleTeamRemoveMember('t1', 'victim', userAuth(), env());
    expect(res.status).toBe(403);
  });

  it('409 when trying to remove the owner', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('user_id=eq.me-uuid')) return arr([{ role: 'admin' }]);
      if (u.includes('user_id=eq.owner-x')) return arr([{ role: 'owner' }]);
      return arr([]);
    });
    const res = await handleTeamRemoveMember('t1', 'owner-x', userAuth(), env());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('cannot_remove_owner');
  });

  it('409 when admin tries to remove themselves', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(arr([{ role: 'admin' }]));
    const res = await handleTeamRemoveMember('t1', 'me-uuid', userAuth('me-uuid'), env());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('use_leave_endpoint');
  });

  it('removes a member as admin', async () => {
    let deleted = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('user_id=eq.me-uuid')) return arr([{ role: 'admin' }]);
      if (u.includes('user_id=eq.target') && (init?.method || 'GET') === 'GET') return arr([{ role: 'member' }]);
      if (init?.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }); }
      return arr([]);
    });
    const res = await handleTeamRemoveMember('t1', 'target', userAuth(), env());
    expect(res.status).toBe(200);
    expect(deleted).toBe(true);
  });
});
