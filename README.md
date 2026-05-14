# Formula AI Global

> AI Chemical Formulation Platform.
> **3,381 verified formulas** today (target: 200,000+) · 40 industries · 195 countries · 12 languages.

This repo contains the **static marketing + product site** (HTML/CSS/JS,
shipped on Hostinger) plus the **Cloudflare Worker** that serves as the AI
brain in production, plus a **Python FastAPI scaffold** (`backend/`) staged
for a future deeper backend.

> 📐 See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full picture
> of what is deployed today vs. what is scaffolded for later.
> 🛠️ See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the day-to-day workflow.
> 📜 See [`CLAUDE.md`](./CLAUDE.md) for the language/style rules.

---

## Repo layout

```
.
├── backend/              ← Python FastAPI + AI brain (this is what we build today)
│   ├── main.py
│   ├── requirements.txt
│   ├── ai_brain/         ← brain, extractor, completer, validator, grader, …
│   ├── knowledge_collector/
│   ├── app/api/v1/       ← search, formulas, chat, export
│   ├── app/api/v2/       ← compliance, subscription, ads, global_initiatives
│   ├── services/         ← open_encyclopedia, certification, recipes, …
│   └── bots/             ← telegram_bot.py, whatsapp_bot.py
│
├── frontend/             ← Next.js (next phase — see TODO)
│
├── database/             ← Supabase SQL (run these in the SQL Editor)
│   ├── schema.sql
│   ├── schema_extensions.sql
│   └── seed.sql
│
├── scripts/
│   ├── launch.sh         ← one-command boot (macOS / Linux)
│   └── launch.bat        ← one-command boot (Windows)
│
├── (HTML files at the root)  ← the static marketing site we built earlier
│
├── .env.example
└── README.md
```

---

## 5-day plan to go live

### Day 1 — accounts & DB

1. Create accounts: GitHub, Supabase, Anthropic, Stripe (test mode), Vercel.
2. In Supabase → SQL Editor, paste **database/schema.sql** → Run.
3. Then paste **database/schema_extensions.sql** → Run.
4. Then **database/seed.sql** → Run (4 plans + 12 industries + 10 chemicals).
5. Copy `.env.example` to `.env`, fill in the values from each dashboard.

### Day 2 — run locally

```bash
# macOS / Linux
chmod +x scripts/launch.sh
./scripts/launch.sh

# Windows
scripts\launch.bat
```

Backend → http://localhost:8080/docs (Swagger UI)
Frontend → http://localhost:3000

### Day 3 — deploy

- Push the repo to GitHub.
- Vercel: import the repo → Root directory = `frontend` → Deploy.
- Add `jamilformula.com` in Project → Settings → Domains.
- Backend: deploy to Vercel separately (`Root = backend`) or to Render / Fly.io.
- Update DNS at Hostinger to point to the chosen host.

### Day 4 — global initiatives

- Open Encyclopedia: any formula with `trust_score ≥ 90` becomes public via
  `POST /api/v2/encyclopedia/publish/{formula_id}`.
- Gold Standard: `POST /api/v2/certify/issue` (requires trust ≥ 95).
- University Program: register a domain, then signups from that domain auto-grant
  Enterprise plans.
- Industrial API: `POST /api/v2/api-keys/issue` returns a `fai_…` key for ERP
  integration.

### Day 5 — bots

- Telegram: BotFather → `/newbot` → put token in `.env` → `python -m bots.telegram_bot`.
- WhatsApp: Twilio Sandbox → set webhook to your deployed `/whatsapp/webhook`.

---

## Endpoints at a glance

| Method | Path                                        | Purpose                                 |
| ------ | ------------------------------------------- | --------------------------------------- |
| GET    | `/health`                                   | liveness                                |
| GET    | `/api/stats`                                | total formulas / chemicals / industries |
| POST   | `/api/v1/search`                            | chemistry Q&A in 20 languages           |
| GET    | `/api/v1/formulas`                          | list (filter by category, level, trust) |
| POST   | `/api/v1/formulas`                          | create                                  |
| POST   | `/api/v1/chat/send`                         | forever-memory chat                     |
| GET    | `/api/v1/chat/history/{user_id}`            | full archive                            |
| GET    | `/api/v1/export/{formula_id}/pdf`           | PDF export                              |
| GET    | `/api/v1/export/{formula_id}/xlsx`          | Excel export                            |
| GET    | `/api/v2/compliance/check/{formula_id}`     | rules vs target country                 |
| POST   | `/api/v2/subscription/create-checkout`      | Stripe checkout link                    |
| POST   | `/api/v2/subscription/webhook`              | Stripe webhook                          |
| GET    | `/api/v2/ads/active`                        | direct ads by position                  |
| POST   | `/api/v2/encyclopedia/publish/{formula_id}` | promote to free encyclopedia            |
| GET    | `/api/v2/encyclopedia`                      | list public formulas                    |
| POST   | `/api/v2/certify/issue`                     | issue Gold Standard certificate         |
| GET    | `/api/v2/certify/verify/{cert_hash}`        | public verification                     |
| POST   | `/api/v2/recipes`                           | create ready-recipe                     |
| GET    | `/api/v2/recipes/region/{country_code}`     | recipes with local suppliers            |
| POST   | `/api/v2/university/register`               | onboard a university domain             |
| POST   | `/api/v2/university/grant/{user_id}?email=` | grant Enterprise to academic email      |
| POST   | `/api/v2/api-keys/issue`                    | mint an industrial API key              |
| GET    | `/api/v2/api-keys/whoami`                   | metering / quota check                  |

---

## Status

| Phase                                                              | Status                      |
| ------------------------------------------------------------------ | --------------------------- |
| Static site live on jamilformula.com (22 HTML pages, 12 languages) | ✅ live                     |
| Cloudflare Worker AI brain (search, chat, safety, lab, billing)    | ✅ live                     |
| Supabase DB with 3,381 real formulas + auth + RLS                  | ✅ live                     |
| Stripe + Paystack checkout wiring                                  | ✅ live                     |
| Backend FastAPI scaffold (`backend/`)                              | 🧪 scaffolded, not deployed |
| Telegram + WhatsApp bots                                           | 🧪 scaffolded, not deployed |
| Next.js frontend (real product, not just marketing)                | ⏳ planned                  |
| Tests + CI (Vitest, pytest, GitHub Actions)                        | ✅ added                    |
| Linting (ESLint + Prettier + Ruff)                                 | ✅ added                    |

---

Built by Jamil Abduljalil — 25+ years in industrial chemistry across multiple
countries, currently overseeing operations producing over 2,000 tons/month and
founder of DosLunas (50+ tons/month).
Powered by Claude (Anthropic), Supabase, and the open-source chemistry community.
