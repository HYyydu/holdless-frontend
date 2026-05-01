"""FastAPI app: Supabase + Redis conversation backend."""
from __future__ import annotations

import os
from pathlib import Path

# Load .env so OPENAI_API_KEY is available when app is imported by uvicorn.
# Try project root first, then cwd (e.g. if started from another directory).
try:
    from dotenv import load_dotenv
    _root = Path(__file__).resolve().parent.parent  # app/main.py -> project root
    load_dotenv(_root / ".env")
    load_dotenv(Path.cwd() / ".env", override=False)  # cwd as fallback, don't override
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.chat import router as chat_router
from app.api.pet_profiles import router as pet_profiles_router
from app.api.slots import router as slots_router
from app.api.tasks import router as tasks_router

app = FastAPI(title="Holdless Chat API", version="1.0.0")


@app.on_event("startup")
def _log_openai_key_status() -> None:
    """Log whether OPENAI_API_KEY is set so operators see it in the Python backend logs."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if key:
        print("OPENAI_API_KEY: set (ChatGPT fallback and flow router enabled)")
    else:
        print(
            "OPENAI_API_KEY: not set — add it to .env in the project root, or export it before starting the Python backend. "
            "Otherwise simple chat (e.g. 'hello') will show the fallback message."
        )
    cal_key = os.environ.get("CAL_COM_API_KEY", "").strip()
    cal_et = os.environ.get("CAL_COM_EVENT_TYPE_ID", "").strip()
    print(
        "CAL_COM: "
        + ("API key set, " if cal_key else "API key not set — ")
        + ("EVENT_TYPE_ID set" if cal_et else "EVENT_TYPE_ID missing — slots API will be skipped")
    )


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
