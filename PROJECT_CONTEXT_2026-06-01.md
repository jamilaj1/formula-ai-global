# PROJECT_CONTEXT — Formula AI Global (2026-06-01 master)

> **Single complete reference.** Hand this to any engineer or to the next
> AI session and they can continue without wasting the owner's time. It
> folds in the full BUILD_ROADMAP (revenue model, phase status, what's
> next, the explicit DO-NOT list) so this one file is enough.
>
> Supersedes the 2026-05-14 `PROJECT_CONTEXT.md` and the 2026-05-19
> snapshot. Those are kept for history; THIS is the current state.

---

## 0. TL;DR — where the project stands today

**Formula AI Global** (jamilformula.com) is a production chemistry-AI
platform for industrial formulators (cosmetics, home care, cleaners,
agrochemicals — NOT drug discovery). It is **fully deployed and live**
across all four tiers, with real cheminformatics (RDKit + PubChem),
a 6-agent reasoning layer, Claude Vision, 3 trained ML models, semantic
vector search, a live consulting business, enterprise B2B + teams, and a
financial dashboard.

| Layer | Status | URL |
|---|---|---|
| Frontend (Hostinger / LiteSpeed) | 🟢 Live | https://jamilformula.com |
| Edge (Cloudflare Worker) | 🟢 Live | https://formula-ai-brain.jamilaj1.workers.dev |
| Backend (Render · FastAPI + RDKit) | 🟢 Live | https://formula-ai-chem.onrender.com |
| Database (Supabase Postgres) | 🟢 Live | ivabcssceeaqgqjzgmdx.supabase.co |
| Errors (Sentry) | 🟢 Live | region `de` |
| Uptime + logs (Better Stack) | 🟢 Live | 3 monitors, free tier |
| CI (GitHub Actions) | 🟢 Live | push-to-`main` → Worker + frontend deploy |

**Every technical phase in the roadmap (1–4, 7, all of 9) is shipped and
live.** Remaining growth phases (5 lead-gen, 6 distribution, 8
procurement) are blocked ONLY on owner-supplied content/decisions, not
engineering.

---

## 1. Owner & business context

- **Owner:** Jamil Abduljalil (jamilaj1@gmail.com). 25+ years industrial
  chemist. Not a coder; communicates in Arabic (Arabic + English mix
  works well). Will catch fabricated technical/data claims instantly.
- **Production footprint:** oversees operations producing **~2,000
  tons/MONTH** across multiple countries, PLUS his own plant **DosLunas
  in Ghana producing 50+ tons/DAY** (daily — corrected 2026-06-01; ≈1,500
  t/mo). Hands-on plant experience in Ghana, Saudi Arabia, UAE, Syria.
- **Audience:** 60,000+ Facebook followers in the chemical/industrial
  sector — the launch audience, who judge from minute one.
- **Revenue goal:** **$50,000/month within 9–12 months** via 4 streams
  (see §10).

### Positioning rules (HARD-WIRED — re-read every session)

1. **GLOBAL brand, not regional** (owner directive 2026-06-01). Suppliers,
   buyers, users are worldwide from day one. NEVER scope a feature,
   supplier roster, marketplace, or campaign to one country. Default UI
   placeholders are neutral/global ("🌍 Your country"), never a single
   flag. Ghana = the founder's plant (credibility asset on about.html) +
   the Paystack merchant account (a billing fact) — neither limits reach.
2. **English-first deliverables.** Reports, SDS, consulting output are
   English by default (the global standard in industrial chemistry);
   translation to any language is "available on request." The site UI
   still flips AR/EN via `data-i18n-ar` — that's UI, not the deliverable.
3. **Verify before execute.** Specs can be stale. Read live code before
   claiming "X works." Cite file:line.
4. **Write complete code.** Full file content or proper Edit calls — never
   "replace X with Y" diff snippets.
5. **Other-AI suggestions** (DeepSeek/GPT/Gemini): take the good, flag the
   wrong/stale, NEVER delete from the core project without explicit
   permission.
6. **Commit + push every change.** Push to `main` IS the deploy. After a
   deploy, sanity-check with `curl -I` (don't trust "CI green" alone).

---

## 2. Architecture (what runs where)

```
FRONTEND — Hostinger (jamilformula.com), LiteSpeed + LSCache (1h max-age)
  36 HTML pages · PWA (sw.js) · i18n (data-i18n-ar) · assets/*.js (?v=N cache-bust)
  Unified navbar: 6 primary items + Tools dropdown (17 links), synced by
  scripts/sync_navbar.py; hamburger < 900px.
        │ HTTPS fetch, Supabase JWT forwarded
EDGE — Cloudflare Worker (formula-ai-brain.jamilaj1.workers.dev)
  worker.js (~151 KB, esbuild bundle of worker-src/) — thin auth + routing
  Claude (Sonnet paid / Haiku free) + KV cache + rate limit + cost tracking
  proxies /chem/* /agents/* /vision/* and heavy work → Render backend
  Sentry + Better Stack via observability.js
        │ HTTPS (CHEM_BACKEND_URL) + x-formula-internal shared secret
BACKEND — Render (formula-ai-chem.onrender.com)
  FastAPI · Python 3.11 · Docker · RDKit · PubChem · 6 agents · Vision ·
  3 RF models · reportlab PDFs · openpyxl import · Resend email
        │ PostgREST / service-role key
DATABASE — Supabase (ivabcssceeaqgqjzgmdx, eu-west-1)
  Postgres + RLS + Auth · pgvector · Storage (consulting-drafts) · pg_net→Resend

Side: GitHub Actions push→deploy (Worker + frontend) · Render auto-deploy
      Anthropic Claude · OpenAI embeddings · Paystack (live) · Resend email
```

**Key principle:** every intelligent feature degrades gracefully — no
RDKit → closed-form; no trained model → heuristic; no OpenAI key → vector
search no-ops and chat falls back to keyword search; no Better Stack token
→ silent no-op. The API contract never breaks.

---

## 3. The four-tier deploy pipeline (CI)

`.github/workflows/deploy.yml` runs on every push to `main`. Two parallel
soft-fail-isolated jobs:

- **Worker:** `cloudflare/wrangler-action@v3` + explicit accountId
  `bb2863bb7e4de6f2d44fc5ea7dbef5cc` + `deploy --keep-vars` (keeps
  dashboard-set secrets). Do NOT revert to raw `npx wrangler` — it
  deadlocks on a remote-config prompt.
- **Frontend:** Python → `sync_formula_count.py` → `build_phase3.py`
  (zips frontend, auto-bumps `?v=N` from `git rev-list --count HEAD`,
  AND ships `.htaccess` + `robots.txt` + `manifest.json` — added 2026-05-29
  after they were silently missing) → FTP via `SamKirkland/FTP-Deploy-Action`
  with **`server-dir: ./`** (the FTP user is chroot'd INSIDE public_html).

`git push origin main` is the only command needed for a release. After it,
HTML changes show only after the LSCache TTL (1h) or a manual **hPanel →
Cache Manager → Purge All**.

---

## 4. Database — tables, views, storage, migrations

**Tables:** `formulas` (3,381, RLS-locked + `embedding vector(1536)`),
`chemicals_database` (~7K), `user_formulas` (workspace saves + project +
tags), `profiles`, `api_usage` (cost tracking), `chat_sessions`,
`chat_messages`, `consultation_requests`, `enterprise_details`,
`enterprise_leads`, `teams`, `team_members`, `team_invitations`.

**Views:** `user_formula_projects`, `formula_embedding_progress`,
`claude_cost_today`. **Storage:** `consulting-drafts` (private bucket).
**RPCs:** `match_formulas`, `list_my_teams`, `user_has_team_paid`,
`claude_cost_report`, `is_paid_or_credits`, `send_daily_cost_report`.

**Migrations are MANUAL** — paste into Supabase SQL Editor (Role:
postgres); CI never auto-applies DDL. All applied as of 2026-06-01:
```
2026-05-22_server_gate.sql            (1.1 RLS + anti-scrape)
2026-05-25_claude_cost_guards.sql     (1.2)
2026-05-26_consultation_requests.sql  (2.2)
2026-05-28_consulting_drafts_storage.sql (2.3)
2026-05-28_enterprise.sql             (3.x)
2026-05-28_workspace_extend.sql       (4.x — project + tags + GIN)  ✅ applied
2026-05-29_vector_search.sql          (9.1 pgvector + HNSW + RPC)   ✅ applied
2026-05-30_teams.sql                  (9.2 teams + invites + RPCs)  ✅ applied
```
(Earlier `supabase_*.sql` cover the original schema, chat, library, paystack,
discover, indexes.)

---

## 5. Worker routes (worker-src/, deployed in worker.js)

- **AI:** `/search` `/chat` `/chat/sessions` `/chat/messages`
  `/chat/export?format=md|pdf` `/safety` `/lab`
- **Library (workspace):** `/save_formula` `/my_formulas` `/library`
  `/library/projects` `/library/{id}` `/library/{id}/pdf`
  `/library/import/preview` `/library/import/commit`
- **Consulting (Phase 2):** `/be/consulting/{intake,list,draft,deliver,resend,pay}`
- **Enterprise (Phase 3):** `/be/enterprise/{lead,list,lead/{id}}`
- **Teams (Phase 9.2):** `/be/team/{list,create,accept, {id}/members,
  {id}/invite, {id}/invitations, {id}/leave, {id}/member/{userId}}`
- **Admin (Phase 9.5):** `/be/admin/financials` (owner-only)
- **Payments:** `/paystack/{checkout,verify,webhook}` `/stripe/{checkout,webhook}` (legacy)
- **Proxied to Render:** `/chem/*` `/agents/*` `/vision/*` `/extract` `/discover*` `/prices*` `/cost` `/scale`
- **Ops:** `/health` `/usage` `/debug/{throw,sentry}`

**Backend routers** (`backend/app/api/`): v1 (search/formulas/chat/export),
v2 (consulting, library_pdf, chat_export, library_import, compliance,
subscription, ads, global_initiatives), chem/*, agents/*, vision/*, admin/*.

---

## 6. Secrets / environment (values live only in dashboards)

**Cloudflare Worker `formula-ai-brain`:** `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY` (9.1 embeddings), `SUPABASE_URL/ANON_KEY/SERVICE_KEY`,
`PAYSTACK_SECRET_KEY`, `PAYSTACK_PLAN_PRO/BIZ/ENT`, `PAYSTACK_WEBHOOK_SECRET`,
`BACKEND_INTERNAL_SECRET` (shared w/ Render), `CHEM_BACKEND_URL`,
`SENTRY_DSN`, `BETTER_STACK_TOKEN/HOST`, `RATELIMIT_KV` (binding, also
caches), `SERVICE_NAME/ENV`.

**Render `formula-ai-chem`:** `SUPABASE_URL/SERVICE_KEY/ANON_KEY`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `BACKEND_INTERNAL_SECRET`,
`RESEND_API_KEY` (consulting deliver + team invites), `CHEM_BACKEND_URL`,
`CORS_ORIGINS`, `ADMIN_API_KEY`, `SERVICE_NAME/ENV`, `BETTER_STACK_*`.

**Supabase:** `_owner_email_config()` holds the Resend key + from/owner
addresses (single config point for all pg_net emails).

**Local `.env`** (repo root, gitignored): `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY` — for backfill + ML trainers +
the embed script. Never read aloud / committed.

---

## 7. Cost guards & intelligence

- **Claude:** `claude-sonnet-4-5` for paid plans, `claude-haiku-4-5` for
  guest/free; one-shot Sonnet→Haiku fallback on 429/529/503. KV cache
  (SHA-256 key, 24h). Per-call cost estimated → `api_usage`. Daily 09:00
  UTC cost-report email (pg_net + Resend).
- **Vector RAG (9.1):** OpenAI `text-embedding-3-small` (1536-dim);
  3,381 formulas embedded; `match_formulas` HNSW cosine ANN; chat's
  `search_formulas` tool runs semantic-first then ILIKE. Cost ≈
  $0.00002/query.
- **3 RF models** on Render (logP R²=0.884; compatibility AUC=0.891;
  stability). RDKit + PubChem + 6 agents + Claude Vision.

---

## 8. Security posture

- Phase 1.1 server gate: RLS on `formulas` (anon can't dump ingredients;
  only `get_formula` RPC returns them to paid/credit users) + per-IP rate
  limit (30/min).
- HMAC-verified Paystack + Stripe webhooks; JWT forwarding; CORS locked;
  admin-gated metrics; GDPR IP truncation.
- **CSP (9.6):** `'unsafe-eval'` removed (zero eval/Function in our code);
  `'unsafe-inline'` still present (future nonce phase). `.htaccess` is now
  shipped by CI.
- Internal endpoints (`/api/v2/consulting/*`, `/library/import/*`,
  `/chat/render-pdf`) gated by `x-formula-internal` shared secret; the
  Worker is the public auth gate and stamps `user_id` from the JWT.
- Tests: **192 vitest + 39 pytest** (231 total) — libs, handlers,
  webhooks, render paths, import parser, team role-gates.

---

## 9. Feature inventory (every page / capability live)

**Public/AI tools:** index, chat (+MD/PDF export), search (vector+keyword),
substitute, scan (Vision), agent (6-agent), predict, similarity,
calculators (cost/scale/HLB/pH/SDS-stub), encyclopedia, industries (40),
compliance, formulas, formula, learn (Teach-AI), discover, programs,
contribute.
**Business:** consulting (3 packages, intake→pay→AI draft→deliver PDF),
enterprise (sales page + lead form), pricing, about (founder authority).
**Account:** login, register, dashboard, workspace (save/edit/project/tag/
compare/PDF/CSV-XLSX import), team (multi-seat) + accept-invite, admin
(signups + consulting + financials tabs).

---

## 10. ═══ BUILD ROADMAP (folded in) ═══

### North Star — $50,000/month in 9–12 months

| Stream | Target | First $ |
|---|---|---|
| AI+Human consulting reports | $15K/mo | Month 2 |
| Enterprise SaaS (~40 factories × $500) | $20K/mo | Month 4–9 |
| Procurement commissions (GLOBAL suppliers) | $8K/mo | Month 4–6 |
| Pro subscriptions ($25/$50/$125) | $7K/mo | Month 1–6 |

### Phase status

| Phase | Status | Notes |
|---|---|---|
| **1** Hardening (gate+RLS, cost guards, Sentry+BetterStack, CI) | ✅ Live | |
| **2** Consulting — First Revenue (incl. Approve & deliver loop) | ✅ Live | intake→pay→AI draft→PDF→Resend→delivered + resend |
| **3** Enterprise B2B foundation | ✅ Live | enterprise.html + leads + founder authority |
| **4** Workspace (retention) | ✅ Live | projects, tags, compare, PDF, CSV/XLSX import |
| **7** Calculators | ✅ Live | cost, scale-up, HLB, pH; SDS = stub → Quick Diagnostic |
| **9.1** Vector DB + RAG | ✅ Live | pgvector, 3,381 embedded, semantic chat |
| **9.2** Team accounts (multi-seat) | ✅ Live | teams + invites + RLS + accept flow |
| **9.3** CSV/XLSX import | ✅ Live | preview + commit, openpyxl |
| **9.4** Chat export MD/PDF | ✅ Live | |
| **9.5** Financials dashboard | ✅ Live | MRR/ARR/LTV/ARPU/margin in admin |
| **9.6** CSP tighten | ✅ Live | unsafe-eval removed |
| **9.7** Test coverage | ✅ Live | 231 tests |
| **UX** Navbar redesign | ✅ Live | unified 33 pages, responsive |
| **5** Lead-gen + email | ⏸️ blocked | needs lead-magnet PDFs from owner |
| **6** Distribution (LinkedIn + SEO + social proof) | ⏸️ blocked | needs owner voice + testimonials |
| **8** Procurement marketplace | ⏸️ blocked | needs a GLOBAL supplier roster + commission % |

### Remaining Phase 9 sub-items (optional, safe to ship anytime)
9.3 CSV import ✅ · 9.4 export ✅ done. Still open: time-series charts on
the financials dashboard; an embedding auto-refresh trigger (re-embed a
formula when its name/components change); a template-download for the
CSV importer.

### What we explicitly DO NOT do
- 100,000 thin AI-generated SEO pages (Google penalises since 2024).
- Replace Paystack with Stripe (Paystack fits target markets; revisit
  ONLY if a global-enterprise buyer needs invoicing/Stripe — flag to
  owner, add Stripe *alongside*, never rip Paystack out).
- Delete depth pages (lab/predict/similarity/agent) — B2B depth signals.
- Rebrand colours / fantasy acquisitions / 30-day feature freeze.

---

## 11. Pending owner actions

**Technical: NONE.** All migrations applied (incl. teams 2026-05-30),
OpenAI key set + 3,381 rows embedded, Resend key set. Routine: purge
LSCache after a deploy to see HTML changes immediately.

**Growth (content/decisions only):**
- Phase 5 — outline the first lead-magnet (e.g. "10 Common Detergent
  Formulation Mistakes"); AI fleshes it out.
- Phase 6 — 3–5 LinkedIn posts in the owner's voice; 3–5 real testimonials.
- Phase 8 — a GLOBAL supplier roster + commission structure.

---

## 12. Hard-won lessons (don't relearn these)

- **LSCache 1h** holds HTML + headers; new `?v=N` is on disk instantly but
  live only after TTL or manual purge. Not a bug.
- **FTP chroot** is INSIDE public_html → `server-dir: ./`. Wrong path
  creates a phantom `public_html/public_html/…` HTTP never reads.
- **CI must ship `.htaccess`/robots/manifest** — they were missing for
  months; fixed in build_phase3.py 2026-05-29.
- **Migrations are manual** — no `exec_sql` RPC exists; don't write a
  "do it for you" path.
- **navbar sync** — the parser must scan to the next real navbar sibling,
  not the first `</ul>` (the Tools dropdown nests a `<ul>`). Edit the
  PRIMARY/TOOLS lists in `scripts/sync_navbar.py`, re-run, commit.
- **BOM in Worker secrets** — `wrangler secret put` from piped PowerShell
  injected a UTF-8 BOM; observability.js tolerates it.
- **Windows cp1256** — Python prints use ASCII (`->` not `→`); read .env
  with explicit path in one-off scripts.

---

## 13. Accounts & repo

- GitHub `jamilaj1/formula-ai-global` (`main`) — push = deploy.
- Render `formula-ai-chem` (srv-d82osao3kofs73d1didg).
- Cloudflare worker `formula-ai-brain`, account bb2863bb7e4de6f2d44fc5ea7dbef5cc.
- Supabase `ivabcssceeaqgqjzgmdx` (eu-west-1, Pro).
- Hostinger u680581922, root `public_html`, FTP user `…githubdeploy`.
- Paystack live · Anthropic (Sonnet/Haiku) · OpenAI (embeddings) · Resend
  · Sentry (de) · Better Stack.

**Build:** `npm run build:worker`. **Tests:** `npm test` (vitest) +
`pytest backend/tests`. **Deploy:** `git push origin main`.

**Doc map:** this file = current master. `BUILD_ROADMAP.md` = live working
pointer (still the place to update phase status). `HANDOFF_2026-05-28.md` =
prior session handoff. `PROJECT_HISTORY.md` / older `PROJECT_CONTEXT*.md` =
history. `docs/ARCHITECTURE.md` + per-phase setup docs as referenced.

---

_Last updated: 2026-06-01 — after Phases 2-close, navbar redesign, and all
of Phase 9 (9.1 vector RAG, 9.2 teams, 9.3 import, 9.4 chat export, 9.5
financials, 9.6 CSP, 9.7 tests), plus the global-brand positioning + the
DosLunas 50+ t/DAY correction. All technical work is live; growth phases
await owner content._
