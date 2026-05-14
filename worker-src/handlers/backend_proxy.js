/**
 * backend_proxy.js — single proxy to the Python FastAPI backend.
 *
 * Forwards three families of routes:
 *   /chem/*    → /api/chem/*     (RDKit properties, similarity, ML, PubChem)
 *   /agents/*  → /api/agents/*   (multi-agent reasoning)
 *   /vision/*  → /api/vision/*   (Claude Vision label/structure/MSDS)
 *
 * Cloudflare Workers can't run Python or native libs, so anything heavy
 * lives in FastAPI on Render/Fly.io and the Worker just forwards.
 *
 * Required env: CHEM_BACKEND_URL  e.g.  https://formula-ai-chem.onrender.com
 */
import { json, corsHeaders } from '../lib/responses.js';

const TIMEOUT_MS = 60000; // generous — vision endpoints can take 20-40 s

/**
 * Generic proxy to the Python backend.
 * @param {string} path     e.g. "/chem/properties" or "/agents/evaluate"
 * @param {Request} request
 * @param {object} auth
 * @param {object} env
 */
export async function handleBackendProxy(path, request, auth, env) {
  if (!env.CHEM_BACKEND_URL) {
    return json(
      {
        error: 'backend_not_configured',
        detail:
          'The Python backend URL is missing. Set CHEM_BACKEND_URL in ' +
          'Worker secrets to enable /chem/*, /agents/*, and /vision/*.',
      },
      503
    );
  }

  // Worker path → backend path (prepend /api)
  const targetUrl = new URL('/api' + path, env.CHEM_BACKEND_URL);

  // Preserve query string
  const url = new URL(request.url);
  url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

  const init = {
    method: request.method,
    headers: {
      'Content-Type': request.headers.get('Content-Type') || 'application/json',
      Accept: 'application/json',
      'X-Forwarded-User-Id': auth.userId || '',
      'X-Forwarded-User-Plan': auth.plan || 'guest',
      'X-Forwarded-User-Kind': auth.kind || 'guest',
    },
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  init.signal = controller.signal;

  try {
    const r = await fetch(targetUrl.toString(), init);
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: {
        ...corsHeaders,
        'Content-Type': r.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return json({ error: 'backend_timeout', detail: `>${TIMEOUT_MS}ms` }, 504);
    }
    return json({ error: 'backend_unreachable', detail: err.message }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
