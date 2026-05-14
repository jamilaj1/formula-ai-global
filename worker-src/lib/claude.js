/**
 * claude.js — thin Anthropic Messages API wrapper.
 *
 * Centralises the API version, error handling, and JSON-mode extraction so
 * individual handlers (search, chat, safety, lab, extract) don't repeat
 * boilerplate.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

/** Default model — keep in sync across the codebase. */
export const CLAUDE_MODEL = 'claude-haiku-4-5';

/**
 * POST to /v1/messages and return the parsed JSON response.
 * Returns null on network or HTTP error so callers can fail-soft.
 *
 * @param {object} env  env with ANTHROPIC_API_KEY
 * @param {object} body  per Anthropic API
 */
export async function claudeMessages(env, body) {
  try {
    const r = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_API_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      return { ok: false, status: r.status, detail: (await r.text()).slice(0, 300) };
    }
    const data = await r.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, status: 0, detail: err.message };
  }
}

/**
 * Extract a JSON object from Claude's first text content block.
 * Strips ```json ... ``` fences if present. Returns null on parse failure.
 */
export function extractClaudeJson(claudeResponse) {
  const text = (claudeResponse?.content?.[0]?.text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/```$/, '')
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}
