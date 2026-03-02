"""Pydantic models for pet_profiles table (Part 1 — aligned with Supabase)."""
from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PetProfileBase(BaseModel):
    """Fields shared by create and response."""

    name: str
    species: str | None = None  # dog/cat/other; maps to pet_type in prompt
    breed: str | None = None
    age: str | None = None  # free-form e.g. "3 years"
    weight: str | None = None
    date_of_birth: date | None = None


class PetProfileCreate(PetProfileBase):
    """Payload for creating a pet profile. user_id set by API."""

    pass


class PetProfileResponse(PetProfileBase):
    """Pet profile as returned from DB (includes id, user_id, timestamps)."""

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
