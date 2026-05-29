/**
 * vector.js — OpenAI embeddings + Supabase pgvector ANN search.
 *
 * Phase 9.1: thin wrapper around the OpenAI embeddings API and the
 * `public.match_formulas` RPC added in
 * `database/migrations/2026-05-29_vector_search.sql`.
 *
 * Why OpenAI (not Voyage / Anthropic)
 * -----------------------------------
 * text-embedding-3-small (1536 dim) is the cheapest production-grade
 * embedder ($0.020 / 1M tokens). Voyage is marginally better on some
 * benchmarks but adds another API key + billing relationship for
 * minimal ROI at our scale. Switching later is a 5-line change here
 * plus a new column or dimension drift; not worth the up-front
 * complexity now.
 *
 * Failure mode
 * ------------
 * Every export here returns `null` on any error (network, missing key,
 * RPC fault) and never throws. Callers MUST treat null as "no RAG this
 * round, fall back to keyword search" — that's the whole point of
 * keeping vector as an augmentation, not a replacement.
 */
import { sbService } from './supabase.js';

const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const DEFAULT_MODEL    = 'text-embedding-3-small';

/**
 * Embed one short query string via OpenAI.
 * Returns the 1536-dim vector, or null on any failure / missing key.
 *
 * @param {string} query
 * @param {object} env
 * @returns {Promise<number[]|null>}
 */
export async function embedQuery(query, env) {
  if (!env?.OPENAI_API_KEY) return null;
  const text = String(query || '').trim();
  if (!text || text.length > 4000) return null;     // OpenAI caps inputs; we cap hard so a paste-bomb doesn't burn cost

  try {
    const r = await fetch(OPENAI_EMBED_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_EMBED_MODEL || DEFAULT_MODEL,
        input: text,
      }),
    });
    if (!r.ok) {
      // Don't blow up the Claude path because OpenAI hiccupped. Just
      // log and let the caller fall back to ILIKE.
      console.warn('[vector.embed] OpenAI', r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const data = await r.json();
    const v = data?.data?.[0]?.embedding;
    return Array.isArray(v) && v.length === 1536 ? v : null;
  } catch (err) {
    console.warn('[vector.embed] network error:', err?.message || err);
    return null;
  }
}

/**
 * Top-k formulas most similar to the supplied query embedding.
 *
 * `min_similarity` is a cosine-similarity threshold (0..1) — below this
 * we don't return a row at all. 0.30 is empirically the sweet spot for
 * text-embedding-3-small on short product-name queries: high enough to
 * reject obviously off-topic rows, low enough to keep good fuzzy hits.
 *
 * @param {number[]} embedding
 * @param {object} env
 * @param {{ topK?: number, minSimilarity?: number }} [opts]
 * @returns {Promise<Array<object>|null>}
 */
export async function matchFormulas(embedding, env, opts = {}) {
  if (!Array.isArray(embedding) || embedding.length !== 1536) return null;
  const topK = Math.max(1, Math.min(opts.topK ?? 10, 25));
  const minSim = Math.max(0, Math.min(opts.minSimilarity ?? 0.30, 0.99));

  try {
    const r = await sbService(env, '/rpc/match_formulas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query_embedding: embedding,
        top_k: topK,
        min_similarity: minSim,
      }),
    });
    if (!r.ok) {
      console.warn('[vector.match] RPC', r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const rows = await r.json();
    return Array.isArray(rows) ? rows : null;
  } catch (err) {
    console.warn('[vector.match] error:', err?.message || err);
    return null;
  }
}

/**
 * One-call helper for handlers: embed → match → return.
 * Returns [] on any failure so the caller can `.concat()` safely.
 *
 * @param {string} query
 * @param {object} env
 * @param {{ topK?: number, minSimilarity?: number }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function semanticSearchFormulas(query, env, opts = {}) {
  const v = await embedQuery(query, env);
  if (!v) return [];
  const rows = await matchFormulas(v, env, opts);
  return Array.isArray(rows) ? rows : [];
}
