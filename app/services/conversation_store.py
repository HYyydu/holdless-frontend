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
        "flow_type": None,  # "return_service" | "hospital_pet_quote" (set by flow router)
        "slot_state": None,  # slot engine state: { slots: {}, status: "collecting"|"ready" }
        "slot_domain": None,  # e.g. "pet" when in SLOT_COLLECTING
        "slot_capability": None,  # e.g. "price_quote" when in SLOT_COLLECTING
        "pending_hybrid_offer": None,  # { "domain": str, "capability": str } when we showed "Would you like me to call?"
        "zip": None,
        "address": None,
        "location_query": None,
        "hospital_phone": None,
        "phone": None,  # used by return_service flow (same as hospital_phone for backend)
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
        "reply_locale": None,  # "zh" | "en" | None — assistant reply language preference
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
        # Return-flow states (RETURN_*) stay as string; hospital flow uses ConversationState
        if not state_str.startswith("RETURN_"):
            try:
                payload["state"] = ConversationState(state_str)
            except ValueError:
                payload["state"] = ConversationState.AWAITING_ZIP
        else:
            payload["state"] = state_str
    if "context" not in payload:
        payload["context"] = _default_context()
    return payload


def save(
    conversation_id: str,
    user_id: str,
    state: ConversationState | str,
    context: dict[str, Any],
) -> None:
    """Save conversation and refresh TTL. state can be ConversationState or return-flow state string (RETURN_*)."""
    r = _get_redis()
    state_value = state.value if hasattr(state, "value") else str(state)
    payload = {
        "user_id": user_id,
        "state": state_value,
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
