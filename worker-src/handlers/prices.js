/**
 * prices.js — user's ingredient price book + cost + scale calculators (Phase 14/15).
 *
 * Users maintain their own ingredient_prices table (per-supplier rates).
 * /cost reads a formula's components and computes batch cost using the
 * user's price book. /scale converts a percentage-based formula into
 * mass amounts for a target batch size.
 */
import { json, unauthorized, badRequest } from '../lib/responses.js';
import { sb, sbService } from '../lib/supabase.js';

/* ─── /prices ────────────────────────────────────────────────── */

export async function handlePricesList(auth, env) {
  if (auth.kind !== 'user') return json({ prices: [] });
  const path = `/ingredient_prices?user_id=eq.${auth.userId}&select=*&order=ingredient_name.asc&limit=500`;
  const r = await sbService(env, path);
  if (!r.ok) return json({ prices: [] });
  return json({ prices: await r.json() });
}

export async function handlePriceUpsert(request, auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }
  if (!body.ingredient_name || !body.price_per_kg) {
    return badRequest('missing_fields');
  }
  const payload = {
    user_id: auth.userId,
    ingredient_name: String(body.ingredient_name).slice(0, 200),
    cas_number: body.cas_number || null,
    price_per_kg: parseFloat(body.price_per_kg),
    currency: body.currency || 'USD',
    supplier: body.supplier || null,
    notes: body.notes || null,
  };
  const r = await sbService(env, `/ingredient_prices?on_conflict=user_id,ingredient_name`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    return json({ error: 'save_failed', detail: (await r.text()).slice(0, 300) }, 500);
  }
  const arr = await r.json();
  return json({ saved: arr[0] });
}

export async function handlePriceDelete(id, auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  const r = await sbService(
    env,
    `/ingredient_prices?id=eq.${id}&user_id=eq.${auth.userId}`,
    { method: 'DELETE' }
  );
  if (!r.ok) return json({ error: 'delete_failed' }, 500);
  return json({ deleted: true });
}

/* ─── /cost ──────────────────────────────────────────────────── */

/**
 * POST /cost — body: { formula_id?, components?, batch_kg?, currency? }
 * Returns: { batch_kg, currency, total_cost, cost_per_kg, breakdown[], missing[] }
 */
export async function handleCost(request, auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const components = await resolveComponents(body, auth, env);
  if (!components) return badRequest('no_components');

  const batchKg = parseFloat(body.batch_kg) || 1;
  const currency = String(body.currency || 'USD').slice(0, 5);

  // Load user's price book
  const pr = await sbService(
    env,
    `/ingredient_prices?user_id=eq.${auth.userId}&select=ingredient_name,cas_number,price_per_kg,currency&limit=2000`
  );
  const priceList = pr.ok ? await pr.json() : [];
  const byName = new Map();
  const byCas = new Map();
  for (const p of priceList) {
    byName.set(String(p.ingredient_name).toLowerCase(), p);
    if (p.cas_number) byCas.set(p.cas_number, p);
  }

  const breakdown = [];
  const missing = [];
  let total = 0;
  for (const c of components) {
    const name = String(c.name_en || c.name || '').trim();
    const pct = parseFloat(c.percentage) || 0;
    if (!name || pct <= 0) continue;

    const massKg = (pct / 100) * batchKg;
    const price = (c.cas_number && byCas.get(c.cas_number)) || byName.get(name.toLowerCase());
    if (price) {
      const cost = massKg * parseFloat(price.price_per_kg);
      total += cost;
      breakdown.push({
        name,
        percentage: pct,
        mass_kg: parseFloat(massKg.toFixed(4)),
        price_per_kg: parseFloat(price.price_per_kg),
        cost: parseFloat(cost.toFixed(4)),
        currency: price.currency,
      });
    } else {
      missing.push({ name, percentage: pct, mass_kg: parseFloat(massKg.toFixed(4)) });
    }
  }

  return json({
    batch_kg: batchKg,
    currency,
    total_cost: parseFloat(total.toFixed(4)),
    cost_per_kg: parseFloat((total / batchKg).toFixed(4)),
    breakdown,
    missing,
    coverage_pct: components.length
      ? Math.round((breakdown.length / (breakdown.length + missing.length)) * 100)
      : 0,
  });
}

/* ─── /scale ─────────────────────────────────────────────────── */

/** POST /scale — body: { formula_id?, components?, target_kg, unit? } */
export async function handleScale(request, auth, env) {
  if (auth.kind !== 'user') return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const components = await resolveComponents(body, auth, env);
  if (!components) return badRequest('no_components');

  const targetKg = parseFloat(body.target_kg);
  if (!Number.isFinite(targetKg) || targetKg <= 0) {
    return badRequest('invalid_target_kg');
  }
  const unit = String(body.unit || 'kg').toLowerCase();
  const conversion =
    unit === 'g'
      ? 1000
      : unit === 'mg'
        ? 1000000
        : unit === 'l'
          ? 1
          : unit === 'ml'
            ? 1000
            : 1;

  const scaled = components.map((c) => {
    const pct = parseFloat(c.percentage) || 0;
    const massKg = (pct / 100) * targetKg;
    return {
      name_en: c.name_en || c.name || '',
      cas_number: c.cas_number || null,
      function: c.function || null,
      percentage: pct,
      mass_kg: parseFloat(massKg.toFixed(4)),
      [`mass_${unit}`]: parseFloat((massKg * conversion).toFixed(4)),
    };
  });

  const totalPct = components.reduce(
    (s, c) => s + (parseFloat(c.percentage) || 0),
    0
  );

  return json({
    target_kg: targetKg,
    unit,
    total_percentage: parseFloat(totalPct.toFixed(2)),
    balance_check:
      Math.abs(totalPct - 100) < 1 ? 'balanced' : `off by ${(totalPct - 100).toFixed(2)}%`,
    components: scaled,
  });
}

/**
 * Resolve a components[] either from the request body or by fetching the
 * formula from `formulas` (public) or `user_formulas` (owned).
 * @returns {Promise<Array|null>}
 */
async function resolveComponents(body, auth, env) {
  if (Array.isArray(body.components) && body.components.length) return body.components;
  if (!body.formula_id) return null;

  const pub = await sb(
    env,
    `/formulas?id=eq.${body.formula_id}&select=components,name,form_type`
  );
  if (pub.ok) {
    const arr = await pub.json();
    if (arr[0]?.components) return arr[0].components;
  }

  if (auth.kind === 'user') {
    const own = await sbService(
      env,
      `/user_formulas?id=eq.${body.formula_id}&user_id=eq.${auth.userId}&select=components,name,form_type`
    );
    if (own.ok) {
      const arr = await own.json();
      if (arr[0]?.components) return arr[0].components;
    }
  }

  return null;
}
