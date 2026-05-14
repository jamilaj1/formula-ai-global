# backend/ — FastAPI service (NOT currently deployed)

This directory contains a Python FastAPI scaffold for the **next-generation
backend**. It is **not** what currently serves jamilformula.com today.

## Current production reality

Production traffic goes to a **Cloudflare Worker** at
`formula-ai-brain.jamilaj1.workers.dev` (source: `../worker.js`).

This `backend/` directory is here so that when we outgrow the Worker — e.g.
because we need:

- background jobs (book ingestion, knowledge-collector crawl)
- heavy synchronous compute (rdkit / deepchem optional deps)
- Telegram + WhatsApp bots
- RAG over uploaded books with embeddings
- multi-step agent workflows that take >30s

...we have a place to put them.

See `docs/ARCHITECTURE.md` at the repo root for the full picture.

## What's here

```
main.py                       — FastAPI entry, /health, /api/stats
ai_brain/                     — orchestrator + extractor/completer/validator/grader
  brain.py
  extractor.py, completer.py, validator.py, grader.py
  safety_checker.py, cost_analyzer.py, conflict_detector.py
  language_detector.py, knowledge_graph.py, learning_engine.py
  substitution_engine.py, virtual_lab.py
knowledge_collector/          — background formula harvester
app/api/v1/                   — search, formulas, chat, export endpoints
app/api/v2/                   — compliance, subscription, ads, global_initiatives
services/                     — certification, recipes, university, encyclopedia
bots/                         — telegram_bot.py, whatsapp_bot.py
tests/                        — pytest test suite (test_health.py)
schema_v2.sql                 — proposed v2 schema (NOT yet applied to prod)
Dockerfile, docker-compose.yml — container build
streamlit_app.py              — admin/debug UI (local only)
```

## Run locally

```bash
python -m venv venv
source venv/bin/activate          # or venv\Scripts\activate on Windows
pip install -r requirements.txt
cp ../.env.example ../.env        # then fill in real values
uvicorn main:app --reload --port 8080
```

Visit http://localhost:8080/docs for the Swagger UI.

## Run tests

```bash
pytest tests -v
```

External services (Supabase, Anthropic) are mocked in unit tests via
`conftest.py`. Integration tests against real services are opt-in:

```bash
pytest tests -m integration       # only integration-marked tests
```

## Known divergences from production Worker

The FastAPI app implements similar concepts (search, chat, etc.) but is **not
guaranteed compatible** with the Worker's API contract. Treat it as a separate
codebase until we unify.

Things that exist here but not (yet) in the Worker:

- `services/certification.py` — Gold Standard certificate issuance
- `services/university_service.py` — academic domain auto-grants
- `services/industrial_api.py` — API-key issuance (`fai_…` keys)
- `services/open_encyclopedia.py` — public formula publication flow
- `bots/telegram_bot.py`, `bots/whatsapp_bot.py`

Things in the Worker but not here:

- Paystack + Stripe webhook handling (live billing)
- Tool-use chat loop with formula refs
- Discovery (Semantic Scholar / arXiv / Lens) harvest
- Daily rate-limit enforcement against `api_usage`

## Deployment plan (when ready)

1. Pick a host: Render, Fly.io, Vercel (serverless), or a small VPS.
2. Move the heavyweight long-running paths here (knowledge collector, bots).
3. Keep the Worker for low-latency hot paths (`/search`, `/chat`).
4. Use Supabase as the shared source of truth (no second database).
5. Update `assets/supabase-client.js` to call the right service per endpoint.

Until then: this directory is a design artifact, not a live service.
