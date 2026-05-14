/**
 * library.js — user's personal saved formulas (Phase 4 + Phase 13).
 *
 * Each user has their own `user_formulas` rows. Library handlers use the
 * service-role key but every query is scoped to `user_id=eq.${auth.userId}`
 * so a user can never see another user's library.
 */
import { json, unauthorized, badRequest } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';

/* ─── /save_formula (Phase 4) ─────────────────────────────────── */

export async function handleSaveFormula(request, auth, env) {
  if (auth.kind !== 'user') return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  if (!body.name || !Array.isArray(body.components) || !body.components.length) {
    return badRequest('missing_fields', 'name and components[] are required');
  }

  const payload = {
    user_id: auth.userId,
    parent_id: body.parent_id || null,
    name: String(body.name).slice(0, 200),
    name_en: body.name_en ? String(body.name_en).slice(0, 200) : null,
    category: body.category || null,
    sub_category: body.sub_category || null,
    form_type: body.form_type || null,
    description: body.description || null,
    components: body.components,
    process_conditions: body.process_conditions || {},
    properties: body.properties || {},
    trust_score: parseInt(body.trust_score) || 80,
    notes: body.notes || null,
  };

  const r = await sbService(env, '/user_formulas', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    return json({ error: 'save_failed', detail: (await r.text()).slice(0, 300) }, 500);
  }
  const arr = await r.json();
  return json({ saved: arr[0] });
}

/* ─── /my_formulas ─────────────────────────────────────────────── */

export async function handleMyFormulas(auth, env) {
  if (auth.kind !== 'user') return json({ formulas: [] });
  const path = `/user_formulas?user_id=eq.${auth.userId}&select=id,name,name_en,category,trust_score,parent_id,created_at,updated_at&order=updated_at.desc&limit=100`;
  const r = await sbService(env, path);
  if (!r.ok) return json({ formulas: [] });
  return json({ formulas: await r.json() });
}

/* ─── /library (Phase 13) — full CRUD ─────────────────────────── */

export async function handleLibraryList(auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  const path = `/user_formulas?user_id=eq.${auth.userId}&select=id,name,name_en,category,sub_category,form_type,trust_score,parent_id,notes,created_at,updated_at&order=updated_at.desc&limit=200`;
  const r = await sbService(env, path);
  if (!r.ok) return json({ formulas: [] });
  return json({ formulas: await r.json() });
}

export async function handleLibraryGet(id, auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  if (!id) return badRequest('missing_id');
  const r = await sbService(
    env,
    `/user_formulas?id=eq.${id}&user_id=eq.${auth.userId}&select=*`
  );
  if (!r.ok) return json({ error: 'db_error' }, 500);
  const arr = await r.json();
  if (!arr.length) return json({ error: 'not_found' }, 404);
  return json({ formula: arr[0] });
}

const UPDATABLE_FIELDS = [
  'name',
  'name_en',
  'category',
  'sub_category',
  'form_type',
  'description',
  'components',
  'process_conditions',
  'properties',
  'trust_score',
  'notes',
];

export async function handleLibraryUpdate(id, request, auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const allowed = {};
  for (const k of UPDATABLE_FIELDS) {
    if (k in body) allowed[k] = body[k];
  }
  if (!Object.keys(allowed).length) return badRequest('no_fields');

  const r = await sbService(env, `/user_formulas?id=eq.${id}&user_id=eq.${auth.userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(allowed),
  });
  if (!r.ok) return json({ error: 'update_failed' }, 500);
  const arr = await r.json();
  return json({ updated: arr[0] });
}

export async function handleLibraryDelete(id, auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  const r = await sbService(env, `/user_formulas?id=eq.${id}&user_id=eq.${auth.userId}`, {
    method: 'DELETE',
  });
  if (!r.ok) return json({ error: 'delete_failed' }, 500);
  return json({ deleted: true });
}
