"""Redis conversation store. Key: conv:{conversation_id}, TTL: 7 days."""
from __future__ import annotations

import json
import os
import uuid
from typing import Any

import redis

from app.services.state_machine import ConversationState

TTL_DAYS = 7
TTL_SECONDS = TTL_DAYS * 24 * 60 * 60
KEY_PREFIX = "conv:"


def _get_redis() -> redis.Redis:
    url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    return redis.from_url(url, decode_responses=True)


def _key(conversation_id: str) -> str:
    return f"{KEY_PREFIX}{conversation_id}"


def _default_context() -> dict[str, Any]:
    return {
        "zip": None,
        "hospital_phone": None,
        "call_reason": None,
        "pet_profile_id": None,
        "pet_profile_name": None,
        "pet_profile_candidates": [],
        "name": None,
        "breed": None,
        "age": None,
        "weight": None,
        "availability": None,
        "clinic_candidates": [],
        "selected_clinics": [],
    }


def load(conversation_id: str) -> dict[str, Any] | None:
    """Load conversation by id. Returns None if not found."""
    r = _get_redis()
    data = r.get(_key(conversation_id))
    if not data:
        return None
    payload = json.loads(data)
    state_str = payload.get("state")
    if state_str:
        try:
            payload["state"] = ConversationState(state_str)
        except ValueError:
            payload["state"] = ConversationState.AWAITING_ZIP
    if "context" not in payload:
        payload["context"] = _default_context()
    return payload


def save(
    conversation_id: str,
    user_id: str,
    state: ConversationState,
    context: dict[str, Any],
) -> None:
    """Save conversation and refresh TTL."""
    r = _get_redis()
    payload = {
        "user_id": user_id,
        "state": state.value,
        "context": context,
    }
    key = _key(conversation_id)
    r.setex(key, TTL_SECONDS, json.dumps(payload))


def create_new(user_id: str) -> tuple[str, dict[str, Any]]:
    """Create a new conversation. Returns (conversation_id, conversation_data)."""
    conversation_id = str(uuid.uuid4())
    context = _default_context()
    save(conversation_id, user_id, ConversationState.AWAITING_ZIP, context)
    return conversation_id, {
        "user_id": user_id,
        "state": ConversationState.AWAITING_ZIP,
        "context": context,
    }
