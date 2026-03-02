"""Task CRUD in Supabase. Chat flow uses create_task (ready_to_queue); frontend uses create/update/list."""
from __future__ import annotations

from app.db.supabase_client import get_supabase
from app.services.conversation_persistence import ensure_user


def create_task(user_id: str, payload: dict, *, status: str = "ready_to_queue") -> dict:
    """Insert a task. Default status 'ready_to_queue' (chat flow); frontend can pass status."""
    ensure_user(user_id)
    supabase = get_supabase()
    row = {
        "user_id": user_id,
        "status": status,
        "payload": payload,
    }
    r = supabase.table("tasks").insert(row).execute()
    data = r.data if hasattr(r, "data") else []
    if not data:
        raise RuntimeError("Task insert did not return data")
    return {k: v for k, v in data[0].items()}


def list_tasks(user_id: str) -> list[dict]:
    """Return all tasks for the user, newest first."""
    ensure_user(user_id)
    supabase = get_supabase()
    r = supabase.table("tasks").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
    data = r.data if hasattr(r, "data") else []
    return list(data) if data else []


def update_task(task_id: str, user_id: str, *, status: str | None = None, payload: dict | None = None) -> dict | None:
    """Update task by id. Only provided fields are updated. When payload is given, it is merged with existing payload (so e.g. transcript can be added without overwriting other fields). Returns updated row or None if not found."""
    supabase = get_supabase()
    updates = {}
    if status is not None:
        updates["status"] = status
    if payload is not None:
        # Merge with existing payload so we can add transcript without losing callId, title, etc.
        r_fetch = supabase.table("tasks").select("payload").eq("id", task_id).eq("user_id", user_id).execute()
        existing = r_fetch.data if hasattr(r_fetch, "data") and r_fetch.data else []
        current = dict(existing[0]["payload"]) if existing and existing[0].get("payload") is not None else {}
        merged = {**current, **payload}
        updates["payload"] = merged
    if not updates:
        return None
    r = supabase.table("tasks").update(updates).eq("id", task_id).eq("user_id", user_id).execute()
    data = r.data if hasattr(r, "data") else []
    if not data:
        return None
    return {k: v for k, v in data[0].items()}
