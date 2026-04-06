"""Lazy singleton OpenAI client for chat / language helpers."""
from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)
_client: Any = None


def get_openai_client():
    """Return OpenAI() or None if not configured."""
    global _client
    if _client is None:
        try:
            from openai import OpenAI

            key = os.environ.get("OPENAI_API_KEY", "").strip()
            if key:
                _client = OpenAI(api_key=key)
            else:
                logger.warning(
                    "OPENAI_API_KEY is empty; LLM features (multilingual replies, call purpose translation) are disabled."
                )
                _client = False
        except Exception as e:
            logger.warning("OpenAI client init failed: %s", e, exc_info=True)
            _client = False
    return _client if _client else None
