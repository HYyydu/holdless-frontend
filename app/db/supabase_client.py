"""Supabase client singleton for persistent data (users, pet_profiles, tasks)."""
from __future__ import annotations

import os
from typing import Any, Optional

try:
    from supabase import create_client
except ImportError as e:
    raise ImportError(
        "Supabase package not installed or wrong environment. "
        "From project root run: pip install -r requirements.txt (or use the project's .venv)"
    ) from e

_client: Optional[Any] = None


def get_supabase() -> Any:
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) must be set")
        _client = create_client(url, key)
    return _client
