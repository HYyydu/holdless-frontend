"""Pet profile lookups and CRUD from Supabase."""
from __future__ import annotations

from app.db.supabase_client import get_supabase


def list_pet_profiles_for_user(user_id: str) -> list[dict]:
    """Return all pet profiles for the user, oldest first."""
    supabase = get_supabase()
    r = (
        supabase.table("pet_profiles")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
    )
    rows = r.data if hasattr(r, "data") else []
    return [dict(row) for row in rows]


def get_first_pet_for_user(user_id: str) -> dict | None:
    """Return the first pet profile for the user, or None."""
    supabase = get_supabase()
    r = (
        supabase.table("pet_profiles")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at")
        .limit(1)
        .execute()
    )
    rows = r.data if hasattr(r, "data") else []
    if not rows:
        return None
    row = rows[0]
    return {k: v for k, v in row.items()}


def get_pet_profile(pet_profile_id: str) -> dict | None:
    """Return a single pet profile by id."""
    supabase = get_supabase()
    r = supabase.table("pet_profiles").select("*").eq("id", pet_profile_id).limit(1).execute()
    rows = r.data if hasattr(r, "data") else []
    if not rows:
        return None
    return {k: v for k, v in rows[0].items()}


def create_pet_profile(user_id: str, data: dict) -> dict:
    """Insert a pet profile for the user. Ensures user exists. Returns inserted row."""
    from app.services.conversation_persistence import ensure_user

    ensure_user(user_id)
    supabase = get_supabase()
    row = {
        "user_id": user_id,
        "name": data.get("name", ""),
        "species": data.get("species"),
        "breed": data.get("breed"),
        "age": data.get("age"),
        "weight": data.get("weight"),
        "date_of_birth": data.get("date_of_birth"),
    }
    r = supabase.table("pet_profiles").insert(row).execute()
    out = r.data if hasattr(r, "data") else []
    if not out:
        raise RuntimeError("Pet profile insert did not return data")
    return dict(out[0])


def delete_pet_profile(pet_profile_id: str, user_id: str) -> bool:
    """Delete a pet profile if it belongs to the user. Returns True if deleted."""
    supabase = get_supabase()
    r = (
        supabase.table("pet_profiles")
        .delete()
        .eq("id", pet_profile_id)
        .eq("user_id", user_id)
        .execute()
    )
    return True
