# PROJECT_CONTEXT.md — Formula AI Global

> **Master reference.** Hand this to any engineer and they can continue
> without wasting the owner's time. Covers everything from foundation to
> the current moment (2026-05-14), plus an honest evaluation and the
> forward roadmap.

---

## 0. TL;DR — Where we are right now

**Formula AI Global** (jamilformula.com) is a production chemistry-AI
platform for industrial formulators. As of **2026-05-14** it is **fully
deployed and live** across all layers with **real cheminformatics** (RDKit
+ PubChem), **6-agent reasoning**, **Claude Vision**, and **3 trained ML
models** serving real predictions in production.

| Layer | Status | URL |
|---|---|---|
| Frontend (Hostinger) | 🟢 Live | https://jamilformula.com |
| Edge (Cloudflare Worker) | 🟢 Live | https://formula-ai-brain.jamilaj1.workers.dev |
| Backend (Render, FastAPI+RDKit) | 🟢 Live | https://formula-ai-chem.onrender.com |
| Database (Supabase) | 🟢 Live | ivabcssceeaqgqjzgmdx.supabase.co |
| Monitoring (Better Stack) | 🟡 Code ready, account pending | — |

**Honest score: 8.7 / 10** (was 5.6 at first audit). See §2.

> **2026-05-19 — Phase 3 (Exclusive content + Subscription gate) shipped
> & verified live on both `jamilformula.com` and `www`. Legacy Vercel
> project (`www` "200K+" prototype) deleted, `www` DNS repointed to
> Hostinger. Full details + re-verify commands: `PHASE3_HANDOFF.md`.**

---

## 1. Owner & business context

- **Owner:** Jamil Abduljalil (jamilaj1@gmail.com)
- **Domain expertise:** 25+ years industrial chemistry across multiple
  countries; currently manages operations producing **~2,000 tons/month**;
  founder & owner of **DosLunas** — own plant producing **50+ tons/day**.
- **Audience:** 60,000+ Facebook followers in the chemical/industrial
  sector, ready for launch. They will judge the platform from minute one.
- **Strategic decision:** make the platform genuinely world-class FIRST,
  market AFTER. (Has driven all recent work.)
- **Niche:** industrial formulation (cosmetics, home care, cleaners,
  agrochemicals) — NOT drug discovery. Competes conceptually with
  Schrödinger/Atomwise but in the under-served formulation space.

---

## 2. Evaluation / Scorecard (honest)

| Dimension | Start | Now | Notes |
|---|---|---|---|
| **Code quality** | 5/10 | **9/10** | Modular ESM worker, typed FastAPI, Pydantic validation, lint+tests, clean separation. |
| **Security** | 4/10 | **9/10** | HMAC webhooks, JWT forwarding, CORS locked, security review done, H1/M1/M2 fixed, admin-gated metrics, GDPR IP truncation. |
| **Architecture** | 6/10 | **9.5/10** | 4-tier (static → edge → API → DB), graceful fallbacks everywhere, resume-safe jobs, observability layer. |
| **Real intelligence** | 2/10 | **9/10** | RDKit + PubChem + 6 agents + Vision + 3 trained RF models with published metrics. Not "LLM guessing." |
| **Product completeness** | 4/10 | **8/10** | 27 pages, 5 new AI tools, billing live. Missing: more UI polish, mobile QA, deeper docs. |
| **Data depth** | 5/10 | **7/10** | 3,381 formulas; ~992 enriched (4,941 components have SMILES). 2,389 still to backfill. |
| **Observability/Ops** | 3/10 | **8/10** | Better Stack code wired (logs+uptime+status), metrics endpoints, health checks. Account not yet created. |
| **Overall** | **5.6** | **8.7** | Genuinely launchable. Remaining points are data volume + ops account + polish. |

**What pushes it to 9.5+:** finish the backfill (all 3,381 enriched),
retrain compatibility on the full set, create the Better Stack account,
add client-side error tracking, mobile QA pass, real docs/API page.

---

## 3. Architecture

```
FRONTEND — Hostinger (jamilformula.com)
  27 HTML pages · PWA (sw.js) · i18n (20 langs, data-i18n-ar)
  assets/app.js (i18n+UI, M1 sanitizer) · assets/chem-client.js
        │ HTTPS fetch, JWT forwarded
EDGE — Cloudflare Worker (formula-ai-brain…workers.dev)
  worker.js (~90 KB, esbuild bundle of worker-src/)
  /search /chat /library /prices /paystack/* …
  proxies /chem/* /agents/* /vision/* → backend
  observability.js wraps fetch (logs+errors, IP truncated)
        │ HTTPS (CHEM_BACKEND_URL)
BACKEND — Render (formula-ai-chem.onrender.com)
  FastAPI · Python 3.11 · Docker · 2 uvicorn workers
  RDKit · PubChem · 6 agents · Claude Vision · 3 RF models
  services/observability.py (middleware+metrics, admin-gated)
        │ PostgREST / service key
DATABASE — Supabase (ivabcssceeaqgqjzgmdx)
  PostgreSQL + RLS + Auth · formulas (3,381) · chemicals (7K)

Side: GitHub → Render auto-deploy · Better Stack ← logs/uptime
      Anthropic Claude (haiku-4-5) · Paystack (live GHS, HMAC)
```

**Key principle:** every intelligent feature degrades gracefully.
No RDKit → closed-form. No trained model → heuristic/Crippen.
No Better Stack token → silent no-op. The API contract never breaks.

---

## 4. Phase history (foundation → now)

| Phase | What shipped |
|---|---|
| **1** | RDKit chemistry: `/chem/properties,canonicalize,lipinski` |
| **2** | Auth + rate limits (Supabase JWT, IP-keyed guests) |
| **3** | Chat (Claude tool-use, sessions, history) |
| **4** | Personal library (save/list/CRUD formulas) |
| **5** | Teach-AI ingestion / extract from book text |
| **1.5** | PubChem lookup `/chem/lookup/{name,cas}` + SMILES backfill |
| **Sim** | Similarity (Morgan ECFP4 + Tanimoto), substitution, conflict |
| **3-agent** | 6 specialist agents via asyncio.gather |
| **4-ML** | ESOL solubility, heuristic stability, SMARTS toxicity |
| **6** | Claude Vision: label/structure/MSDS parsing |
| **12** | Discover: arXiv/PubMed/Lens paper harvesting |
| **13-15** | Library + cost + scale calculators |
| **14** | Paystack billing (live GHS, HMAC webhooks) |
| **Admin** | PubChem backfill endpoint (start/status/cancel) |
| **UI (أ)** | 5 new AI pages (see §5) |
| **Obs (ب)** | Better Stack observability layer (see §6) |
| **ML (ج)** | 3 trained Random Forest models (see §7) |
| **Sec** | Security review + H1/M1/M2 fixes (see §8) |
| **Deploy** | Full production deployment, all layers (see §9) |

---

## 5. The 5 new AI pages (Phase أ)

Match existing design (navbar, hero orbs, `.panel`, i18n, footer).
All call `window.FAI_CHEM` from the new `assets/chem-client.js`
(forwards the Supabase JWT for rate limits).

| Page | Purpose | Endpoints |
|---|---|---|
| `substitute.html` | Functional substitute for any ingredient; tier badges, score bars, reasoning | `/chem/find_substitute`, `/chem/lookup/name` |
| `scan.html` | Vision scanner — 3 tabs: label / molecule / MSDS; drag-drop, base64 | `/vision/{label,structure,msds}` |
| `agent.html` | 6-agent panel; evaluate or design a formula; live cards + verdict banner | `/agents/evaluate`, `/agents/formulate` |
| `predict.html` | Unified calc: MW/logP/TPSA/Lipinski/ESOL/stability/toxicity, parallel calls | `/chem/{properties,lipinski,solubility,toxicity_scan}` |
| `similarity.html` | Pair Tanimoto OR DB analog search; gauge + tier + hits | `/chem/similarity`, `/chem/find_similar` |

Also: 22 existing pages had navbar + footer updated to link these tools.

---

## 6. Observability (Phase ب — Better Stack)

Code wired, **account not yet created** (no-op until `BETTER_STACK_TOKEN`
set — production unaffected).

- `backend/services/observability.py` (installed in `main.py`):
  middleware ships 4xx/5xx/slow(>3s)/exceptions w/ traceback; skips 2xx
  `/health`; **IP truncated** (`ip_prefix`, M2). Adds `/health/detailed`
  (minimal public, full only w/ admin key — H1) and `/metrics/summary`
  (**admin-gated**, per-path p50/p95/p99 — H1, constant-time compare).
- `worker-src/observability.js`: `withObservability()` wraps fetch;
  same rules + `cf_country/colo/ray`; IP truncated.
- `BETTERSTACK_SETUP.md` — 6 steps (~10 min): sources, uptime monitors,
  status page, alerts.

---

## 7. Trained ML models (Phase ج)

Real Random Forests, **live on Render**, served via
`backend/ml/predictors.py` at `/api/chem/ml/*`. Graceful fallback
(Crippen/heuristic) if a `.joblib` is missing.

| Model | File | Algorithm | Held-out | n_train |
|---|---|---|---|---|
| **logP** | `logp_rf.joblib` | RF Regressor | R²=0.884, MAE=0.529 | 172 |
| **Compatibility** | `compatibility_rf.joblib` | RF Classifier | Acc=0.802, F1=0.798, **AUC=0.891** | 4,126 |
| **Stability** | `stability_rf.joblib` | RF Regressor | R²=0.858, ×1.27 err | 79 |

Production-verified: logp glycerin (vs Crippen delta); compatibility
SLS+cationic-quat → `incompatible` p=0.21 ✓; stability glycerin
40°C/70%RH → ~30 mo "long".

Infra: `ml/registry.py` (joblib cache+meta), `ml/features.py` (12 RDKit
descriptors + Morgan ECFP4 + combined), `ml/train_*.py`, `ml/data/*.csv`.
`GET /api/chem/ml/status` = provenance (metrics, n_train, date).

Datasets: `logp_train.csv` (215 cpds DrugBank/Hansch), `stability_seed.csv`
(100 commodity). Compatibility mines our 3,381-formula DB (co-occurring
positives) + SMARTS/function incompat rules + weak-supervision negatives.

---

## 8. Security review + fixes

Full review before launch. **No critical (RCE/SQLi/auth-bypass).**

| ID | Sev | Issue | Fix | Status |
|---|---|---|---|---|
| **H1** | High | metrics/health unauthenticated info disclosure | admin-key gate (hmac), minimal public health | ✅ Live (locked) |
| **M1** | Med | `data-i18n-ar`→`innerHTML` latent stored-XSS | `faiSanitizeHtml()` allowlist (kills script/iframe/on*/js:, keeps SVG/span) | ✅ Live, verified |
| **M2** | Med | raw IP → US logger (GDPR) | IPv4 last octet zeroed / IPv6 /48, backend+worker | ✅ Live |
| **L1** | Low | joblib pickle RCE *if* models from untrusted source | safe today (in image); add SHA-256 if S3 ever used | 📋 Doc |
| **L2** | Low | browser reads Supabase w/ anon key | relies on RLS — **verify RLS ON, anon=SELECT only** | 📋 Verify |
| **L3** | Low | no FastAPI rate limit on ML | mitigated by Worker auth + max_length=500 | 📋 Accepted |

Positive: BS token never logged; generic 500 (no client stack);
Pydantic bounds; pages escapeHtml all dynamic data; CORS locked.

---

## 9. Deployment status (live)

Git `main` @ `88fd792`, pushed. Render auto-deploys from push.

| Target | How | Status |
|---|---|---|
| GitHub | `git push` | ✅ `88fd792` |
| Render | auto from GitHub | ✅ Live; `923a5c9`+`88fd792`; 3 ML models `available:true` |
| Cloudflare Worker | manual paste `worker.js` | ✅ Live; ML proxy verified e2e |
| Hostinger | manual ZIP upload+extract (+manual app.js) | ✅ Live; 27 pages 200; M1 verified live |
| Better Stack | account not created | 🟡 Pending (non-blocking) |

**Deployment gotcha:** PowerShell `Compress-Archive` writes ZIP entries
with `\`; Hostinger treats `\` as filename → junk `assets\app.js`,
`assets\chem-client.js` in root (since deleted). **Future: upload files
directly, or use a zip tool that writes `/`.**

**Outstanding (non-blocking):** `ADMIN_API_KEY` set in Render dashboard
but the running process still shows it empty (uptime indicates no
restart). `/metrics/summary` → **503 = locked** (secure; admin features
disabled until Render restarts with the value). Fix: verify value via
👁️, Save, then **Manual Deploy → Deploy latest commit**.

---

## 10. Database state

- `formulas`: **3,381** rows. ~**992** enriched (`components[*].chem.smiles`);
  **4,941** components found on PubChem; **3,411** not found (trade names,
  polymers — expected). **~2,389 formulas still need backfill.**
- `chemicals_database`: ~7,000 rows.
- Supabase REST default cap = 1000/req → backfill does ~992/run; needs
  ~3 more runs OR Range-pagination (already in `train_compatibility.py`).
- Finish: `cd backend && python -m tools.backfill_smiles` (repeat),
  then `python -m ml.train_compatibility` (retrain on full set).

---

## 11. Environment variables

**Render `formula-ai-chem`:** ANTHROPIC_API_KEY, ANTHROPIC_MODEL
(claude-haiku-4-5), SUPABASE_URL/ANON_KEY/SERVICE_KEY, CORS_ORIGINS,
PYTHONUNBUFFERED, ADMIN_API_KEY ⚠️(needs restart), SERVICE_NAME=
formula-ai-backend, SERVICE_ENV=production, BETTER_STACK_HOST,
(BETTER_STACK_TOKEN pending).

**Cloudflare `formula-ai-brain`:** ANTHROPIC_API_KEY,
SUPABASE_URL/ANON_KEY/SERVICE_KEY, PAYSTACK_SECRET_KEY,
PAYSTACK_PLAN_PRO/BIZ/ENT, PAYSTACK_WEBHOOK_SECRET,
CHEM_BACKEND_URL=https://formula-ai-chem.onrender.com,
SERVICE_NAME=formula-ai-worker, SERVICE_ENV=production,
(BETTER_STACK_TOKEN pending).

**Admin key:** stored only in Render & Cloudflare env as `ADMIN_API_KEY`
— the literal value is intentionally NOT recorded in any file in this
repo (scrubbed 2026-05-19). If the old value was ever exposed, rotate it.

**Local `.env`** (project root, NOT backend/): SUPABASE_URL,
SUPABASE_SERVICE_KEY — for backfill + ML trainers.

---

## 12. Repo layout (key paths)

```
/                       27 HTML, manifest.json, sw.js, robots.txt
/assets/app.js          i18n+UI + faiSanitizeHtml (M1)
/assets/chem-client.js  FAI_CHEM API wrapper (NEW)
/worker.js              built bundle → deploy to Cloudflare
/worker-src/            index.js, handlers/, lib/, observability.js
/backend/main.py        FastAPI entry; installs observability+routers
/backend/services/      chemistry, similarity, substitution, pubchem,
                        vision, observability
/backend/ml/            registry, features, predictors, train_*,
                        models/*.joblib, data/*.csv
/backend/agents/        base + 6 specialists + orchestrator
/backend/app/api/       v1/ v2/ chem/ agents/ vision/ admin/
/backend/tools/         backfill_smiles.py
/backend/Dockerfile     multi-stage; COPYs ml/ agents/ cron/ …
BETTERSTACK_SETUP.md    monitoring setup
ML_MODELS_SETUP.md      train/deploy/verify ML
PHASE3_HANDOFF.md       Phase 3 paywall/exclusive + www/Vercel fix
scripts/build_phase3.py Phase 3 deploy-zip builder (?v bump, fwd-slash)
PROJECT_CONTEXT.md      ← this file
```

Build: `npm run build:worker`. Tests: Vitest (45) + pytest (~90).
Lint: ESLint+Prettier. CI: GitHub Actions (tests + daily scrape;
**no auto-deploy** — Worker & Hostinger are manual).

---

## 13. How-to (common tasks)

```bash
# Rebuild + deploy worker
npm run build:worker          # → worker.js ; paste into Cloudflare

# Train / retrain ML
cd backend && source venv/Scripts/activate
python -m ml.train_logp
python -m ml.train_compatibility
python -m ml.train_stability
# commit backend/ml/models/ → push → Render redeploys

# Finish SMILES backfill
cd backend && python -m tools.backfill_smiles   # repeat until done

# Verify production
curl https://formula-ai-chem.onrender.com/api/chem/ml/status
curl -X POST https://formula-ai-brain.jamilaj1.workers.dev/chem/ml/logp \
     -H 'content-type: application/json' -d '{"smiles":"CCO"}'

# Frontend deploy: upload changed HTML + assets/ to Hostinger
#   public_html (upload directly — avoid Compress-Archive backslash bug)
```

---

## 14. Roadmap / pending (priority)

1. **ADMIN_API_KEY restart** (Render Manual Deploy) — unlocks metrics +
   admin backfill. Non-blocking, do soon.
2. **Better Stack account** ($25/mo) — `BETTERSTACK_SETUP.md`, then set
   `BETTER_STACK_TOKEN` in Render + Cloudflare.
3. **Finish backfill** (~2,389) → retrain compatibility on full set.
4. **L2 verify** — Supabase RLS ON for `formulas`, anon=SELECT only.
5. **Client-side error tracking** — `/error_report` worker route +
   `window.onerror` hook.
6. **Mobile QA** on the 5 new pages.
7. **Real docs/API page** (`docs.html` is thin).
8. **Scale** — Render Starter→Standard; Cloudflare Workers Paid >100K/d.
9. **Dataset growth** — `logp_train.csv`→5K (PubChem XLogP3); user
   shelf-life data for stability.

---

## 15. Known issues / sharp edges

- **i18n is an HTML sink.** `data-i18n-ar` → `innerHTML`. M1 sanitizer
  defuses it, but **never put user/API data into `data-i18n-ar`** —
  render dynamic data as escaped text nodes only.
- **Hostinger ZIP backslash bug** — upload files directly (§9).
- **Render env changes need a restart**; if uptime high after Save,
  trigger Manual Deploy.
- **Supabase 1000-row REST cap** — paginate / batch.
- **RDKit stderr noisy** — trainers pipe `2>nul`.
- **PowerShell Unicode** — trainer prints use ASCII (`->` not `→`) to
  avoid cp1256 errors on Windows.

---

## 16. Accounts

- GitHub: `jamilaj1/formula-ai-global` (`main`)
- Render: `formula-ai-chem` (srv-d82osao3kofs73d1didg)
- Cloudflare: Jamilaj1@gmail.com, worker `formula-ai-brain`
- Supabase: project `ivabcssceeaqgqjzgmdx`
- Hostinger: u680581922, root `public_html`
- Paystack: live GHS · Anthropic: `claude-haiku-4-5`

---

_Last updated: 2026-05-14 — after full production deployment + security
fixes (H1/M1/M2). Platform is launchable; remaining items are data
volume, the Better Stack account, and polish._
