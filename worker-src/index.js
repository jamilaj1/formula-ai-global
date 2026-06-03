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
import { handleChat, handleListSessions, handleLoadMessages, handleChatExport } from './handlers/chat.js';
import { handleTranslate } from './handlers/translate.js';
import {
  handleSaveFormula,
  handleMyFormulas,
  handleLibraryList,
  handleLibraryGet,
  handleLibraryUpdate,
  handleLibraryDelete,
  handleLibraryProjects,
  handleLibraryPdf,
  handleLibraryImportPreview,
  handleLibraryImportCommit,
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
import { runDailyCostReport } from './handlers/cost_report.js';
import {
  handleConsultingIntake,
  handleConsultingList,
  handleConsultingDraft,
  handleConsultingDeliver,
  handleConsultingResend,
  handleConsultingPay,
} from './handlers/consulting.js';
import { handleAdminFinancials } from './handlers/admin.js';
import { handleTranslationsList, handleTranslationUpsert, handleTranslationDelete } from './handlers/translations_admin.js';
import { handleCommunityStats } from './handlers/stats.js';
import { handleClientError } from './handlers/client_error.js';
import {
  handleTestimonialSubmit,
  handleTestimonialsApproved,
  handleTestimonialsAdmin,
  handleTestimonialModerate,
} from './handlers/testimonials.js';
import {
  handleTeamList,
  handleTeamCreate,
  handleTeamMembers,
  handleTeamInvite,
  handleTeamInvitations,
  handleTeamAccept,
  handleTeamLeave,
  handleTeamRemoveMember,
} from './handlers/team.js';
import {
  handleEnterpriseLead,
  handleEnterpriseList,
  handleEnterpriseLeadUpdate,
  handleEnterpriseOnepager,
} from './handlers/enterprise.js';
import { withObservability } from './observability.js';

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

async function handleRequest(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Health
      if (path === '/' || path === '/health') return healthResponse();

      // Observability self-test (Phase 1.3): deliberately throws so we can
      // confirm Sentry + Better Stack are catching exceptions end-to-end.
      // Returns nothing useful in production — keep it but don't advertise it.
      // Auth-gated by a header so a scraper can't spam it.
      if (path === '/debug/throw') {
        if (request.headers.get('x-debug-key') !== 'formula-ai-obs-2026') {
          return new Response('forbidden', { status: 403, headers: corsHeaders });
        }
        throw new Error('Observability self-test — this exception is intentional.');
      }
      // Direct shipSentry test (no exception path) — verifies the envelope POST
      // actually reaches Sentry. Returns a JSON diagnostic so we can see exactly
      // what happened without parsing tail logs.
      if (path === '/debug/sentry') {
        if (request.headers.get('x-debug-key') !== 'formula-ai-obs-2026') {
          return new Response('forbidden', { status: 403, headers: corsHeaders });
        }
        const { shipSentry } = await import('./observability.js');
        const fakeErr = new Error('Direct sentry-test from /debug/sentry endpoint');
        await shipSentry(env, fakeErr, ctx, { source: 'debug-endpoint', path: '/debug/sentry' });
        return json({
          ok: true,
          dsn_set: !!env.SENTRY_DSN,
          dsn_len: (env.SENTRY_DSN || '').length,
          dsn_prefix: (env.SENTRY_DSN || '').slice(0, 20),
        });
      }

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
      if (path === '/search') return await handleSearch(url, auth, env, request);
      if (path === '/usage') return await handleUsage(auth, env);
      // Public community counter for the campaign landing page (cached 5min).
      if (path === '/stats/community') return await handleCommunityStats(env);
      // E5 — real-user (browser) error capture → Sentry + Better Stack.
      if (path === '/be/client-error' && request.method === 'POST')
        return await handleClientError(request, env);
      // Real social proof (D3): public approved wall + user submit + owner moderation.
      if (path === '/be/testimonials/approved' && request.method === 'GET')
        return await handleTestimonialsApproved(env);
      if (path === '/be/testimonial/submit' && request.method === 'POST')
        return await handleTestimonialSubmit(request, auth, env);
      if (path === '/be/testimonials/admin' && request.method === 'GET')
        return await handleTestimonialsAdmin(auth, env);
      if (path === '/be/testimonial/moderate' && request.method === 'POST')
        return await handleTestimonialModerate(request, auth, env);

      // i18n — on-demand EN→AR translation of formula free-text (cached in KV).
      if (path === '/translate' && request.method === 'POST')
        return await handleTranslate(request, auth, env);

      // Chat
      if (path === '/chat' && request.method === 'POST')
        return await handleChat(request, auth, env);
      if (path === '/chat/sessions' && request.method === 'GET')
        return await handleListSessions(auth, env);
      if (path === '/chat/messages' && request.method === 'GET')
        return await handleLoadMessages(url, auth, env);

      // Phase 9.4 — export one chat session as Markdown or PDF
      if (path === '/chat/export' && request.method === 'GET')
        return await handleChatExport(url, auth, env);

      // Personal library (Phase 4 + 13)
      if (path === '/save_formula' && request.method === 'POST')
        return await handleSaveFormula(request, auth, env);
      if (path === '/my_formulas' && request.method === 'GET')
        return await handleMyFormulas(auth, env);
      if (path === '/library' && request.method === 'GET')
        return await handleLibraryList(auth, env, url);
      // Phase 4: list distinct projects for the workspace sidebar.
      if (path === '/library/projects' && request.method === 'GET')
        return await handleLibraryProjects(auth, env);
      // Phase 9.3: CSV / XLSX bulk import for enterprise onboarding.
      if (path === '/library/import/preview' && request.method === 'POST')
        return await handleLibraryImportPreview(request, auth, env);
      if (path === '/library/import/commit' && request.method === 'POST')
        return await handleLibraryImportCommit(request, auth, env);
      // Phase 4.4: PDF export (must match BEFORE the generic /library/:id)
      if (path.startsWith('/library/') && path.endsWith('/pdf') && request.method === 'GET') {
        const inner = path.slice('/library/'.length, -('/pdf'.length));
        return await handleLibraryPdf(inner, auth, env);
      }
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

      // Claude-powered insights (auth-aware: picks Sonnet for paid plans,
      // caches answers per identical formula, records cost to api_usage).
      if (path === '/safety' && request.method === 'POST')
        return await handleSafety(request, auth, env);
      if (path === '/lab' && request.method === 'POST')
        return await handleLab(request, auth, env);

      // Consulting (Phase 2). Public intake + owner-only admin endpoints.
      if (path === '/be/consulting/intake' && request.method === 'POST')
        return await handleConsultingIntake(request, auth, env);
      if (path === '/be/consulting/list' && request.method === 'GET')
        return await handleConsultingList(auth, env);
      if (path === '/be/consulting/draft' && request.method === 'POST')
        return await handleConsultingDraft(request, auth, env);
      if (path === '/be/consulting/deliver' && request.method === 'POST')
        return await handleConsultingDeliver(request, auth, env);
      if (path === '/be/consulting/resend' && request.method === 'POST')
        return await handleConsultingResend(request, auth, env);
      if (path === '/be/consulting/pay' && request.method === 'POST')
        return await handleConsultingPay(request, auth, env);

      // Phase 9.5 — owner-only financial dashboard (MRR / ARR / LTV /
      // plan distribution / Claude operational cost / gross margin).
      if (path === '/be/admin/financials' && request.method === 'GET')
        return await handleAdminFinancials(auth, env);

      // Phase 9.x — owner-only translation overrides (Step 3: corrections win over AI).
      if (path === '/be/admin/translations' && request.method === 'GET')
        return await handleTranslationsList(auth, env);
      if (path === '/be/admin/translation' && request.method === 'POST')
        return await handleTranslationUpsert(request, auth, env);
      if (path === '/be/admin/translation/delete' && request.method === 'POST')
        return await handleTranslationDelete(request, auth, env);

      // Phase 9.2 — multi-seat enterprise teams.
      if (path === '/be/team/list'    && request.method === 'GET')
        return await handleTeamList(auth, env);
      if (path === '/be/team/create'  && request.method === 'POST')
        return await handleTeamCreate(request, auth, env);
      if (path === '/be/team/accept'  && request.method === 'POST')
        return await handleTeamAccept(request, auth, env);
      if (path.startsWith('/be/team/') && request.method === 'GET') {
        const rest = path.slice('/be/team/'.length);
        // /be/team/<id>/members
        if (rest.endsWith('/members')) {
          const teamId = rest.slice(0, -('/members'.length));
          return await handleTeamMembers(teamId, auth, env);
        }
        // /be/team/<id>/invitations
        if (rest.endsWith('/invitations')) {
          const teamId = rest.slice(0, -('/invitations'.length));
          return await handleTeamInvitations(teamId, auth, env);
        }
      }
      if (path.startsWith('/be/team/') && request.method === 'POST') {
        const rest = path.slice('/be/team/'.length);
        if (rest.endsWith('/invite')) {
          const teamId = rest.slice(0, -('/invite'.length));
          return await handleTeamInvite(teamId, request, auth, env);
        }
        if (rest.endsWith('/leave')) {
          const teamId = rest.slice(0, -('/leave'.length));
          return await handleTeamLeave(teamId, auth, env);
        }
      }
      if (path.startsWith('/be/team/') && request.method === 'DELETE') {
        // /be/team/<teamId>/member/<userId>
        const parts = path.slice('/be/team/'.length).split('/');
        if (parts.length === 3 && parts[1] === 'member') {
          return await handleTeamRemoveMember(parts[0], parts[2], auth, env);
        }
      }

      // Enterprise B2B (Phase 3). Public lead intake + owner-only admin.
      // Public enterprise leave-behind PDF (F2).
      if (path === '/be/enterprise/onepager' && request.method === 'GET')
        return await handleEnterpriseOnepager(env);
      if (path === '/be/enterprise/lead' && request.method === 'POST')
        return await handleEnterpriseLead(request, auth, env);
      if (path === '/be/enterprise/list' && request.method === 'GET')
        return await handleEnterpriseList(auth, env);
      if (path.startsWith('/be/enterprise/lead/') && request.method === 'PATCH')
        return await handleEnterpriseLeadUpdate(request, auth, env, path.slice('/be/enterprise/lead/'.length));

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
}

/**
 * Cloudflare Cron handler. Fires on the cron schedules in wrangler.toml.
 * Currently a single schedule: 09:00 UTC daily → daily Claude cost email.
 *
 * `event.cron` is the cron expression string ("0 9 * * *"). If we add
 * more schedules later, branch on this value.
 *
 * Errors here go to the Workers `Tail` stream (Observability tab) but
 * must never propagate — the runtime will retry on its own schedule.
 */
async function handleScheduled(event, env, ctx) {
  try {
    if (event.cron === '0 9 * * *') {
      ctx.waitUntil(runDailyCostReport(env));
      return;
    }
    console.warn('[cron] unhandled schedule:', event.cron);
  } catch (err) {
    console.error('[cron] handler threw', err?.message);
  }
}

// Wrap with observability: every request is timed, non-2xx & slow ones get
// shipped to Better Stack, unhandled exceptions are captured with stack.
export default {
  fetch:     withObservability(handleRequest),
  scheduled: handleScheduled,
};
