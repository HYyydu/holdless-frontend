"""Pydantic models for DB entities (Part 1 schema)."""
from app.models.pet_profiles import PetProfileCreate, PetProfileResponse
from app.models.tasks import TaskCreate, TaskResponse

__all__ = [
    "PetProfileCreate",
    "PetProfileResponse",
    "TaskCreate",
    "TaskResponse",
]
