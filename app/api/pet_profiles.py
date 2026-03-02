"""Pet profile CRUD API — sync Profile tab with Supabase pet_profiles."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
from pydantic import BaseModel, Field

from app.services.pet_profile_service import (
    list_pet_profiles_for_user,
    create_pet_profile,
    delete_pet_profile,
)

router = APIRouter()


class PetProfileCreateBody(BaseModel):
    """Request body for creating a pet profile."""

    user_id: str = Field(..., description="Owner user id (must match auth)")
    name: str = Field(..., min_length=1)
    species: str | None = None
    breed: str | None = None
    age: str | None = None
    weight: str | None = None
    date_of_birth: str | None = None  # YYYY-MM-DD


class PetProfileItem(BaseModel):
    """Single pet profile for JSON response."""

    id: str
    user_id: str
    name: str
    species: str | None
    breed: str | None
    age: str | None
    weight: str | None
    date_of_birth: str | None
    created_at: str
    updated_at: str


@router.get("/pet-profiles", response_model=dict)
def list_pets(user_id: str) -> dict:
    """List all pet profiles for the given user_id."""
    if not user_id.strip():
        raise HTTPException(status_code=400, detail="user_id is required")
    rows = list_pet_profiles_for_user(user_id.strip())
    items = [
        PetProfileItem(
            id=str(r["id"]),
            user_id=str(r["user_id"]),
            name=r.get("name") or "",
            species=r.get("species"),
            breed=r.get("breed"),
            age=r.get("age"),
            weight=r.get("weight"),
            date_of_birth=str(r["date_of_birth"]) if r.get("date_of_birth") else None,
            created_at=str(r.get("created_at", "")),
            updated_at=str(r.get("updated_at", "")),
        )
        for r in rows
    ]
    return {"pet_profiles": [i.model_dump() for i in items]}


@router.post("/pet-profiles", response_model=dict)
def create_pet(body: PetProfileCreateBody) -> dict:
    """Create a pet profile for the user. Ensures user exists in DB."""
    if not body.user_id.strip():
        raise HTTPException(status_code=400, detail="user_id is required")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    data = {
        "name": body.name.strip(),
        "species": body.species.strip() if body.species else None,
        "breed": body.breed.strip() if body.breed else None,
        "age": body.age.strip() if body.age else None,
        "weight": body.weight.strip() if body.weight else None,
        "date_of_birth": body.date_of_birth.strip() if body.date_of_birth else None,
    }
    try:
        row = create_pet_profile(body.user_id.strip(), data)
    except Exception as e:
        logger.exception("create_pet_profile failed")
        raise HTTPException(status_code=503, detail=str(e))
    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "name": row.get("name", ""),
        "species": row.get("species"),
        "breed": row.get("breed"),
        "age": row.get("age"),
        "weight": row.get("weight"),
        "date_of_birth": str(row["date_of_birth"]) if row.get("date_of_birth") else None,
        "created_at": str(row.get("created_at", "")),
        "updated_at": str(row.get("updated_at", "")),
    }


@router.delete("/pet-profiles/{pet_profile_id}", response_model=dict)
def delete_pet(pet_profile_id: str, user_id: str) -> dict:
    """Delete a pet profile. user_id must match owner."""
    if not user_id.strip():
        raise HTTPException(status_code=400, detail="user_id is required")
    delete_pet_profile(pet_profile_id.strip(), user_id.strip())
    return {"ok": True}
