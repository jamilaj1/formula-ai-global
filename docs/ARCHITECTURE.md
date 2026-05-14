# Architecture — Formula AI Global

> This document describes what is **actually deployed today** and what is
> **scaffolded for a future build**. It exists because the repo contains both,
> and the difference matters.

---

## What's deployed (production)

```
┌────────────────────────────────────────────────────────────────┐
│  Browser (jamilformula.com on Hostinger Premium)               │
│  - 22 static HTML pages                                        │
│  - assets/app.js, styles.css, supabase-client.js, ...          │
│  - PWA (manifest.json + sw.js)                                 │
│  - i18n via data-i18n-ar attributes (12 languages)             │
└────────────────────────────────────────────────────────────────┘
              │ HTTPS
              ▼
┌────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker — formula-ai-brain.jamilaj1.workers.dev     │
│  Source: worker-src/ (modular ESM, 14 files)                   │
│  Deploy: worker.js (esbuild bundle, ~83 KB)                    │
│  Routes:                                                       │
│    GET  /search       AI-driven formula search                 │
│    GET  /usage        daily search quota                       │
│    POST /chat         conversational AI w/ tool-use            │
│    GET  /chat/sessions, /chat/messages                         │
│    POST /save_formula, /extract, /discover, /safety, /lab      │
│    GET  /library, /library/:id                                 │
│    POST /scale, /cost, /prices                                 │
│    POST /paystack/checkout, /paystack/webhook                  │
│    POST /stripe/checkout,   /stripe/webhook                    │
└────────────────────────────────────────────────────────────────┘
              │              │
              ▼              ▼
┌──────────────────────┐  ┌────────────────────────────────────┐
│  Supabase (Postgres) │  │  Anthropic Claude (haiku-4-5)      │
│  Project:            │  │  Tool-use for search planning      │
│    ivabcssceeaqgqjzgmdx  │  ≈$0.0008 per request                │
│  Tables:             │  └────────────────────────────────────┘
│   formulas (3,381)   │
│   profiles           │
│   chat_sessions      │
│   chat_messages      │
│   user_formulas      │
│   uploaded_books     │
│   api_usage          │
│   ...                │
│  RLS: enabled        │
│  Auth: email + Google│
└──────────────────────┘
```

The Cloudflare Worker is the **only** backend the production site talks to.
The browser also talks directly to Supabase (Auth + simple SELECT via the
JS client) using the public anon key.

---

## Worker source tree (`worker-src/`)

The Worker is no longer a single 2,348-line file. Source lives in modular
ES modules and is bundled by esbuild into the single `worker.js` that
Cloudflare runs.

```
worker-src/
├── index.js                     ← router + dispatch (entry point)
├── config.js                    ← plan limits + payment plan maps
├── auth.js                      ← resolveCaller, dailyLimitFor, usage tracking
│
├── lib/
│   ├── responses.js             ← json(), corsHeaders, badRequest, unauthorized
│   ├── crypto.js                ← HMAC verify (Stripe SHA-256, Paystack SHA-512)
│   ├── supabase.js              ← sb() anon-key, sbService() service-role
│   └── claude.js                ← claudeMessages + extractClaudeJson
│
└── handlers/
    ├── search.js                ← /search + Claude plan generation
    ├── usage.js                 ← /usage
    ├── chat.js                  ← /chat + tool-use loop + sessions + messages
    ├── insights.js              ← /safety + /lab (Claude analysis)
    ├── library.js               ← /save_formula + /my_formulas + /library CRUD
    ├── extract.js               ← /extract (book → formulas via Claude)
    ├── discover.js              ← /discover (S2 + Europe PMC + arXiv + patents)
    ├── prices.js                ← /prices + /cost + /scale
    └── payments.js              ← Paystack + Stripe checkout + webhooks
                                   (HMAC signature verification enforced)
```

### Module dependency rules

- `handlers/*` can import from `lib/*`, `config.js`, and `auth.js`.
- `lib/*` are leaf modules: they only depend on Web Platform APIs.
- `auth.js` may import from `lib/` and `config.js`.
- `index.js` is the only entry point — nothing imports from it.

### Build pipeline

```bash
npm run build:worker        # esbuild worker-src/index.js → worker.js
npm run build:worker:watch  # rebuild on save
npm run deploy:worker       # build + wrangler deploy
npm test                    # build + run vitest against the bundled worker.js
```

The bundler emits **one** ES module file (`worker.js`) targeting Cloudflare's
`compatibility_date = "2024-10-01"`. The bundle keeps modules separate as
named functions internally — no runtime overhead beyond a slightly larger
file (82.8 KB vs the original 80.9 KB monolith).

### Deployment options

Two equivalent workflows:

1. **Wrangler CLI** (recommended):
   ```bash
   npx wrangler login              # once per machine
   npm run deploy:worker            # bundle + deploy
   ```
2. **Paste-into-dashboard** (fallback):
   - Run `npm run build:worker` locally
   - Copy the contents of `worker.js` into Cloudflare dashboard → Quick Edit
   - Save and Deploy

Both produce identical results. CI prefers (1); a developer with no CLI
access can still ship via (2).

---

## What's scaffolded (not deployed)

```
backend/   — Python FastAPI app
  main.py
  ai_brain/{brain, extractor, completer, validator, grader, ...}
  knowledge_collector/
  app/api/v1, app/api/v2
  services/{certification, ready_recipes, university_service, ...}
  bots/{telegram_bot, whatsapp_bot}
```

This is a **larger, future product** that overlaps the Worker in functionality
(both have `/search`, `/chat`, etc.). The intent (per `README.md`) is to grow
the platform into a richer backend later, with the Worker remaining as a thin
public edge for high-traffic read paths.

**Today**: nothing in `backend/` is wired to a public domain. Don't redirect
production traffic at it without a deployment plan (Vercel / Render / Fly.io).

---

## Database layout (`database/`)

```
schema.sql              — original full schema (one big file)
schema_extensions.sql   — additions on top of schema.sql
seed.sql                — 4 plans + 12 industries + 10 chemicals
migrations/             — phase-by-phase add-on SQL
  supabase_full_schema.sql
  supabase_addon_master_formulas.sql
  supabase_phase2_addon.sql       (Phase 2 — auth/limits)
  supabase_phase3_chat.sql        (Phase 3 — chat)
  supabase_phase4_5.sql           (Phase 4–5 — library + learn)
  supabase_phase12_discover.sql   (Phase 12 — paper/patent harvesting)
  supabase_phase13_15.sql         (Phase 13–15 — library + prices + scale)
  supabase_paystack.sql           (Paystack billing)
```

Run these in order in the Supabase SQL Editor when bootstrapping a new
project. The phase files are append-only by design.

**Open question:** `schema.sql` defines its own `users` table, but the
Worker and the production app rely on Supabase Auth's `auth.users` plus
a `profiles` table (Supabase pattern). These two models contradict.
The Worker-side `profiles` is the source of truth in production.

---

## Frontend ↔ Worker contract

```
JS client (assets/supabase-client.js)
  ─ search(q)      →  GET  WORKER_URL/search?q=...
  ─ getUsage()     →  GET  WORKER_URL/usage
  ─ analyzeSafety  →  POST WORKER_URL/safety
  ─ predictLab     →  POST WORKER_URL/lab
  ─ startCheckout  →  POST WORKER_URL/paystack/checkout (falls back to /stripe)

  + direct Supabase JS client for:
      getById(id), browse({...}), session/auth
```

The browser sends `Authorization: Bearer <supabase_access_token>` to the
Worker. The Worker resolves the user via `GET ${SUPABASE_URL}/auth/v1/user`
then looks up `profiles.plan` to apply the right rate limit.

---

## Rate limits (single source of truth)

Hard-coded in `worker.js` (top of file):

| Plan         | Daily searches | Notes                           |
| ------------ | -------------- | ------------------------------- |
| guest        | 10             | unauthenticated, keyed by IP    |
| starter      | 20             | free signed-in                  |
| professional | 100            | $49/mo                          |
| business     | 500            | $299/mo                         |
| enterprise   | 100,000        | $999/mo (effectively unlimited) |

**These numbers must match `pricing.html` and `PROJECT_HISTORY.md`.** If you
change one, change all three.

---

## Tests

```
tests/worker.test.js      — Vitest, exercises real worker.js via ES default export
backend/tests/test_*.py   — Pytest, mocks supabase + anthropic clients
.github/workflows/ci.yml  — runs both on push/PR
```

Run locally:

```bash
npm test                  # JS worker tests
pytest backend/tests      # Python backend tests
npm run lint              # ESLint on worker + assets
ruff check backend        # Python lint
```

---

## What's NOT in the repo

- Wrangler config (`wrangler.toml`) — the Worker is deployed via the
  Cloudflare dashboard "paste-and-deploy" workflow. To switch to `wrangler
deploy`, add a `wrangler.toml` and split `worker.js` into modules. The
  current single-file constraint exists for that reason.
- Next.js frontend — referenced in README as "next phase" but not started.
- Mobile native shell — the PWA stands in for now.
