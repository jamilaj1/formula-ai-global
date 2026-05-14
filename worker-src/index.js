/**
 * Formula AI Brain — Cloudflare Worker entry point.
 *
 * This file is the public router. Each path dispatches to a domain-specific
 * handler in ./handlers/. Helpers, config, and shared library code live in
 * ./lib/ and ./config.js.
 *
 * Build: esbuild bundles this whole tree into a single ../worker.js, which
 * is what gets deployed (paste-into-dashboard or `wrangler deploy`).
 *
 * Routes:
 *   GET  /                                  → health metadata
 *   GET  /health                            → alias of /
 *   GET  /search?q=…                        → AI-driven formula search
 *   GET  /usage                             → caller's daily search quota
 *   POST /chat                              → conversational AI w/ tool-use
 *   GET  /chat/sessions                     → user's chat list
 *   GET  /chat/messages?session_id=…        → full message history
 *   POST /save_formula                      → save a formula to user library
 *   GET  /my_formulas                       → list user's saved formulas
 *   GET  /library                           → full library list (Phase 13)
 *   GET  /library/:id                       → single user formula
 *   PUT  /library/:id                       → update user formula
 *   DELETE /library/:id                     → delete user formula
 *   GET  /prices                            → list user's ingredient prices
 *   POST /prices                            → upsert an ingredient price
 *   DELETE /prices/:id                      → delete a price
 *   POST /cost                              → batch cost calculator
 *   POST /scale                             → batch scale calculator
 *   POST /extract                           → extract formulas from book text
 *   POST /discover                          → harvest from S2/PubMed/Lens/arXiv
 *   GET  /discover/jobs                     → user's discovery jobs
 *   GET  /discover/debug?q=…                → diagnostic single-source run
 *   POST /safety                            → Claude safety analysis
 *   POST /lab                               → Claude lab property prediction
 *   POST /paystack/checkout                 → create Paystack transaction
 *   GET  /paystack/verify?reference=…       → verify a Paystack reference
 *   POST /paystack/webhook                  → Paystack events (HMAC-verified)
 *   POST /stripe/checkout                   → Stripe checkout session
 *   POST /stripe/webhook                    → Stripe events (HMAC-verified)
 *
 * Required environment variables (Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY      (secret) — Claude API
 *   SUPABASE_URL           (text)   — https://….supabase.co
 *   SUPABASE_ANON_KEY      (secret) — public anon key
 *   SUPABASE_SERVICE_KEY   (secret) — service-role key (RLS bypass)
 *   PAYSTACK_SECRET_KEY    (secret) — sk_live_… or sk_test_… (also signs webhooks)
 *   PAYSTACK_PLAN_PRO/BIZ/ENT (text) — Paystack plan codes for subscriptions
 *   STRIPE_SECRET_KEY      (secret) — optional, only if Stripe is used
 *   STRIPE_WEBHOOK_SECRET  (secret) — optional, required if Stripe webhook enabled
 *   STRIPE_PRICE_PRO/BIZ/ENT (text) — optional, Stripe price IDs
 */
import { json, corsHeaders } from './lib/responses.js';
import { resolveCaller } from './auth.js';

import { handleSearch } from './handlers/search.js';
import { handleUsage } from './handlers/usage.js';
import { handleSafety, handleLab } from './handlers/insights.js';
import { handleChat, handleListSessions, handleLoadMessages } from './handlers/chat.js';
import {
  handleSaveFormula,
  handleMyFormulas,
  handleLibraryList,
  handleLibraryGet,
  handleLibraryUpdate,
  handleLibraryDelete,
} from './handlers/library.js';
import { handleExtract } from './handlers/extract.js';
import {
  handleDiscover,
  handleListDiscoveryJobs,
  handleDiscoverDebug,
} from './handlers/discover.js';
import {
  handlePricesList,
  handlePriceUpsert,
  handlePriceDelete,
  handleCost,
  handleScale,
} from './handlers/prices.js';
import {
  handlePaystackCheckout,
  handlePaystackVerify,
  handlePaystackWebhook,
  handleStripeCheckout,
  handleStripeWebhook,
} from './handlers/payments.js';
import { handleChemProxy } from './handlers/chem.js';
import { handleBackendProxy } from './handlers/backend_proxy.js';

const SERVICE_VERSION = 'Formula AI Brain v8';

function healthResponse() {
  return json({
    status: 'ok',
    service: SERVICE_VERSION,
    endpoints: [
      '/search',
      '/usage',
      '/chat',
      '/chat/sessions',
      '/chat/messages',
      '/save_formula',
      '/my_formulas',
      '/library',
      '/prices',
      '/cost',
      '/scale',
      '/extract',
      '/discover',
      '/discover/jobs',
      '/safety',
      '/lab',
      '/paystack/checkout',
      '/paystack/verify',
      '/paystack/webhook',
      '/stripe/checkout',
      '/stripe/webhook',
      '/chem/health',
      '/chem/properties',
      '/chem/properties/batch',
      '/chem/canonicalize',
      '/chem/lipinski',
      '/chem/lookup/name',
      '/chem/lookup/cas',
      '/chem/similarity',
      '/chem/find_similar',
      '/chem/find_substitute',
      '/chem/substructure',
      '/chem/conflict_check',
      '/chem/solubility',
      '/chem/solubility/batch',
      '/chem/stability_predict',
      '/chem/toxicity_scan',
      '/chem/toxicity_scan_formula',
      '/agents/evaluate',
      '/agents/formulate',
      '/agents/run/{name}',
      '/vision/label',
      '/vision/structure',
      '/vision/msds',
    ],
    phases: {
      1: 'search',
      2: 'auth+limits',
      3: 'chat',
      4: 'library',
      5: 'learn',
      12: 'discover (papers+patents)',
      13: 'library + cost + scale',
      14: 'paystack billing (global, Ghana-friendly)',
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Health
      if (path === '/' || path === '/health') return healthResponse();

      // Webhooks BEFORE auth (each verifies its own signature)
      if (path === '/stripe/webhook' && request.method === 'POST') {
        return await handleStripeWebhook(request, env);
      }
      if (path === '/paystack/webhook' && request.method === 'POST') {
        return await handlePaystackWebhook(request, env);
      }

      // Resolve caller (authenticated user OR anonymous IP-keyed guest)
      const auth = await resolveCaller(request, env);

      // Read-only
      if (path === '/search') return await handleSearch(url, auth, env);
      if (path === '/usage') return await handleUsage(auth, env);

      // Chat
      if (path === '/chat' && request.method === 'POST')
        return await handleChat(request, auth, env);
      if (path === '/chat/sessions' && request.method === 'GET')
        return await handleListSessions(auth, env);
      if (path === '/chat/messages' && request.method === 'GET')
        return await handleLoadMessages(url, auth, env);

      // Personal library (Phase 4 + 13)
      if (path === '/save_formula' && request.method === 'POST')
        return await handleSaveFormula(request, auth, env);
      if (path === '/my_formulas' && request.method === 'GET')
        return await handleMyFormulas(auth, env);
      if (path === '/library' && request.method === 'GET')
        return await handleLibraryList(auth, env);
      if (path.startsWith('/library/') && request.method === 'GET')
        return await handleLibraryGet(path.slice('/library/'.length), auth, env);
      if (path.startsWith('/library/') && request.method === 'PUT')
        return await handleLibraryUpdate(path.slice('/library/'.length), request, auth, env);
      if (path.startsWith('/library/') && request.method === 'DELETE')
        return await handleLibraryDelete(path.slice('/library/'.length), auth, env);

      // Prices + cost + scale (Phase 14/15)
      if (path === '/prices' && request.method === 'GET')
        return await handlePricesList(auth, env);
      if (path === '/prices' && request.method === 'POST')
        return await handlePriceUpsert(request, auth, env);
      if (path.startsWith('/prices/') && request.method === 'DELETE')
        return await handlePriceDelete(path.slice('/prices/'.length), auth, env);
      if (path === '/cost' && request.method === 'POST')
        return await handleCost(request, auth, env);
      if (path === '/scale' && request.method === 'POST')
        return await handleScale(request, auth, env);

      // Ingestion + discovery (Phase 5 + 12)
      if (path === '/extract' && request.method === 'POST')
        return await handleExtract(request, auth, env);
      if (path === '/discover' && request.method === 'POST')
        return await handleDiscover(request, auth, env);
      if (path === '/discover/jobs' && request.method === 'GET')
        return await handleListDiscoveryJobs(auth, env);
      if (path === '/discover/debug' && request.method === 'GET')
        return await handleDiscoverDebug(url, auth, env);

      // Claude-powered insights
      if (path === '/safety' && request.method === 'POST')
        return await handleSafety(request, env);
      if (path === '/lab' && request.method === 'POST')
        return await handleLab(request, env);

      // Payments (Paystack primary, Stripe legacy)
      if (path === '/paystack/checkout' && request.method === 'POST')
        return await handlePaystackCheckout(request, auth, env);
      if (path === '/paystack/verify' && request.method === 'GET')
        return await handlePaystackVerify(url, env);
      if (path === '/stripe/checkout' && request.method === 'POST')
        return await handleStripeCheckout(request, auth, env);

      // Chemistry / agents / vision endpoints — all proxied to the
      // Python FastAPI backend (Render/Fly.io). The proxy adds /api
      // prefix and forwards to env.CHEM_BACKEND_URL.
      if (path.startsWith('/chem/') || path === '/chem')
        return await handleChemProxy(path, request, auth, env);
      if (path.startsWith('/agents/') || path === '/agents')
        return await handleBackendProxy(path, request, auth, env);
      if (path.startsWith('/vision/') || path === '/vision')
        return await handleBackendProxy(path, request, auth, env);

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (err) {
      return json({ error: 'unhandled', detail: err.message }, 500);
    }
  },
};
