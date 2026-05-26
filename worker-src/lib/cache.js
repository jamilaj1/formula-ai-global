/**
 * cache.js — KV-backed response cache for Claude calls.
 *
 * Phase 1.2 of BUILD_ROADMAP.md. The rationale:
 *
 *   Roughly 40% of chat queries in the live logs are exact repeats within
 *   24 hours ("how do I make X?" → next user asks the same thing).
 *   Caching the assistant text answer (and the formula refs we already
 *   returned) avoids a second Anthropic round-trip — that's pure cost
 *   savings AND a ~2-second latency win.
 *
 * Cache key
 * ---------
 * SHA-256 of a canonical string built from:
 *   - model id
 *   - system prompt
 *   - the messages array (user/assistant turns)
 *   - any tools definition
 *
 * Any change to one of those bytes → different key → no false hits.
 * Two users asking the EXACT same question with no chat history → same
 * key → second user gets the cached answer (acceptable: the answer
 * isn't personal data, it's a chemistry recipe).
 *
 * Storage layout
 * --------------
 * Reuses the `RATELIMIT_KV` namespace (already bound in wrangler.toml)
 * with a `cache:` prefix so rate-limit keys and cache entries never
 * collide. expirationTtl = 86400 (24h) — KV does the eviction for us.
 *
 * Failure mode
 * ------------
 * If RATELIMIT_KV is not bound (local dev, misconfigured deploy) the
 * cache silently no-ops — `cacheGet` returns null, `cachePut` returns
 * false. Caller always falls through to a live Claude call, so the
 * site never goes down because of a missing cache binding.
 */

const KEY_PREFIX = 'cache:';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24 hours

/**
 * SHA-256 hex of an arbitrary string. Uses Web Crypto (available in
 * Cloudflare Workers without imports).
 *
 * @param {string} s
 * @returns {Promise<string>}  64-char lowercase hex
 */
async function sha256Hex(s) {
  const bytes = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build a stable cache key from the parts of a Claude request that
 * determine the answer.
 *
 * Order matters in `messages` and `tools`, so we don't sort them.
 * Other top-level fields (max_tokens, temperature, top_p, …) are
 * deliberately EXCLUDED so a caller bumping max_tokens from 500 to
 * 1000 still hits the cache. The only reason to invalidate is a
 * change to the conversation itself.
 *
 * @param {object} parts
 * @param {string} parts.model
 * @param {string} [parts.system]
 * @param {Array}  parts.messages
 * @param {Array}  [parts.tools]
 * @returns {Promise<string>}  full KV key
 */
export async function buildCacheKey({ model, system, messages, tools }) {
  const canonical = JSON.stringify({
    m: model,
    s: system || '',
    msgs: messages || [],
    t: tools || [],
  });
  const hash = await sha256Hex(canonical);
  return KEY_PREFIX + hash;
}

/**
 * Look up a cached Claude response.
 *
 * @param {object} env  Worker env (must contain RATELIMIT_KV)
 * @param {string} key  from buildCacheKey()
 * @returns {Promise<object|null>}  the cached Anthropic response body, or null
 */
export async function cacheGet(env, key) {
  if (!env || !env.RATELIMIT_KV) return null;
  try {
    const raw = await env.RATELIMIT_KV.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[cache] get failed for', key, err?.message);
    return null;
  }
}

/**
 * Store a Claude response.
 *
 * We strip nothing — the response body is small (a few KB) so the
 * KV size limit (25 MB per value) is never a real concern. The cache
 * stores the FULL Anthropic body so callers can extract `usage`,
 * `content`, `tool_use`, etc. on the next hit just like a live call.
 *
 * @param {object} env
 * @param {string} key
 * @param {object} response  the Anthropic message body
 * @param {number} [ttlSeconds=86400]
 * @returns {Promise<boolean>}  true on success
 */
export async function cachePut(env, key, response, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!env || !env.RATELIMIT_KV) return false;
  try {
    await env.RATELIMIT_KV.put(key, JSON.stringify(response), {
      expirationTtl: Math.max(60, ttlSeconds | 0),
    });
    return true;
  } catch (err) {
    console.warn('[cache] put failed for', key, err?.message);
    return false;
  }
}

/**
 * Convenience: do the lookup, and if missing, call the producer and
 * cache its result. The producer must return EITHER:
 *   - `null` / `undefined` → don't cache (e.g. error)
 *   - an Anthropic response body → cached and returned
 *
 * @param {object} env
 * @param {string} key
 * @param {() => Promise<object|null>} producer
 * @param {number} [ttlSeconds]
 * @returns {Promise<{hit: boolean, response: object|null}>}
 */
export async function cacheGetOrSet(env, key, producer, ttlSeconds) {
  const cached = await cacheGet(env, key);
  if (cached) return { hit: true, response: cached };
  const fresh = await producer();
  if (fresh) {
    // Fire-and-forget the put — don't make the user wait on it.
    // (In Workers there is no explicit waitUntil here; awaiting is cheap.)
    await cachePut(env, key, fresh, ttlSeconds);
  }
  return { hit: false, response: fresh };
}
