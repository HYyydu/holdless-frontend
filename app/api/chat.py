"""POST /chat: deterministic state machine chat endpoint."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.conversation_persistence import (
    create_conversation,
    ensure_user,
    update_conversation,
    append_messages,
    list_conversations,
    get_conversation_messages,
    delete_conversation,
)
from app.services.conversation_store import load, save, create_new
from app.services.state_machine import ConversationState, transition
from app.services.task_service import create_task

router = APIRouter()


class ChatRequest(BaseModel):
    user_id: str
    message: str = ""
    conversation_id: str | None = None


def _context_for_redis(context: dict) -> dict:
    """Strip any non-persisted keys from context before saving to Redis."""
    return {
        "zip": context.get("zip"),
        "hospital_phone": context.get("hospital_phone"),
        "call_reason": context.get("call_reason"),
        "pet_profile_id": context.get("pet_profile_id"),
        "pet_profile_name": context.get("pet_profile_name"),
        "pet_profile_candidates": context.get("pet_profile_candidates") or [],
        "name": context.get("name"),
        "breed": context.get("breed"),
        "age": context.get("age"),
        "weight": context.get("weight"),
        "availability": context.get("availability"),
        "clinic_candidates": context.get("clinic_candidates") or [],
        "selected_clinics": context.get("selected_clinics") or [],
    }


@router.post("/chat")
def post_chat(body: ChatRequest) -> dict:
    """
    Input: { user_id: str, message: str, conversation_id?: str }
    Output: { reply_text, ui_options?, conversation_id, debug_state }
    """
    user_id = body.user_id
    message = body.message or ""
    conversation_id = body.conversation_id if body.conversation_id else None

    ensure_user(user_id)

    conv = load(conversation_id) if conversation_id else None
    if not conv:
        conversation_id, conv = create_new(user_id)
        state = conv["state"]
        context = conv["context"].copy()
        try:
            create_conversation(
                conversation_id,
                user_id,
                state.value,
                persisted_context := _context_for_redis(context),
            )
        except Exception as e:
            raise HTTPException(
                status_code=503,
                detail=f"Failed to persist conversation: {e!s}",
            )
    else:
        state = conv["state"]
        context = conv["context"].copy()
        persisted_context = None

    new_state, updated_context, reply_text, ui_options = transition(
        state, message, context, user_id
    )

    persisted_context = _context_for_redis(updated_context)
    save(conversation_id, user_id, new_state, persisted_context)

    try:
        update_conversation(conversation_id, new_state.value, persisted_context)
        append_messages(conversation_id, message, reply_text)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to persist chat: {e!s}",
        )

    task_id = None
    if new_state == ConversationState.CONFIRMED:
        payload = {
            "zip": persisted_context.get("zip"),
            "hospital_phone": persisted_context.get("hospital_phone"),
            "call_reason": persisted_context.get("call_reason"),
            "pet_profile_id": persisted_context.get("pet_profile_id"),
            "name": persisted_context.get("name"),
            "breed": persisted_context.get("breed"),
            "age": persisted_context.get("age"),
            "weight": persisted_context.get("weight"),
            "availability": persisted_context.get("availability"),
            "selected_clinics": persisted_context.get("selected_clinics"),
        }
        try:
            task = create_task(user_id, payload)
            task_id = task.get("id") if isinstance(task, dict) else None
        except Exception as e:
            raise HTTPException(
                status_code=503,
                detail=f"Conversation confirmed but task creation failed: {e!s}",
            )

    result = {
        "reply_text": reply_text,
        "conversation_id": conversation_id,
        "debug_state": new_state.value,
    }
    if ui_options is not None:
        result["ui_options"] = ui_options
    if task_id is not None:
        result["task_id"] = task_id
        result["hospital_phone"] = persisted_context.get("hospital_phone")
        result["call_reason"] = persisted_context.get("call_reason") or "Veterinary price inquiry"
    return result


@router.get("/conversations")
def get_conversations_list(user_id: str) -> dict:
    """List conversations for the given user_id. Query param: user_id."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    try:
        items = list_conversations(user_id)
        return {"conversations": items}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/conversations/{conversation_id}/messages")
def get_messages(conversation_id: str) -> dict:
    """Get all messages for a conversation."""
    try:
        messages = get_conversation_messages(conversation_id)
        return {"messages": messages}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.delete("/conversations/{conversation_id}")
def delete_conversation_route(
    conversation_id: str,
    user_id: str = Query(..., description="User ID (required for auth)"),
) -> dict:
    """Delete a conversation and its messages. Requires user_id query param."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    try:
        delete_conversation(conversation_id, user_id)
        return {"ok": True, "id": conversation_id}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
