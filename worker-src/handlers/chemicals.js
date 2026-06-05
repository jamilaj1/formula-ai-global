/**
 * chemicals.js — public read of the chemicals_database reference
 * (the raw-materials encyclopedia). Reference data, so it is served with
 * the service key. Search by name / CAS / formula, category filter,
 * paginated. No auth required (public catalog).
 */
import { json } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';

const SELECT =
  'id,name,name_en,cas_number,molecular_formula,molecular_weight,' +
  'category,function_category,physical_properties,synonyms,common_applications,source';

/** GET /chemicals?q=&category=&limit=&offset= → { chemicals, total } */
export async function handleChemicals(url, env) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const cat = (url.searchParams.get('category') || '').trim().slice(0, 80);
  let limit = parseInt(url.searchParams.get('limit') || '48', 10);
  let offset = parseInt(url.searchParams.get('offset') || '0', 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) limit = 48;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  let path = `/chemicals_database?select=${SELECT}&order=name.asc&limit=${limit}&offset=${offset}`;
  if (q) {
    const like = encodeURIComponent(`*${q}*`);
    path += `&or=(name.ilike.${like},cas_number.ilike.${like},molecular_formula.ilike.${like})`;
  }
  if (cat) path += `&category=ilike.${encodeURIComponent(`*${cat}*`)}`;

  const r = await sbService(env, path, { headers: { Prefer: 'count=exact' } });
  if (!r.ok) return json({ chemicals: [], total: 0 });
  const total = Number((r.headers.get('content-range') || '').split('/').pop()) || 0;
  return json({ chemicals: await r.json(), total, limit, offset });
}

/** GET /chemicals/categories → { categories: [{name, count}] } (top 16). */
export async function handleChemicalCategories(env) {
  const r = await sbService(
    env,
    '/chemicals_database?select=category&category=not.is.null&limit=2000'
  );
  if (!r.ok) return json({ categories: [] });
  const counts = {};
  for (const x of await r.json()) {
    const c = (x.category || '').trim();
    if (c) counts[c] = (counts[c] || 0) + 1;
  }
  const categories = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([name, count]) => ({ name, count }));
  return json({ categories });
}
