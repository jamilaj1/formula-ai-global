/**
 * extract.js — book/text → structured formulas via Claude (Phase 5).
 *
 * Flow:
 *  1. Register the upload in `uploaded_books` (status=processing).
 *  2. Send text to Claude with a structured-output prompt.
 *  3. Filter for balanced formulas (sum 95–105%).
 *  4. Insert each into `formulas` with attribution to the book.
 *  5. Mark book status=done.
 */
import { json, unauthorized, badRequest } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';
import { CLAUDE_MODEL } from '../lib/claude.js';

const EXTRACT_SYSTEM = `You are a chemistry-formula extraction system.
Given the following book/document text, extract every chemical formulation you find. Output ONLY a JSON array, no prose.
Each item must have this exact shape:
{
  "name": "english product name",
  "category": "one of: hair_care, skin_care, body_care, personal_hygiene, color_cosmetics, cleaning, disinfectants, laundry, dishwashing, automotive, industrial, agriculture, food_beverage, pet_care, adhesives, coatings, specialty, oral_care, lip_care, paint_coating, glass_ceramics, hair_removal, home_fragrance, household, pool_water_treatment, water_treatment, boiler_cooling, metal_treatment, body_treatment, topical_analgesic, face_makeup, face_mask, massage, pest_control, skincare_anti_aging, skincare_brightening, stationery",
  "form_type": "liquid|gel|cream|powder|paste|aerosol|tablet|other",
  "components": [
    {"name_en":"Sodium Laureth Sulfate","cas_number":"68585-34-2","percentage":12.0,"function":"surfactant"},
    ...
  ],
  "process_conditions": {"order_of_addition":"1. Heat water to 70C... 2. Add SLES..."},
  "properties": {"ph":"5.5-6.5","viscosity":"3000 cP"}
}
Rules:
- Only include formulas where percentages sum approximately to 100% (±5%).
- Skip mentions/discussions that aren't actual recipes.
- Return [] if nothing found.
- Cap at 30 formulas per response.`;

async function markBookFailed(bookId, errorMessage, env) {
  try {
    await sbService(env, `/uploaded_books?id=eq.${bookId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        status: 'failed',
        error_message: String(errorMessage).slice(0, 500),
      }),
    });
  } catch {
    /* ignore */
  }
}

export async function handleExtract(request, auth, env) {
  if (auth.kind !== 'user') return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const text = String(body.text || '').trim();
  const title = String(body.title || 'Untitled book').slice(0, 200);
  const author = body.author ? String(body.author).slice(0, 120) : null;
  const year = parseInt(body.year) || null;

  if (text.length < 200)
    return badRequest('text_too_short', 'Need at least 200 characters of book content');
  if (text.length > 60000)
    return badRequest(
      'text_too_long',
      'Max 60,000 chars per extract call. Split larger books into chunks.'
    );

  // 1. Register the upload
  let bookId = null;
  try {
    const r = await sbService(env, '/uploaded_books', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: auth.userId,
        title,
        author,
        year,
        file_size_bytes: text.length,
        status: 'processing',
      }),
    });
    if (r.ok) {
      const arr = await r.json();
      bookId = arr[0]?.id || null;
    }
  } catch {
    /* continue without book id */
  }

  // 2. Ask Claude to extract
  let extracted = [];
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        system: EXTRACT_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `BOOK TITLE: ${title}\nAUTHOR: ${author || 'unknown'}\n\n--- BOOK TEXT ---\n${text}`,
          },
        ],
      }),
    });
    if (r.ok) {
      const cd = await r.json();
      const raw = (cd.content?.[0]?.text || '')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/```$/, '')
        .trim();
      try {
        extracted = JSON.parse(raw);
      } catch {
        extracted = [];
      }
      if (!Array.isArray(extracted)) extracted = [];
    }
  } catch (err) {
    if (bookId) await markBookFailed(bookId, err.message, env);
    return json({ error: 'claude_failed', detail: err.message }, 500);
  }

  // 3. Insert each formula
  let inserted = 0;
  const skipped = [];
  for (const f of extracted) {
    if (!f.name || !Array.isArray(f.components) || !f.components.length) {
      skipped.push({ name: f.name || '?', reason: 'missing_fields' });
      continue;
    }
    const total = f.components.reduce((s, c) => s + (parseFloat(c.percentage) || 0), 0);
    if (total < 95 || total > 105) {
      skipped.push({ name: f.name, reason: `unbalanced_${total.toFixed(1)}%` });
      continue;
    }
    try {
      const ins = await sbService(env, '/formulas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          name: f.name,
          name_en: f.name,
          category: f.category || 'specialty',
          sub_category: f.sub_category || null,
          form_type: f.form_type || 'liquid',
          components: f.components,
          process_conditions: f.process_conditions || {},
          properties: f.properties || {},
          trust_score: 78,
          source_title: title,
          source_author: author,
          source_year: year,
          uploaded_book_id: bookId,
          added_by_user_id: auth.userId,
        }),
      });
      if (ins.ok) inserted++;
      else skipped.push({ name: f.name, reason: 'db_insert_failed' });
    } catch (err) {
      skipped.push({ name: f.name, reason: err.message });
    }
  }

  // 4. Mark book done
  if (bookId) {
    await sbService(env, `/uploaded_books?id=eq.${bookId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status: 'done', formulas_extracted: inserted }),
    });
  }

  return json({
    book_id: bookId,
    found: extracted.length,
    inserted,
    skipped,
    preview: extracted.slice(0, 3),
  });
}
