/**
 * stats.js — public community vanity stats for the campaign landing page.
 *
 * GET /stats/community  (PUBLIC, no auth)
 *   → { users, formulas, industries }
 *
 * Used by welcome.html (and anywhere we want a live "join N chemists"
 * counter). Cached in RATELIMIT_KV for 5 minutes so a viral FB post can't
 * turn the counter into a Supabase count storm.
 *
 * Honesty note (owner profile: he catches fabricated claims): we return
 * the REAL counts. The formulas number (3,381) is the hero; the user
 * number is shown as-is, however small. No inflation.
 */
import { json } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';

const CACHE_KEY = 'cache:stats:community';
const CACHE_TTL = 300; // 5 minutes
const INDUSTRIES = 40; // static — number of sector pages

/** Read an exact row count from PostgREST via the Content-Range header. */
async function countExact(env, table) {
  const r = await sbService(env, `/${table}?select=id`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  if (!r.ok) return null;
  const cr = r.headers.get('content-range') || '';
  const n = parseInt(cr.split('/').pop(), 10);
  return Number.isFinite(n) ? n : null;
}

export async function handleCommunityStats(env) {
  // Serve from cache when warm.
  if (env.RATELIMIT_KV) {
    try {
      const cached = await env.RATELIMIT_KV.get(CACHE_KEY);
      if (cached) {
        return json({ ...JSON.parse(cached), cached: true });
      }
    } catch {
      /* fall through to live */
    }
  }

  const [users, formulas] = await Promise.all([
    countExact(env, 'profiles'),
    countExact(env, 'formulas'),
  ]);

  const payload = {
    users: users ?? 0,
    formulas: formulas ?? 0,
    industries: INDUSTRIES,
  };

  if (env.RATELIMIT_KV) {
    try {
      await env.RATELIMIT_KV.put(CACHE_KEY, JSON.stringify(payload), {
        expirationTtl: CACHE_TTL,
      });
    } catch {
      /* non-fatal */
    }
  }

  return json(payload);
}
