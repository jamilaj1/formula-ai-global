"""
Formula AI Global API
Main entry point for the backend
"""
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from ai_brain.brain import FormulaAIBrain

from dotenv import load_dotenv
import os
load_dotenv()  # reads .env from current directory

app = FastAPI(title="Formula AI Global API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Initialize brain
brain = FormulaAIBrain(
    supabase_url=os.getenv("SUPABASE_URL", ""),
    supabase_key=os.getenv("SUPABASE_SERVICE_KEY", ""),
    anthropic_key=os.getenv("ANTHROPIC_API_KEY", "")
)

@app.get("/")
async def root():
    return {"message": "Formula AI Global API v3.0.0", "status": "operational"}

@app.get("/health")
async def health():
    return {"status": "ok", "brain": "active"}

@app.get("/api/stats")
async def stats():
    return brain.get_stats()

@app.get("/api/formula/search")
async def search_formula(query: str, language: str = "en"):
    """Search for a chemical formula"""
    try:
        result = brain.search(query, language)
        return {"success": True, "result": result, "query": query}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/formula/extract")
async def extract_formula(text: str, title: str = "Manual Input", author: str = "User", year: int = 2024):
    """Extract formulas from text"""
    try:
        source_info = {"type": "manual", "title": title, "author": author, "year": year}
        formulas = brain.extract_from_text(text, source_info)
        return {"success": True, "formulas_found": len(formulas), "formulas": formulas}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/formula/validate")
async def validate_formula(components: list):
    """Validate formula percentages"""
    result = brain.validate_percentages(components)
    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)