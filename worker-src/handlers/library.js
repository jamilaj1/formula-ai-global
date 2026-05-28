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
    project: body.project ? String(body.project).slice(0, 80) : null,
    tags: Array.isArray(body.tags)
      ? body.tags.map((t) => String(t).slice(0, 40)).slice(0, 16)
      : [],
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

export async function handleLibraryList(auth, env, url) {
  if (auth.kind !== 'user') return unauthorized();

  // Optional filters from query string: ?project=Cosmetics&tag=wip
  const project = url?.searchParams?.get('project') || null;
  const tag     = url?.searchParams?.get('tag') || null;

  let path = `/user_formulas?user_id=eq.${auth.userId}&select=id,name,name_en,category,sub_category,form_type,trust_score,parent_id,notes,project,tags,created_at,updated_at&order=updated_at.desc&limit=200`;
  if (project) {
    // "(unfiled)" sentinel maps to NULL.
    if (project === '(unfiled)') {
      path += `&project=is.null`;
    } else {
      path += `&project=eq.${encodeURIComponent(project)}`;
    }
  }
  if (tag) {
    // PostgREST array-contains operator.
    path += `&tags=cs.{${encodeURIComponent(tag)}}`;
  }

  const r = await sbService(env, path);
  if (!r.ok) return json({ formulas: [] });
  return json({ formulas: await r.json() });
}

/**
 * GET /library/projects — list distinct projects for the user.
 *
 * Reads the user_formula_projects view (Phase 4 migration). Used by
 * workspace.html to render the left-sidebar project filter.
 */
export async function handleLibraryProjects(auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  const r = await sbService(
    env,
    `/user_formula_projects?user_id=eq.${auth.userId}&select=project,formula_count,last_updated&order=last_updated.desc`
  );
  if (!r.ok) return json({ projects: [] });
  return json({ projects: await r.json() });
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
  'project',
  'tags',
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

/**
 * GET /library/{id}/pdf  (Phase 4.4)
 *
 * Forwards to the FastAPI backend which renders a clean PDF with
 * reportlab and streams it back as application/pdf. We pass the
 * user_id explicitly so the backend can scope the row lookup (defence
 * in depth on top of the Worker's own auth.userId check).
 */
export async function handleLibraryPdf(id, auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  if (!id) return badRequest('missing_id');

  // First, confirm the row exists and belongs to this user. If not,
  // 404 here instead of bouncing the Render backend.
  const own = await sbService(
    env,
    `/user_formulas?id=eq.${id}&user_id=eq.${auth.userId}&select=id&limit=1`
  );
  if (!own.ok) return json({ error: 'db_error' }, 500);
  const ownArr = await own.json();
  if (!ownArr.length) return json({ error: 'not_found' }, 404);

  const backendUrl = env.CHEM_BACKEND_URL || '';
  const internalSecret = env.BACKEND_INTERNAL_SECRET || '';
  if (!backendUrl || !internalSecret) {
    return json({ error: 'backend_not_configured' }, 503);
  }

  const url =
    `${backendUrl.replace(/\/+$/, '')}/api/v2/library/${encodeURIComponent(id)}/pdf` +
    `?user_id=${encodeURIComponent(auth.userId)}`;

  try {
    const br = await fetch(url, {
      method: 'GET',
      headers: { 'x-formula-internal': internalSecret },
    });
    if (!br.ok) {
      const detail = (await br.text()).slice(0, 300);
      return json({ error: 'backend_error', status: br.status, detail }, 502);
    }
    // Stream the PDF straight back to the browser. The Worker's
    // CORS layer adds the right headers on the way out.
    return new Response(br.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition':
          br.headers.get('content-disposition') || `attachment; filename="formula.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return json({ error: 'backend_unreachable', detail: err?.message || '' }, 502);
  }
}
