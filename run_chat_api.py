#!/usr/bin/env python3
"""Run the Holdless Python chat API (Supabase + Redis state machine)."""
import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

port = int(os.environ.get("PYTHON_API_PORT", "8000"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=os.environ.get("CHAT_API_RELOAD", "").lower() in ("1", "true", "yes"),
    )
