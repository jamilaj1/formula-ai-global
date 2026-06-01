# Formula AI Global — Build Roadmap to $50K/month

> **Single source of truth** for "what do we work on next?"
> Update the **Currently Working On** pointer when a step is completed.
> Steps inside a phase are **sequential** — do not skip.

---

## 🎯 Currently Working On

**Phases 1–4 + 7 + ALL of 9 are DONE.** Holding before Phase 5 / 6 / 8
because they need owner-supplied content (lead-magnet PDFs, LinkedIn
posts, a global supplier roster). Phase 9 technical moat is fully
shipped (9.1 vector RAG, 9.2 teams, 9.3 import, 9.4 chat export,
9.5 financials, 9.6 CSP, 9.7 tests).

POSITIONING (owner directive, 2026-06-01): Formula AI Global is a
**global** brand — suppliers, buyers, and users are worldwide from day
one. Do NOT scope any feature, supplier network, or marketplace to a
single country. Ghana is where the founder's DosLunas plant physically
operates (a credibility asset on about.html) and where the Paystack
merchant account is registered (a billing fact) — neither limits the
product's global reach. See memory: strategy-global-not-regional.

Phase 3 closed 2026-05-28 — enterprise B2B foundation live:
- enterprise_details + enterprise_leads tables (RLS: anon INSERT,
  signed-in user SELECT-own, pg_net trigger emails owner on each lead).
- enterprise.html with hero, 6 capability cards, $500/mo from-pricing,
  contact form posting to /be/enterprise/lead.
- about.html founder authority: LinkedIn CTA + 6-card "Career
  highlights" section (2000+ t/mo, DosLunas plant, 40+ categories,
  4 countries, 3381 curated formulas, SFDA/SASO/GSO/EU/FDA wins).
- Site-wide: Enterprise nav link in 29 pages.

Phase 4 closed 2026-05-28 — Formula Workspace (retention):
- user_formulas extended with `project` (TEXT) + `tags` (TEXT[] + GIN
  index) + `user_formula_projects` view for sidebar grouping.
- workspace.html: project sidebar, tag filter, search/sort, edit
  modal (JSON components editor), delete, PDF export, compare two
  formulas side-by-side with added/removed/changed-percent diff.
- Worker /library/projects + /library/{id}/pdf endpoints.
- FastAPI /api/v2/library/{id}/pdf renders A4 spec sheet with
  reportlab — title, meta, description, notes, ingredients table
  with running total, process conditions, properties, disclaimer.

Phase 7 closed 2026-05-28 — daily-use calculators:
- Single calculators.html page with 5 tabs.
- Batch cost, lab→production scale-up (multi-unit), surfactant
  blend HLB → application band, buffer-aware pH correction with
  acid/base mismatch detection.
- SDS generator is a stub today — sends serious requests to the
  Quick Diagnostic consulting package ($1,000, 48h SLA).
- Pure client-side JS; no recipe ever leaves the browser unless
  saved to Workspace.

Phase 9.5 shipped 2026-05-29 — Financials dashboard in admin.html:
- `worker-src/handlers/admin.js` — `handleAdminFinancials(auth, env)`,
  owner-only (auth.email gate). Parallel PostgREST queries fan-out
  to count plan distribution (5 plans × HEAD-style count=exact),
  total signups, last-30d signups, paid+delivered consulting revenue,
  and Claude est_cost_usd over 30 days. Aggregates locally and
  returns one JSON with: MRR, ARR, active paid users, total signups,
  new signups 30d, revenue mix (subscription vs consulting 30d),
  consulting lifetime revenue (paid + delivered), Claude operational
  cost + call count + cache hit ratio, gross margin %, ARPU,
  LTV (ARPU × 12-month assumed lifetime), conversion %, and the
  assumption block (plan prices + CAC notice).
- Worker route `GET /be/admin/financials` registered in
  worker-src/index.js right after the consulting routes.
- admin.html: new "Financials" tab next to Signups + Consulting.
  Six headline cards (MRR / ARR / Active paid / Total signups /
  Revenue 30d / Gross margin), four unit-economics cards (ARPU /
  LTV / CAC=— / Signup→paid %), revenue-mix horizontal stacked bar,
  plan-distribution per-row bars (enterprise → free, longest first),
  consulting lifetime card (paid / delivered / total), Claude
  operational cost card (spend / calls / cache hit), assumption
  footnote. No chart library — pure HTML + inline styles, so the
  Phase 9.6 CSP (no unsafe-eval) stays clean.
- 13 vitest assertions in tests/handlers/admin.test.js — auth gate,
  MRR formula, ARPU/LTV math, division-by-zero guards, consulting
  status sums, cache hit ratio, gross margin formula, conversion %,
  assumption block shape.

What's not in 9.5 (intentionally deferred)
  - True CAC. Requires ad spend → leads attribution. Tied to Phase 5
    (lead-gen) — when we have a marketing channel we can measure
    spend per signup acquired and surface CAC properly.
  - True LTV. Requires actual churn data, which needs 6+ months of
    paid-plan cohorts to be meaningful. Today's LTV is the honest
    "ARPU × 12" annual-value estimate.
  - Time-series charts (signups per day, MRR over months). The
    dashboard is point-in-time today; trend charts are a future iter
    once we've decided whether to invest in chart.js or build SVG
    sparklines by hand.

Phase 9.7 shipped 2026-05-29 — Test coverage expansion (+97 tests):
- vitest unit tests for the three Worker libs the chat/search/insights
  paths depend on every single request:
    * tests/lib/cache.test.js      — buildCacheKey determinism, KV put/get
      round-trip, TTL clamping (60s minimum, 86400s default), fail-soft
      when RATELIMIT_KV is unbound, swallowed KV errors. (17 tests)
    * tests/lib/ratelimit.test.js  — fixed-window counter, per-bucket
      isolation, Retry-After / X-RateLimit-* headers, CF-Connecting-IP
      resolution, negative-limit clamp, fail-open without KV. (13 tests)
    * tests/lib/claude.test.js     — plan→model routing (paid → Sonnet,
      free → Haiku, case-insensitive), 429/529/503 Sonnet→Haiku
      fallback, no fallback from 500, no fallback when starting from
      Haiku, cost_usd computation rounded to 6 dp, JSON extraction
      from text/code-fence blocks. (35 tests)
- vitest tests for the consulting handlers (the revenue path):
    * tests/handlers/consulting.test.js — intake validation (invalid
      package/email/missing fields), email lowercase, amount_usd
      stamping per package, signed-in user_id attachment, 3-per-hour
      rate limit, deliver owner gate + markdown size cap + backend
      error propagation, resend owner gate + URL routing, pay
      custom-needs-discovery / already-paid / missing-key branches.
      (25 tests)
- pytest tests for the backend rendering paths:
    * backend/tests/test_consulting_render.py — _render_markdown
      sections per package, proposal ingredient table rendering,
      alternative-formulation Option N labelling, safety/cost agent
      block, inline bold/italic/code HTML, PDF round-trip, table
      rendering, blockquote, _safe_pdf_filename strips unsafe chars
      and lowercases. (20 tests)
    * backend/tests/test_library_pdf.py — _render_pdf minimal row,
      full component table, process_conditions + properties, malformed
      percentage (caught a real bug — see below). (12 tests)

Bug found and fixed during 9.7 (proof the coverage was needed):
- backend/app/api/v2/library_pdf.py: the cell formatter `f"{float(pct):.2f}"`
  was unguarded, so a malformed `percentage: "not a number"` from a
  user_formulas row would crash the entire PDF render with ValueError.
  The accumulator above it was already in a try/except, so the author
  had clearly intended to be defensive — they just missed the cell
  line. Extracted a small `_fmt_pct()` helper that mirrors the
  accumulator's pattern. Lockdown test
  `test_render_pdf_with_malformed_percentage_doesnt_crash` would have
  caught any future regression.

Net: 90 new Worker tests + 32 new backend tests = 122 new assertions,
total suite now 135 vitest + 60 pytest. Coverage of the lib layer is
near-complete; the Phase 9.1 vector.js path is still untested (next
iteration). Pre-existing test_health.py failures are unrelated to 9.7
and were not introduced here.

Phase 9.2 shipped 2026-06-01 — multi-seat enterprise teams:
- Schema 2026-05-30_teams.sql: teams + team_members (owner/admin/member)
  + team_invitations (token + 14-day expiry). RLS members-see-own-team;
  trigger seeds owner row on create; trigger auto-accepts an invite when
  the invitee signs up with the matching email; pg_net+Resend trigger
  emails the tokenised accept link. RPCs list_my_teams + user_has_team_paid.
- Worker /be/team/{list,create,<id>/members,<id>/invite,<id>/invitations,
  accept,<id>/leave,<id>/member/<userId>}. Signed-in only; every mutation
  re-checks role in code (service_role bypasses RLS). Seat-limit + dedupe
  on invite; owner can't leave / can't be removed.
- team.html (manage) + accept-invite.html (token landing). 22 vitest.
- OWNER ACTION: paste 2026-05-30_teams.sql into Supabase SQL Editor.

Phase 9.4 shipped 2026-05-29 — chat history export (Markdown + PDF):
- Worker GET /chat/export?session_id=&format=md|pdf (owner-of-session
  gate). MD rendered in-Worker; PDF via FastAPI /api/v2/chat/render-pdf
  reusing the consulting reportlab parser. Export buttons in chat header.
  13 vitest + 7 pytest.

Phase 9.3 shipped 2026-05-29 — CSV/XLSX bulk import:
- FastAPI /api/v2/library/import/{preview,commit} (openpyxl + csv,
  5MB/2000-row caps, per-row validation). Worker proxies stamp user_id
  from JWT. workspace.html Import modal (pick→preview→commit).
  9 vitest + 18 pytest.

Phase 9.6 shipped 2026-05-29 — CSP tighten (unsafe-eval removed):
- Audited every committed `.js` and inline `<script>` across the repo
  with `rg '\beval\s*\(|new\s+Function|Function\s*\(\s*["'\''`]'`. Zero
  hits in our 11 assets/*.js files and all 33 root *.html inline
  scripts. The only third-party JS we load (@supabase/supabase-js@2
  from esm.sh) is documented as eval-free.
- `.htaccess`: dropped `'unsafe-eval'` from script-src. Header note in
  the file explains how the audit was done so the next person doesn't
  re-add it speculatively. Kept `'unsafe-inline'` for now — that's a
  separate tightening with CSP-nonces (future phase).
- Net effect: a CSP-aware browser will now refuse to execute eval()
  or new Function('…') even if an XSS vector smuggled one in. One
  more layer of defence on top of Phase 1.1 (server gate) and 1.2
  (cost guards).

Phase 9.1 shipped 2026-05-29 — Vector DB + RAG augmentation:
- pgvector extension + `formulas.embedding vector(1536)` column +
  HNSW index. RPC `public.match_formulas(query_embedding, top_k,
  min_similarity)` is SECURITY DEFINER + REVOKE EXECUTE FROM PUBLIC so
  only the Worker (service_role) can call it — same anti-scraping
  pattern as Phase 1.1's direct-SELECT lockdown.
- `scripts/embed_formulas.py` — resumable backfill that reads
  `formula_embedding_progress` view, builds a short string per row
  (name + sub_category + top-5 components by %), embeds via OpenAI
  text-embedding-3-small (1536 dims), and PATCHes the rows. ~$0.04 of
  OpenAI credit for the whole 3,381-row backfill, runs in 3-4 minutes
  from a laptop. Re-running is safe — it skips already-embedded rows.
- `worker-src/lib/vector.js` — `embedQuery()` + `matchFormulas()` +
  one-call `semanticSearchFormulas()`. Every export returns null/[]
  on any failure (network, missing key, RPC fault) and never throws,
  so the chat tool degrades gracefully to ILIKE-only when OpenAI is
  unreachable or OPENAI_API_KEY is unset.
- `worker-src/handlers/chat.js` — the `search_formulas` tool now runs
  a vector pass FIRST (top-10 with cosine ≥ 0.30) and then merges
  with the existing ILIKE variants. Returns `vector_hits` in the tool
  result so we can see in logs how often semantic search carried the
  query. Backward-compatible: with no OPENAI_API_KEY set, behaviour
  is identical to today.

Owner actions required to fully activate 9.1:
  1. Paste `database/migrations/2026-05-29_vector_search.sql` into
     Supabase SQL Editor (Role: postgres). Idempotent.
  2. In Cloudflare Workers dashboard for `formula-ai-brain`, add
     secret `OPENAI_API_KEY = sk-…` (get it from platform.openai.com
     → API keys). Until this secret is set, the chat tool keeps
     working but the vector pass is a no-op.
  3. Run `python scripts/embed_formulas.py` once locally with
     SUPABASE_URL + SUPABASE_SERVICE_KEY + OPENAI_API_KEY in env.
     Watch the % progress in stdout; budget ~$0.04 + 4 minutes.

Phase 2 fully closed 2026-05-28 — consulting service is live end-to-end,
INCLUDING the Approve & deliver loop:
- `POST /api/v2/consulting/{id}/deliver` on the FastAPI backend renders
  the (possibly-edited) markdown to a polished A4 PDF via reportlab,
  uploads to the private `consulting-drafts` bucket under `final/`,
  signs a 30-day URL, and emails the client via Resend with the PDF as
  a base64 attachment. On success the row flips to status='delivered'
  with `final_pdf_url` populated.
- `POST /api/v2/consulting/{id}/resend` re-emails the SAME final PDF
  without re-rendering — used when the client says "I lost the email".
- Worker proxies: `/be/consulting/deliver` + `/be/consulting/resend`,
  owner-only (auth.email gate + x-formula-internal secret), mirror the
  draft endpoint's pattern.
- admin.html "Consulting" tab now has real "Approve & deliver to
  client", "Resend email", "Re-render & re-deliver" (force=true), and
  "View final PDF" buttons — replacing the Phase 2.5 placeholder. The
  textarea contents are forwarded as `markdown_override` so owner edits
  go straight into the PDF in a single click.
- Requires Render env var `RESEND_API_KEY` (and optionally
  `RESEND_FROM_EMAIL` + `OWNER_EMAIL` to override the defaults
  `signups@jamilformula.com` / `jamilaj1@gmail.com`).

Phase 2 closed 2026-05-28 — consulting service is live end-to-end:
- `consulting.html` — 3 packages, bilingual, FAQ schema, intake form.
- `consultation_requests` table + RLS + pg_net Resend email trigger
  (owner gets a notification the moment a brief lands).
- Cloudflare Worker `/be/consulting/intake|list|draft|pay` —
  thin auth + routing layer that forwards heavy work to FastAPI.
- FastAPI `/api/v2/consulting/draft/{id}` runs the 6-agent
  orchestrator, renders Markdown matching the deliverable promised
  on consulting.html, uploads to private Supabase Storage bucket
  `consulting-drafts`, sets a 7-day signed URL on the row.
- `admin.html` has a new "Consulting" tab: two-pane layout with
  request list (left), full detail + draft editor (right), badge
  with count of open requests, deep-link `#consulting/<id>` from the
  owner-notification email.
- Paystack one-time charge per package via `/be/consulting/pay` —
  visitor submits the brief, instantly gets "Pay $X now" button,
  hosted Paystack URL, webhook flips status to 'paid' which unlocks
  the "Generate AI draft" button in admin. Custom Project does NOT
  get instant-pay (discovery call required).
- Positioning fix: deliverable is English-first ("global standard in
  industrial chemistry"); translation to any language available on
  request. Earlier "Arabic or English" copy was making us look like a
  regional MENA shop and undersold the brand.
- FTP-chroot lesson: the deploy workflow had been silently writing
  every CI deploy into a nested `public_html/public_html/public_html/`
  directory the live HTTP server never read; live site stayed on the
  25-May manual upload for 3 days through 5 successful Action runs.
  Fix in commit e79b40a: `server-dir: ./` because the FTP user is
  chroot'd INSIDE public_html already. Always sanity-check live with
  `curl -I` against the just-deployed file size, not just by trusting
  CI green.

Step 1.4 closed 2026-05-26 — push-to-deploy CI is live:
- `.github/workflows/deploy.yml` runs on every push to main. Two parallel
  jobs (worker / frontend), both soft-fail-isolated so an outage of one
  deploy target can't block the other.
- Worker job uses `cloudflare/wrangler-action@v3` + explicit
  `accountId` + `--keep-vars` (plain `npx wrangler deploy` was failing
  in CI from a remote-config diff prompt that can't be answered
  non-interactively; the official action wraps that correctly).
- Frontend job runs `sync_formula_count.py` (live row count → HTML),
  then `build_phase3.py` (which now auto-increments `?v=N` from
  `git rev-list --count HEAD` — no more manual OLD/NEW edits), unzips,
  and FTPs via `SamKirkland/FTP-Deploy-Action@v4.3.5`.
- FTP-chroot gotcha learned the hard way: account
  `u680581922.githubdeploy` is chroot'd to the *domain root*
  (/home/u.../domains/jamilformula.com/), NOT to public_html. So
  `server-dir` MUST be `./public_html/`; first push uploaded to the
  domain root and the live site quietly stayed on yesterday's manual
  upload. Verified by `curl ftp://...` listing.
- LiteSpeed cache caveat: Hostinger LSCache holds HTML for 1h
  (max-age=3600) and ignores cache-bypass headers. After a deploy, the
  new `?v=N` is on disk immediately but the live site shows it only
  after the cache TTL or a manual purge in hPanel → Cache Manager.
  Not blocking — just expected behavior to remember on hotfix days.

Step 1.3 closed 2026-05-26 — Sentry (errors) + Better Stack (uptime) live:
- Sentry project `node-cloudflare-workers` (region: `de`, ingest
  `o4511451032387584.ingest.de.sentry.io`). DSN stored as Worker secret
  `SENTRY_DSN`. Hand-rolled envelope POST (no SDK — keeps the bundle
  ~30 kB lighter and avoids nodejs_compat). Verified: 4× `/debug/throw`
  produced `status 200` from Sentry's envelope endpoint; events appeared
  in the Issues feed.
- Better Stack source `formula-ai-worker` on Cloudflare HTTP integration
  (cluster `eu-fsn-3`). Token + ingest host stored as `BETTER_STACK_TOKEN`
  + `BETTER_STACK_HOST` Worker secrets. `withObservability` ships every
  non-2xx and every >3s request, plus the `cf_country`, `cf_colo`,
  anonymized IP prefix, and user_agent.
- 3 uptime monitors live (3-min interval, email alerts):
    Frontend         → https://jamilformula.com
    Worker           → https://formula-ai-brain.jamilaj1.workers.dev/health
    Chem backend     → https://formula-ai-chem.onrender.com/health
- Cost: $0/month (Sentry free 5k errors/mo + Better Stack free 10
  monitors + 3 GB logs + 100k exceptions). Upgrade path is open if/when
  traffic outgrows free tiers.
- Cleanup: stripped the temporary `[sentry]` console.log noise from
  `shipSentry`; `console.error` remains only for failed envelope POSTs.
- BOM hazard learned: `wrangler secret put` from a piped PowerShell
  string injected a UTF-8 BOM (`﻿`) at the start of the secret.
  Hardened `cleanSecret()` in `observability.js` strips it; future
  secret-handling code should treat secrets as potentially BOM-tainted.

To finish 1.4 (see PHASE 1 §1.4 below for full spec):
1. `.github/workflows/deploy.yml` — on push to main, run
   `sync_formula_count.py` + `build_phase3.py` + FTP upload to Hostinger.
2. Same action runs `wrangler deploy` for the Worker.
3. Done when `git push origin main` is the only command for a release.

Step 1.2 closed 2026-05-25 — verified end-to-end:
- `api_usage` now has `model`, `input_tokens`, `output_tokens`,
  `est_cost_usd`, `cache_hit` columns; `claude_cost_today` view + RPC
  `claude_cost_report(DATE)` + `send_daily_cost_report()` (uses pg_net
  + Resend via the existing `_owner_email_config()`).
- Worker model selection: `claude-sonnet-4-5` for paid plans
  (professional/business/enterprise), `claude-haiku-4-5` for guest/starter,
  one-shot fallback Sonnet→Haiku on 429/529.
- KV cache (24h TTL, SHA-256 keys) in `RATELIMIT_KV` namespace with
  `cache:` prefix — wired into `/search`, `/safety`, `/lab` (chat tool-use
  loop intentionally NOT cached because tool_result blocks vary every call).
- `recordUsage()` now accepts an optional meta object (model + tokens
  + cost + cache_hit) so all 6 Claude-aware handlers report accurately.
- Hotfix: `search.js` + `chat.js` switched from `sb()` (anon) to
  `sbService()` for direct `formulas` reads — Phase 1.1 RLS had blocked
  the Worker's own reads (caught only after deploy when /search 500'd).
- Cloudflare Cron Trigger `0 9 * * *` registered (Version ID
  `526a93de-c5bc-485d-b264-abd134efea48`); first daily email fires
  tomorrow 09:00 UTC.
- Verification: 2 identical /search?q=… calls → first burns 444 in / 42 out
  tokens ($0.000523), second returns `cache_hit=true` with 0 tokens / 0 cost.
  `claude_cost_today` view aggregates correctly; manual
  `SELECT send_daily_cost_report()` returns the email subject string.

To finish 1.3 (see PHASE 1 §1.3 below for full spec):
1. Sentry account ($26/mo); SDK in Worker + FastAPI backend.
2. Better Stack account ($25/mo); uptime monitors on the 3 endpoints.
3. Slack/email alerting wired to owner.

---

## 🏁 North Star

**$50,000/month recurring revenue within 9-12 months**, from a 4-stream mix:

| Stream | Target | First $ |
|---|---|---|
| AI+Human consulting reports | $15K/month | Month 2 |
| Enterprise SaaS (40 factories × $500) | $20K/month | Month 4-9 |
| Procurement commissions | $8K/month | Month 4-6 |
| Pro subscriptions | $7K/month | Month 1-6 |

---

## 📌 Status legend

- ⬜ Pending
- 🔄 In progress
- ✅ Done
- ⏸️ Blocked (note why on the step)
- ⏭️ Deferred to later phase (note new phase)

---

## PHASE 1 — HARDENING

> Goal: protect what we have **before** any growth push.
> Estimated: 1 week.

### 1.1 — Data scraping defense + server-side subscription gate ⬜
- **Why**: today anyone with the anon key can dump 3,381 formulas in seconds; the gate is JS-only and can be bypassed in DevTools. This kills B2B credibility.
- **What to build**:
  - SQL migration: new RPC `public.get_formula(formula_id UUID)` `SECURITY DEFINER` that returns the row WITH `ingredients` only if `is_paid_or_credits(auth.uid())` is TRUE; returns the row WITHOUT `ingredients` otherwise.
  - SQL migration: tighten RLS on `formulas` so direct `SELECT ingredients FROM formulas` is denied for anon/authenticated; only the RPC can read it.
  - Rate-limit in `worker-src/handlers/search.js` and any other public formulas endpoints: max 50 rows per request, 30 requests/min per IP (KV-backed counter).
  - Update `assets/supabase-client.js` `getById()` to call the RPC.
- **Files**: `database/migrations/2026-05-XX_server_gate.sql`, `worker-src/handlers/search.js`, `worker-src/lib/ratelimit.js` (new), `assets/supabase-client.js`.
- **Done when**:
  - Incognito browser hitting `/rest/v1/formulas?select=ingredients` returns `{}` or RLS error.
  - The RPC returns full ingredients only when called by a paid/credits user.
  - 31st request in a minute from the same IP returns HTTP 429.
  - `formula.html` still works for both paid and unpaid users.
- **Estimate**: 4-6 hours.

### 1.2 — Claude cost guards ⬜
- **Why**: a viral spike or abuse can run the Anthropic bill into the thousands overnight.
- **What to build**:
  - Per-user daily quota in `usage_log` (Pro = 100 Claude calls/day, free = 10).
  - Response cache in Worker KV keyed by hash(prompt) → 24-hour TTL.
  - Fallback to `claude-haiku-4-5` when `claude-sonnet-4-5` is rate-limited or when user is free-tier.
  - Daily cost report → owner email via Resend (re-use `pg_net` pipeline).
- **Files**: `worker-src/handlers/chat.js`, `worker-src/lib/claude.js`, new `worker-src/lib/cache.js`, new SQL function `record_claude_call(user_id, tokens, model)`.
- **Done when**:
  - Repeating the same chat question within 24h returns the cached answer (visible in Worker logs).
  - 101st chat in a day from a Pro user returns "Daily quota reached".
  - Daily 9 AM email lists cost per model.
- **Estimate**: 1 day.

### 1.3 — Sentry + Better Stack ⬜
- **Why**: we discover bugs from user complaints today. Need to discover them from logs.
- **What to build**:
  - Sentry account ($26/mo); SDK in Worker + FastAPI backend.
  - Better Stack account ($25/mo); uptime monitor on `jamilformula.com`, `formula-ai-brain.jamilaj1.workers.dev`, and the Render backend health endpoint.
  - Slack/email alerting wired to Jamil.
- **Files**: `worker-src/observability.js`, `backend/services/observability.py`.
- **Done when**:
  - A deliberately thrown error in chat appears in Sentry within 30 s.
  - Stopping the Render service triggers a Better Stack alert within 2 minutes.
- **Estimate**: 45 min + $51/month committed.

### 1.4 — One-command auto-deploy (CI) ⬜
- **Why**: manual `build_phase3.py` → FTP upload is error-prone. Need push-to-deploy.
- **What to build**:
  - GitHub Action: on push to `main`, run `sync_formula_count.py` + `build_phase3.py` + FTP-upload to Hostinger.
  - Worker deploy via Wrangler from same action.
- **Files**: `.github/workflows/deploy.yml`.
- **Done when**: `git push origin main` is the only command needed for a release.
- **Estimate**: 1 day.

---

## PHASE 2 — FIRST REVENUE (AI+Human Consulting)

> Goal: turn the 6 Claude agents we already have into a paid service.
> First $5-10K/month. Estimated: 1 week.

### 2.1 — `consulting.html` page ⬜
- **What to build**:
  - 3 packages: **Quick Diagnostic $1,000** / **Full Formulation Report $2,500** / **Custom Project $5,000+**.
  - Clear deliverable per package, sample report screenshots, FAQ.
  - Bilingual (AR/EN) via `data-i18n-ar`.
- **Done when**: page renders, mobile-friendly, links from navbar + pricing.html.
- **Estimate**: 1 day.

### 2.2 — Intake form + `consultation_requests` table ⬜
- **What to build**:
  - SQL migration: `consultation_requests(id, user_id, package, product_type, market, budget, brief TEXT, status, created_at, ai_draft_url, owner_decision)`.
  - Form on `consulting.html` writes to it.
  - On INSERT trigger fires Resend email to Jamil ("New consulting request: $package from $user").
- **Files**: `database/migrations/2026-05-XX_consulting.sql`, `consulting.html`.
- **Done when**: a submitted form creates a row, owner inbox gets the email.
- **Estimate**: 1 day.

### 2.3 — AI draft workflow (orchestrator → draft → owner review) ⬜
- **What to build**:
  - Worker endpoint `/be/consulting/draft` that calls `backend/agents/orchestrator.py` with the intake form data.
  - Output saved as Markdown in `consultation_requests.ai_draft_url`.
  - PDF generated server-side (existing tooling or `weasyprint`).
- **Files**: `worker-src/handlers/backend_proxy.js`, `backend/api/v2/consulting.py` (new).
- **Done when**: a request can produce a 3-5 page draft PDF within 60 seconds.
- **Estimate**: 2-3 days.

### 2.4 — Owner review UI in admin.html ⬜
- **What to build**:
  - Add a "Consulting requests" tab to `admin.html`.
  - List requests with status, brief, draft preview, Approve/Reject buttons.
  - On Approve → email PDF to customer via Resend (re-uses `_owner_email_config()`).
  - On Reject → form to add revision notes; orchestrator re-runs.
- **Files**: `admin.html`, new RPCs `admin_list_consulting()`, `admin_approve_consultation(id)`.
- **Done when**: owner can approve a request and the customer receives the PDF.
- **Estimate**: 1-2 days.

### 2.5 — Payment integration for consulting ⬜
- **What to build**: Paystack one-time payment link per package + webhook updates `consultation_requests.status='paid'` before draft is generated.
- **Done when**: payment must succeed before AI draft fires.
- **Estimate**: 1 day.

---

## PHASE 3 — ENTERPRISE B2B FOUNDATION

> Goal: open the channel that funds the $20K/month enterprise stream.
> Estimated: 3-4 days.

### 3.1 — Enterprise plan + `enterprise_details` table ⬜
- **What to build**:
  - Add `'enterprise'` as a valid value in `profiles.plan` (no enum — `plan` is TEXT).
  - New 1:1 child table `enterprise_details(user_id PK FK profiles(id), company_name, factory_location, industry_sector, monthly_quota, api_access_enabled, created_at, updated_at)` with RLS so only owner + the company itself can read.
  - Update `isPaid()` in `supabase-client.js` to treat `plan='enterprise'` as paid.
- **Files**: `database/migrations/2026-05-XX_enterprise.sql`, `assets/supabase-client.js`.
- **Done when**: an enterprise-tier user has unlocked formulas + full ingredients + higher Claude quota.
- **Estimate**: ½ day.

### 3.2 — `enterprise.html` sales page ⬜
- **What to build**:
  - Hero: "Built for chemical manufacturers and industrial labs."
  - 6 value bullets (private vault, team accounts, compliance docs, AI assistant, supplier intelligence, batch calculators).
  - Pricing: "From $500/month — Contact sales for custom quote."
  - "Schedule a 30-min consultation" form (writes to `enterprise_leads` table; pings Jamil's email).
- **Files**: new `enterprise.html`, new `enterprise_leads` table.
- **Done when**: published, linked from `pricing.html` and the navbar.
- **Estimate**: 1 day.

### 3.3 — Founder authority on `about.html` ⬜
- **What to build**:
  - Add a long-form story section: Jamil's 25-year career, factories run, products formulated, photos, brief case studies, why this platform exists.
  - LinkedIn link prominent.
- **Done when**: about.html reads like a founder's brand page, not a project page.
- **Estimate**: 1 day (mostly content gathering).

---

## PHASE 4 — RETENTION (Formula Workspace)

> Goal: fix the "post-purchase churn" problem — chemist gets the formula, never returns.
> Estimated: 2 weeks.

### 4.1 — `my_formulas` table + save/edit ⬜
- Users can save any formula to their own workspace, edit it, add notes.
- Files: SQL migration, new `workspace.html`, `assets/workspace-live.js`.

### 4.2 — Projects + tags ⬜
- Group saved formulas into projects with tags.

### 4.3 — Side-by-side compare ⬜
- Pick 2 formulas, diff ingredients/cost/properties.

### 4.4 — Formula PDF export ⬜
- One-click printable spec sheet.

### 4.5 — Email alert on raw-material price change (Phase 8 dependency) ⏭️
- Defer to Phase 8 (needs supplier data).

---

## PHASE 5 — LEAD GEN + EMAIL

> Goal: build the email list, the long-term acquisition asset.
> Estimated: 1-2 weeks.

### 5.1 — Lead magnet template + first PDF ⬜
- Pick 1 industry (e.g. detergents). Produce a 6-page "10 Common Detergent Formulation Mistakes" PDF.

### 5.2 — Email-gated download flow ⬜
- New page `resources.html`; visitor enters email → PDF emailed via Resend.
- Email saved to `leads` table.

### 5.3 — Nurture sequence ⬜
- 7-email drip over 30 days (welcome → tip 1 → case study → tip 2 → soft pitch → free demo → upgrade).

### 5.4 — Industry magnet expansion (rolling) ⬜
- 4 more PDFs, one industry per week.

### 5.5 — A/B pricing test ⬜
- Split pricing.html between $29 and $49 Pro; track 14-day conversion.

---

## PHASE 6 — DISTRIBUTION

> Goal: get factories & chemists to know we exist.
> Estimated: ongoing (starts week 3-4 in parallel).

### 6.1 — LinkedIn daily post framework ⬜
- 30 post templates: "Industrial mistake of the week", "Why your shampoo separates", "EU bans next…", "Cost-cut tip".
- Owner posts 5/week in English.

### 6.2 — Per-chemical SEO pages (7,000 pages) ⬜
- One template, one Python script, query `chemicals` table, render to `chemicals/<slug>.html`.
- Sitemap regenerated.

### 6.3 — Homepage social proof ⬜
- Testimonials section, factory logos, "trusted by N chemists in N countries".

### 6.4 — Wall of Contributors page ⬜
- Public page showcasing top contributors (`public_profiles` view).

### 6.5 — Founder LinkedIn / YouTube setup ⬜
- Owner identity hardened on LinkedIn; first 3 YouTube Shorts published.

---

## PHASE 7 — DAILY TOOLS (CALCULATORS)

> Goal: make the site a daily tool, not just an encyclopedia.
> Estimated: 2-3 weeks.

### 7.1 — Cost-per-batch calculator ⬜
### 7.2 — Lab-to-production scale-up calculator (100g → 1,000kg) ⬜
### 7.3 — Surfactant blend ratio calculator ⬜
### 7.4 — pH correction calculator ⬜
### 7.5 — SDS (Safety Data Sheet) auto-generator ⬜
- HUGE enterprise unlock — compliance doc required by every customer.

---

## PHASE 8 — PROCUREMENT MARKETPLACE (manual MVP first)

> Goal: launch the $8K/month commission stream.
> Estimated: 2 weeks for manual flow; automation later.

### 8.1 — "Request quote" form on every chemical page ⬜
- Visitor fills product / quantity / destination port.
- Form writes to `procurement_requests`; pings Jamil.

### 8.2 — Manual matchmaking workflow ⬜
- Jamil contacts a supplier (anywhere in the world); gets quote; emails
  buyer with margin built in.
- Track every request in admin.html with status + commission earned.

### 8.3 — Supplier directory page ⬜
- Public-facing list of vetted suppliers — GLOBAL from the start, not
  scoped to any one country. Onboard suppliers wherever they are
  (Asia, Europe, Africa, the Americas). The founder's existing
  contacts are a seed, never a ceiling.

### 8.4 — Commission tracking dashboard ⬜
- MRR/commission breakdown in admin.html.

---

## PHASE 9 — ADVANCED MOAT (Month 4+)

> Goal: defensibility for the long run.

### 9.1 — Vector DB + RAG over the formulas + chemicals + chat history ⬜
- Reduces Claude dependency, makes the AI proprietary.

### 9.2 — Team accounts (multi-seat under one enterprise) ⬜
### 9.3 — CSV/Excel formula import for enterprise onboarding ⬜
### 9.4 — Chat history exportable as Markdown/PDF ⬜
### 9.5 — MRR / CAC / LTV dashboard ⬜
### 9.6 — Tighten CSP — remove `'unsafe-eval'` ⬜
### 9.7 — Vitest coverage for the Worker + pytest coverage for the backend ⬜

---

## 🚫 What we explicitly DO NOT do (from the AI-evaluation pass)

| Tempted by | Why we refuse |
|---|---|
| 100,000 thin AI-generated SEO pages | Google penalises in 2024+; quality > quantity. |
| Replacing Paystack with Stripe | Paystack is the right choice for our target markets (Africa, Middle East, emerging). |
| Removing `lab.html` / `predict.html` / `similarity.html` / `agent.html` etc. | These are depth signals to B2B buyers. Do not delete without explicit owner approval. |
| Brand rebrand to "industrial blue" | Owner's design choices stay. |
| Planning a BASF acquisition | Fantasy at current scale. |
| Freezing all feature work for 30 days | Phase 1 hardening IS feature work and is essential. |
| Pasting the Gemini SQL with `ALTER TYPE user_tier` | No such enum exists — would fail on first line. |

---

## 📜 Provenance

The plan was synthesised from:
- `CONTEXT.md` (everything already built)
- External-AI analyses by DeepSeek (mostly low-value), ChatGPT (strategic), and Gemini (sharpest tactical insight).

The good ideas were taken, the bad / inflated / wrong claims were
dropped. Nothing from the existing project will be deleted without
explicit owner permission (per `feedback-evaluate-other-ai.md`).

---

## ⏱️ Owner update log (append below as steps complete)

- 2026-05-22 — Roadmap created. Currently on **1.1**.
- 2026-05-25 — **Step 1.1 ✅ DONE.** Server-side gate + RLS + anti-scraping
  rate limit deployed end-to-end. SQL migration ran clean; KV namespace
  `formula_ai_ratelimit` (id `d4fd954875414eb39cda8ec53fed3c9f`) bound as
  `RATELIMIT_KV`; Worker version `421bde10`; frontend `DEPLOY_PHASE3.zip`
  extracted in `public_html`; all 3 verification queries (anon role) returned
  the expected results. Moving pointer to **1.2**.
- 2026-05-26 — **Step 1.4 ✅ DONE.** Push-to-deploy CI live. Worker
  version published from `cloudflare/wrangler-action@v3`; frontend
  built + cache-bumped to ?v=24 by `build_phase3.py` and FTP-deployed
  to Hostinger `/public_html/`. Four iterations to converge (first
  three caught: FTP chroot misread, then over-correction, then npx
  wrangler interactive prompt). Phase 1 — HARDENING — is now COMPLETE
  end-to-end. Moving pointer to **Phase 2** (First Revenue).
- 2026-05-26 — **Step 1.3 ✅ DONE.** Sentry + Better Stack stack
  observable end-to-end. Sentry envelope POST returns 200; 3 Better
  Stack uptime monitors green (`jamilformula.com`,
  `formula-ai-brain.jamilaj1.workers.dev/health`,
  `formula-ai-chem.onrender.com/health`); Worker version
  `984a61c9-56d2-4741-a743-4463cb31a123`. Both free tiers — $0
  committed. Moving pointer to **1.4** (one-command auto-deploy CI).
- 2026-05-29 — **Phase 9.5 ✅ DONE.** Financials tab in admin.html
  shipped. One Worker endpoint `/be/admin/financials` (owner-only,
  parallel PostgREST aggregations) returns MRR/ARR/LTV/ARPU + plan
  distribution + consulting lifetime revenue + Claude operational
  cost + gross margin + conversion %. New admin tab renders 6
  headline cards + 4 unit-economics cards + 2 CSS bar charts +
  consulting + ops sections, all CSP-clean (no eval, no external
  chart lib). 13 vitest assertions in tests/handlers/admin.test.js
  cover auth gate, MRR formula, division-by-zero guards, gross-
  margin formula, consulting status sums, cache-hit ratio,
  assumption block shape. CAC + true churn-based LTV deferred to
  Phase 5 lead-gen (CAC) and 6+ months of cohort data (LTV).
- 2026-05-29 — **Phase 9.7 ✅ DONE.** +97 new test assertions across
  the Worker libs (cache/ratelimit/claude), the consulting handler,
  and the backend rendering paths (consulting markdown + library PDF).
  Caught and fixed one real bug along the way — unguarded `float(pct)`
  in library_pdf.py that would crash the spec-sheet PDF on a malformed
  percentage. vitest now passes 135/135 locally; pytest passes all
  the consulting + library + agents + pubchem tests. Moving on.
- 2026-05-29 — **Phase 9.6 ✅ DONE.** `'unsafe-eval'` removed from
  `.htaccess` CSP after an audit confirmed zero eval/new Function/
  Function('…') usage across all committed `.js` and inline `<script>`
  blocks (11 assets/*.js + 33 root *.html, plus the supabase-js@2
  third-party we load). One-line CSP change + a header comment in
  the file explaining the audit so it doesn't get re-added by accident.
  Defence-in-depth on top of Phase 1.1/1.2.
- 2026-05-29 — **Phase 9.1 ✅ DONE.** Vector DB + RAG augmentation shipped.
  Migration `2026-05-29_vector_search.sql` adds pgvector + embedding
  column + HNSW + the `match_formulas` RPC + a `formula_embedding_progress`
  view. `scripts/embed_formulas.py` backfills the column via OpenAI
  text-embedding-3-small in batches of 100 (~$0.04 + ~4 min for 3,381
  rows). `worker-src/lib/vector.js` wraps the OpenAI embed + the RPC
  with graceful null/empty fallbacks. `worker-src/handlers/chat.js`
  search_formulas tool now runs semantic-first then ILIKE — the result
  payload exposes `vector_hits` for observability. Owner actions to
  fully activate listed at the top of the "Currently Working On"
  section. Backward-compatible: with OPENAI_API_KEY unset the tool
  works exactly like before. Moving pointer to Phase 9.6 (CSP) or
  9.7 (tests) — whichever Jamil picks next.
- 2026-05-28 — **Phase 2 close-of-loop ✅ DONE.** Approve & deliver +
  Resend wired end-to-end. `/api/v2/consulting/{id}/deliver` on FastAPI
  renders markdown → PDF (reportlab block parser, custom for the shape
  produced by `_render_markdown`), uploads to `consulting-drafts/{id}/final/`,
  emails the client via Resend with the PDF as a base64 attachment, and
  flips status to 'delivered'. `/resend` re-attaches the existing PDF
  without re-rendering. Worker proxies + admin.html buttons all live.
  Requires Render env var `RESEND_API_KEY`. Phase 2 is now 100% closed.
- 2026-05-25 — **Step 1.2 ✅ DONE.** Claude cost guards live. Migration
  `2026-05-25_claude_cost_guards.sql` adds tokens/cost columns + view + RPCs;
  `lib/claude.js` does plan-aware Sonnet/Haiku selection + auto-fallback;
  `lib/cache.js` gives SHA-256 KV cache with 24h TTL; `recordUsage` accepts
  cost meta; `chat.js` `search.js` `insights.js` all wired; hotfix switched
  Worker `formulas` reads from anon `sb()` to `sbService()` (RLS from 1.1
  had silently broken them). Cron `0 9 * * *` registered (Version
  `526a93de`). Smoke test: 2× /search → second was `cache_hit=true` with
  zero tokens. Moving pointer to **1.3** (Sentry + Better Stack).
