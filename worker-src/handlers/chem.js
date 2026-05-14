/**
 * chem.js — proxy to the Python chemistry backend (RDKit).
 *
 * Cloudflare Workers run on V8 isolates and can't execute Python or
 * native C extensions like RDKit. The chemistry endpoints are served
 * by a separate FastAPI app (deployed on Render/Fly.io), and this
 * module just forwards requests, attaches auth context, and surfaces
 * errors with a uniform shape.
 *
 * Routes proxied (all under /chem/* on the Worker):
 *   GET  /chem/health                → backend RDKit health check
 *   POST /chem/properties            → single-SMILES molecular descriptors
 *   POST /chem/properties/batch      → up to 100 SMILES at once
 *   POST /chem/canonicalize          → normalize a SMILES + InChI key
 *   POST /chem/lipinski              → Rule of Five evaluation
 *
 * The Worker prepends `/api` to the path before forwarding, so
 * `/chem/properties` on the Worker hits `/api/chem/properties` on FastAPI.
 *
 * Required env: CHEM_BACKEND_URL (e.g. https://formula-ai-chem.onrender.com)
 */
import { json, corsHeaders } from '../lib/responses.js';

const TIMEOUT_MS = 30000;

/**
 * Proxy a /chem/* request to the Python backend.
 * @param {string} path  e.g. "/chem/properties"
 * @param {Request} request
 * @param {object} auth
 * @param {object} env
 */
export async function handleChemProxy(path, request, auth, env) {
  if (!env.CHEM_BACKEND_URL) {
    return json(
      {
        error: 'chem_backend_not_configured',
        detail:
          'RDKit-powered chemistry endpoints require CHEM_BACKEND_URL set in Worker secrets. ' +
          'Deploy the FastAPI backend (see backend/Dockerfile + render.yaml) and point this var at it.',
      },
      503
    );
  }

  // /chem/* on Worker → /api/chem/* on Python backend
  const targetUrl = new URL('/api' + path, env.CHEM_BACKEND_URL);

  // Preserve query string
  const url = new URL(request.url);
  url.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

  const init = {
    method: request.method,
    headers: {
      'Content-Type': request.headers.get('Content-Type') || 'application/json',
      Accept: 'application/json',
      // Pass auth context — backend can choose to honour or ignore.
      // These are advisory (the Worker has already authenticated the caller).
      'X-Forwarded-User-Id': auth.userId || '',
      'X-Forwarded-User-Plan': auth.plan || 'guest',
      'X-Forwarded-User-Kind': auth.kind || 'guest',
    },
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
  }

  // Bound the upstream call so a slow backend can't hang a Worker isolate.
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
      return json({ error: 'chem_backend_timeout', detail: `>${TIMEOUT_MS}ms` }, 504);
    }
    return json({ error: 'chem_backend_unreachable', detail: err.message }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
