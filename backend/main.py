"""
Formula AI Global — FastAPI entry point.
Boots the AI brain, the global knowledge collector, and exposes the v1/v2 API.
"""
import os
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import anthropic
from supabase import create_client, Client

# .env is one level up from /backend
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# -------- 3rd-party clients ----------------------------------
supabase: Client = create_client(
    os.getenv("SUPABASE_URL", ""),
    os.getenv("SUPABASE_SERVICE_KEY", ""),
)

claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
# Keep in sync with worker.js (claude-haiku-4-5). The previous default
# "claude-sonnet-4-5-20250114" was never a real model identifier and would
# fail at first request.
CLAUDE_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")

# -------- Local imports (after clients exist) ---------------
from ai_brain.brain import FormulaAIBrain
from knowledge_collector.collector import UniversalKnowledgeCollector

brain = FormulaAIBrain(supabase, claude, CLAUDE_MODEL)
collector = UniversalKnowledgeCollector(brain, supabase)


# -------- Lifespan: start background workers ----------------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(collector.start())
    print("🌍 Knowledge Collector started in background")
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(
    title="Formula AI Global API",
    description="AI-powered chemical formulation platform",
    version="3.0.0",
    lifespan=lifespan,
)

# CORS — default to the production origin only. Override via CORS_ORIGINS env
# (comma-separated). Never use "*" together with allow_credentials=True — most
# browsers reject that combination, and it would expose every other origin.
_cors_origins = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "https://jamilformula.com").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# -------- Health & basic stats ------------------------------
@app.get("/health")
async def health():
    return {"status": "ok", "version": app.version}


@app.get("/api/stats")
async def stats():
    formulas = supabase.table("formulas").select("count", count="exact").execute()
    chemicals = (
        supabase.table("chemicals_database").select("count", count="exact").execute()
    )
    return {
        "total_formulas": formulas.count or 0,
        "total_chemicals": chemicals.count or 0,
        "industries": 40,
        "countries": 195,
        "languages": 20,
    }


# -------- Routers (v1 = core, v2 = business, chem = RDKit Phase 1) -----
from app.api.v1 import search, formulas, chat, export
from app.api.v2 import compliance, subscription, ads, global_initiatives
from app.api.chem import properties as chem_properties
from app.api.chem import lookup as chem_lookup
from app.api.chem import similarity as chem_similarity
from app.api.chem import ml as chem_ml
from app.api.agents import routes as agents_routes
from app.api.vision import routes as vision_routes

app.include_router(search.router, prefix="/api/v1")
app.include_router(formulas.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")

app.include_router(compliance.router, prefix="/api/v2")
app.include_router(subscription.router, prefix="/api/v2")
app.include_router(ads.router, prefix="/api/v2")
app.include_router(global_initiatives.router, prefix="/api/v2")

# Chemistry endpoints (RDKit + PubChem). Mounted at /api so routes become /api/chem/*.
app.include_router(chem_properties.router, prefix="/api")
app.include_router(chem_lookup.router, prefix="/api")
app.include_router(chem_similarity.router, prefix="/api")
app.include_router(chem_ml.router, prefix="/api")

# Multi-agent reasoning (Phase 3). Routes become /api/agents/*.
app.include_router(agents_routes.router, prefix="/api")

# Claude Vision (Phase 6). Routes become /api/vision/*.
app.include_router(vision_routes.router, prefix="/api")


# Make `brain` and `supabase` reachable from routers via app.state
@app.on_event("startup")
async def _populate_state():
    app.state.brain = brain
    app.state.supabase = supabase
    app.state.claude = claude


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=True)
