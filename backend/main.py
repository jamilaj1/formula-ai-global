"""
Formula AI Global API - Complete Version
"""
import os
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import tempfile

load_dotenv()

from ai_brain.brain import FormulaAIBrain
from ai_brain.pdf_extractor import PDFBookExtractor

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

# Initialize PDF extractor
pdf_extractor = PDFBookExtractor(brain)

@app.get("/")
async def root():
    return {"message": "Formula AI Global API v3.0.0", "brain": "active", "pdf_extractor": "ready"}

@app.get("/health")
async def health():
    return {"status": "ok", "brain": "active"}

@app.get("/api/stats")
async def stats():
    return brain.get_stats()

@app.get("/api/formula/search")
async def search_formula(query: str, language: str = "en"):
    """Search for a chemical formula using AI"""
    try:
        result = brain.search(query, language)
        return {"success": True, "result": result, "query": query, "language": language}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

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
    """Validate formula percentages sum to 100%"""
    result = brain.validate_percentages(components)
    return result

@app.post("/api/book/upload")
async def upload_book(file: UploadFile = File(...)):
    """Upload a PDF book and extract all chemical formulas"""
    try:
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
        
        # Extract formulas
        result = pdf_extractor.extract_from_pdf(tmp_path)
        
        # Clean up
        os.unlink(tmp_path)
        
        return {"success": True, **result}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.get("/api/search/simple")
async def simple_search(query: str, language: str = "en"):
    """Simple search endpoint for the frontend"""
    try:
        result = brain.search(query, language)
        return {"results": result}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)