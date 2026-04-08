#!/usr/bin/env python3
"""Run the Holdless Python chat API (Supabase + Redis state machine)."""
import os
from pathlib import Path

# Load .env from project root (directory containing this script) so OPENAI_API_KEY is available
try:
    from dotenv import load_dotenv
    _root = Path(__file__).resolve().parent
    load_dotenv(_root / ".env")
    load_dotenv(Path.cwd() / ".env", override=False)  # cwd as fallback
except ImportError:
    pass

# Railway injects PORT. Keep PYTHON_API_PORT for local/dev override.
port = int(os.environ.get("PORT") or os.environ.get("PYTHON_API_PORT", "8000"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=os.environ.get("CHAT_API_RELOAD", "").lower() in ("1", "true", "yes"),
    )
