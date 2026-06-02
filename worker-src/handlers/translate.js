/**
 * translate.js — POST /translate
 *
 * On-demand EN→AR translation of formula free-text (preparation steps,
 * property values, ingredient names) for the Arabic UI. Uses Haiku (cheap)
 * with an industrial-chemistry instruction, and caches every text bundle in
 * KV so each formula is translated at most once.
 *
 * Request:  { texts: string[] }
 * Response: { ok: true, translations: { "<english>": "<arabic>" } }
 *           { ok: false, error: "<code>" }
 *
 * Notes
 * -----
 * - Stateless + cache-keyed on the exact text set, so identical bundles
 *   (the same formula opened again, by anyone) hit KV and cost nothing.
 * - If ANTHROPIC_API_KEY or KV is missing, it degrades: a failed Claude
 *   call returns { ok:false } and the UI simply keeps the English text.
 * - Owner-edited overrides (Step 3) will take precedence on the client
 *   before falling back to these AI translations.
 */
import { json } from '../lib/responses.js';
import { claudeCall, CLAUDE_HAIKU, extractClaudeJson } from '../lib/claude.js';
import { buildCacheKey, cacheGetOrSet } from '../lib/cache.js';

const MAX_ITEMS = 80;
const MAX_CHARS = 6000;
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const SYSTEM = `You are a professional translator for the INDUSTRIAL CHEMISTRY / formulation domain (detergents, cosmetics, home & personal care). Translate each English string into clear Modern Standard Arabic using CORRECT, standard Arabic industrial-chemistry terminology — meaning-for-meaning, never literal word-for-word.

Rules:
- Chemical substance names: use the common Arabic name when one is standard; otherwise transliterate into Arabic and keep the English/abbreviation in parentheses. Example: "Linear Alkylbenzene Sulphonic Acid (LABSA)" -> "حمض الألكيل بنزين السلفونيك الخطّي (LABSA)".
- Keep numbers, %, units, CAS numbers, pH values and chemical formulas EXACTLY as given.
- Preserve meaning precisely; do not add, omit, or editorialize. Professional chemists read this.
- Output ONLY a JSON array of the Arabic strings, in the SAME ORDER as the input array. No prose, no markdown code fences.`;

export async function handleTranslate(request, auth, env) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: 'bad_json' });
  }

  let texts = Array.isArray(body && body.texts) ? body.texts : [];
  texts = texts
    .map((t) => String(t == null ? '' : t).trim())
    .filter((t) => t && t.length <= MAX_CHARS);
  texts = Array.from(new Set(texts)).slice(0, MAX_ITEMS);
  if (!texts.length) return json({ ok: true, translations: {} });

  const messages = [{ role: 'user', content: JSON.stringify(texts) }];
  // Stable key per (model, system, exact text set) → same bundle is free on re-open.
  const key = await buildCacheKey({ model: CLAUDE_HAIKU, system: SYSTEM, messages, tools: [] });

  const { response } = await cacheGetOrSet(
    env,
    key,
    async () => {
      const r = await claudeCall(
        env,
        { system: SYSTEM, max_tokens: 3000, messages },
        { model: CLAUDE_HAIKU },
      );
      return r.ok ? r.data : null;
    },
    CACHE_TTL_SECONDS,
  );

  if (!response) return json({ ok: false, error: 'translate_failed' });

  const arr = extractClaudeJson(response);
  if (!Array.isArray(arr)) return json({ ok: false, error: 'parse_failed' });

  const translations = {};
  texts.forEach((t, i) => {
    const ar = arr[i];
    if (typeof ar === 'string' && ar.trim() && ar.trim() !== t) {
      translations[t] = ar.trim();
    }
  });
  return json({ ok: true, translations });
}
