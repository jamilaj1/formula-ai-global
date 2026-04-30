import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv('../.env')

app = FastAPI(title="Formula AI Global API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.get("/")
async def root():
    return {"message": "Formula AI Global API v3.0.0"}

@app.get("/health")
async def health():
    return {"status": "ok", "version": "3.0.0"}
