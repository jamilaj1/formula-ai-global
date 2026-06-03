/**
 * submissions_admin.js — owner-only moderation of community formula uploads.
 *
 * The credibility gate: nothing a user submits reaches the public `formulas`
 * set until the owner approves it here. Same owner gate as the rest of /be/admin.
 *
 *   GET  /be/admin/submissions          → list pending/processing submissions
 *   POST /be/admin/submission/approve   → { id } → structure via Claude, insert
 *                                          into formulas (owner-verified), mark verified
 *   POST /be/admin/submission/reject    → { id } → mark rejected (never published)
 */
import { json } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';
import { claudeCall, CLAUDE_HAIKU, extractClaudeJson } from '../lib/claude.js';

const OWNER_EMAIL = 'jamilaj1@gmail.com';
const forbid = () => json({ error: 'forbidden' }, 403);

const EXTRACT_SYSTEM = `Extract ONE structured chemical formula from the user's submission text. Output ONLY a JSON object (no prose, no markdown fences):
{"name":"...","category":"...","form_type":"liquid|gel|cream|powder|paste|other","components":[{"name_en":"...","percentage":0,"cas_number":"","function":""}],"process_conditions":{"order_of_addition":""},"description":""}
Rules: percentages are plain numbers (no % sign); keep ingredient names in English; be faithful to the submission — never invent ingredients; if it is not a real formula, return {"name":""}.`;

export async function handleSubmissionsList(auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) return forbid();
  const r = await sbService(
    env,
    '/user_submissions?review_status=in.(pending,processing)&select=id,submitter_email,title,product_type,raw_text,review_status,created_at&order=created_at.asc',
  );
  if (!r.ok) return json({ ok: false, error: 'db', detail: (await r.text()).slice(0, 200) });
  return json({ ok: true, rows: await r.json() });
}

export async function handleSubmissionApprove(request, auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) return forbid();
  let body;
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'bad_json' }); }
  const id = String((body && body.id) || '').trim();
  if (!id) return json({ ok: false, error: 'missing_id' });

  // 1) Fetch the submission.
  const sr = await sbService(env, `/user_submissions?id=eq.${encodeURIComponent(id)}&select=id,title,product_type,raw_text`);
  if (!sr.ok) return json({ ok: false, error: 'db', detail: (await sr.text()).slice(0, 200) });
  const sub = (await sr.json())[0];
  if (!sub) return json({ ok: false, error: 'not_found' });

  // 2) Structure it via Claude (the owner has already read + approved the content).
  let parsed = null;
  try {
    const cr = await claudeCall(
      env,
      {
        system: EXTRACT_SYSTEM,
        max_tokens: 2000,
        messages: [{ role: 'user', content: `Title: ${sub.title || ''}\nType: ${sub.product_type || ''}\n\n${(sub.raw_text || '').slice(0, 8000)}` }],
      },
      { model: CLAUDE_HAIKU },
    );
    if (cr.ok) parsed = extractClaudeJson(cr.data);
  } catch (_) { /* handled below */ }
  if (!parsed || !parsed.name) {
    return json({ ok: false, error: 'extract_failed', detail: 'Could not structure this into a formula. Reject it, or fix the submission text.' });
  }

  // 3) Insert into the trusted formulas set (owner-verified, community source).
  const row = {
    name: String(parsed.name).slice(0, 200),
    name_en: String(parsed.name).slice(0, 200),
    category: parsed.category || sub.product_type || null,
    form_type: parsed.form_type || null,
    description: parsed.description || null,
    components: Array.isArray(parsed.components) ? parsed.components : [],
    process_conditions: parsed.process_conditions || {},
    trust_score: 85,
    human_verified: true,
    is_complete: true,
    source_type: 'community',
    language: 'en',
  };
  const ir = await sbService(env, '/formulas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!ir.ok) return json({ ok: false, error: 'insert_failed', detail: (await ir.text()).slice(0, 200) });
  const created = (await ir.json())[0] || null;

  // 4) Mark the submission verified (so it leaves the queue).
  await sbService(env, `/user_submissions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ review_status: 'verified', parsed, reviewed_at: new Date().toISOString() }),
  });

  return json({ ok: true, formula_id: created && created.id });
}

export async function handleSubmissionReject(request, auth, env) {
  if (!auth || auth.email !== OWNER_EMAIL) return forbid();
  let body;
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'bad_json' }); }
  const id = String((body && body.id) || '').trim();
  if (!id) return json({ ok: false, error: 'missing_id' });
  const r = await sbService(env, `/user_submissions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ review_status: 'rejected', reviewed_at: new Date().toISOString() }),
  });
  if (!r.ok) return json({ ok: false, error: 'db', detail: (await r.text()).slice(0, 200) });
  return json({ ok: true });
}
