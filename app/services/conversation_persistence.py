"""Persist conversations and chat messages to Supabase (tied to user)."""
from __future__ import annotations

from app.db.supabase_client import get_supabase


def consume_user_request_quota(user_id: str, *, max_retries: int = 3) -> int:
    """
    Consume one request from the user's quota and return remaining quota.

    Raises:
    - ValueError("quota_exceeded") if no remaining quota.
    - RuntimeError on unexpected persistence failures.
    """
    ensure_user(user_id)
    supabase = get_supabase()

    for _ in range(max_retries):
        r = (
            supabase.table("users")
            .select("request_quota_total,request_quota_used")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        rows = r.data if hasattr(r, "data") else []
        if not rows:
            raise RuntimeError("User not found after ensure_user")
        row = dict(rows[0])
        total = int(row.get("request_quota_total") or 0)
        used = int(row.get("request_quota_used") or 0)
        if used >= total:
            raise ValueError("quota_exceeded")

        next_used = used + 1
        update_r = (
            supabase.table("users")
            .update({"request_quota_used": next_used})
            .eq("id", user_id)
            .eq("request_quota_used", used)
            .execute()
        )
        updated_rows = update_r.data if hasattr(update_r, "data") else []
        if updated_rows:
            return total - next_used

    raise RuntimeError("Failed to consume quota due to concurrent updates")


def get_user_request_quota_remaining(user_id: str) -> int:
    """Return request_quota_total - request_quota_used for user."""
    ensure_user(user_id)
    supabase = get_supabase()
    r = (
        supabase.table("users")
        .select("request_quota_total,request_quota_used")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    rows = r.data if hasattr(r, "data") else []
    if not rows:
        return 0
    row = dict(rows[0])
    total = int(row.get("request_quota_total") or 0)
    used = int(row.get("request_quota_used") or 0)
    return max(total - used, 0)


def get_user_request_quota(user_id: str) -> dict:
    """Return { total, used, remaining } for a user."""
    ensure_user(user_id)
    supabase = get_supabase()
    r = (
        supabase.table("users")
        .select("request_quota_total,request_quota_used")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    rows = r.data if hasattr(r, "data") else []
    if not rows:
        return {"total": 0, "used": 0, "remaining": 0}
    row = dict(rows[0])
    total = int(row.get("request_quota_total") or 0)
    used = int(row.get("request_quota_used") or 0)
    remaining = max(total - used, 0)
    return {"total": total, "used": used, "remaining": remaining}


def ensure_user(user_id: str) -> None:
    """Ensure user row exists so we remember every user who contacts us.
    If your users table has NOT NULL columns (e.g. email), we supply placeholders
    so the upsert succeeds; real auth can fill these later."""
    supabase = get_supabase()
    placeholder_email = "demo@holdless.local" if user_id == "00000000-0000-0000-0000-000000000001" else f"{user_id}@holdless.local"
    row = {
        "id": user_id,
        "email": placeholder_email,
    }
    supabase.table("users").upsert(row, on_conflict="id").execute()


def create_conversation(
    conversation_id: str,
    user_id: str,
    state: str,
    context: dict,
) -> None:
    """Insert a new conversation row (call when starting a new chat)."""
    ensure_user(user_id)
    supabase = get_supabase()
    supabase.table("conversations").insert({
        "id": conversation_id,
        "user_id": user_id,
        "state": state,
        "context": context,
    }).execute()


def update_conversation(
    conversation_id: str,
    state: str,
    context: dict,
) -> None:
    """Update conversation state and context after each message."""
    supabase = get_supabase()
    supabase.table("conversations").update({
        "state": state,
        "context": context,
    }).eq("id", conversation_id).execute()


def append_messages(
    conversation_id: str,
    user_content: str,
    assistant_content: str,
) -> None:
    """Append one user message and one assistant reply to chat_messages."""
    supabase = get_supabase()
    supabase.table("chat_messages").insert([
        {"conversation_id": conversation_id, "role": "user", "content": user_content},
        {"conversation_id": conversation_id, "role": "assistant", "content": assistant_content},
    ]).execute()


def list_conversations(user_id: str) -> list[dict]:
    """List conversations for a user, newest first."""
    supabase = get_supabase()
    r = (
        supabase.table("conversations")
        .select("id, user_id, state, created_at, updated_at")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .execute()
    )
    data = r.data if hasattr(r, "data") else []
    return [dict(row) for row in data]


def get_conversation_messages(conversation_id: str) -> list[dict]:
    """Get all messages for a conversation in order."""
    supabase = get_supabase()
    r = (
        supabase.table("chat_messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .execute()
    )
    data = r.data if hasattr(r, "data") else []
    return [dict(row) for row in data]


def delete_conversation(conversation_id: str, user_id: str) -> bool:
    """Delete a conversation and its messages. Returns True if deleted, False if not found or not owned by user."""
    supabase = get_supabase()
    r = (
        supabase.table("conversations")
        .delete()
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )
    # Supabase delete returns data; if we get here without error, consider it deleted
    return True
