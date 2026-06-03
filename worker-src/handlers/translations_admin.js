/**
 * translations_admin.js — owner-only CRUD for translation overrides (Step 3).
 *
 * Owner-approved Arabic that overrides the AI auto-translation. /translate
 * reads these first, so a correction here wins everywhere (detail pages +
 * the site-wide auto-translate layer). Same owner gate as the rest of /be/admin.
 *
 * Routes (registered in index.js):
 *   GET  /be/admin/translations        → list all overrides
 *   POST /be/admin/translation         → upsert { source_text, ar_text }
 *   POST /be/admin/translation/delete  → delete { source_text }
 */
import { json } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';

const OWNER_EMAIL = 'jamilaj1@gmail.com';
const forbid = () => json({ error: 'forbidden' }, 403);

export async function handleTranslationsList(auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) return forbid();
  const r = await sbService(
    env,
    '/translation_overrides?select=id,source_text,ar_text,updated_at&order=updated_at.desc',
  );
  if (!r.ok) return json({ ok: false, error: 'db', detail: (await r.text()).slice(0, 200) });
  return json({ ok: true, rows: await r.json() });
}

export async function handleTranslationUpsert(request, auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) return forbid();
  let body;
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'bad_json' }); }
  const source_text = String((body && body.source_text) || '').trim();
  const ar_text = String((body && body.ar_text) || '').trim();
  if (!source_text || !ar_text) return json({ ok: false, error: 'missing_fields' });

  const r = await sbService(env, '/translation_overrides?on_conflict=source_text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({ source_text, ar_text, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) return json({ ok: false, error: 'db', detail: (await r.text()).slice(0, 200) });
  const rows = await r.json();
  return json({ ok: true, row: (Array.isArray(rows) ? rows[0] : rows) || null });
}

export async function handleTranslationDelete(request, auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) return forbid();
  let body;
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'bad_json' }); }
  const source_text = String((body && body.source_text) || '').trim();
  if (!source_text) return json({ ok: false, error: 'missing_fields' });

  const r = await sbService(
    env,
    `/translation_overrides?source_text=eq.${encodeURIComponent(source_text)}`,
    { method: 'DELETE' },
  );
  if (!r.ok) return json({ ok: false, error: 'db', detail: (await r.text()).slice(0, 200) });
  return json({ ok: true });
}
