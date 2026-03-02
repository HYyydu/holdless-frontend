"""FastAPI app: Supabase + Redis conversation backend."""
from __future__ import annotations

import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.chat import router as chat_router
from app.api.pet_profiles import router as pet_profiles_router
from app.api.slots import router as slots_router
from app.api.tasks import router as tasks_router

app = FastAPI(title="Holdless Chat API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router, prefix="/api", tags=["chat"])
app.include_router(pet_profiles_router, prefix="/api", tags=["pet-profiles"])
app.include_router(slots_router, prefix="/api", tags=["slot-schemas"])
app.include_router(tasks_router, prefix="/api", tags=["tasks"])


@app.get("/")
def root() -> dict:
    return {
        "ok": True,
        "message": "Holdless chat API (Supabase + Redis)",
        "chat": "POST /api/chat",
    }
