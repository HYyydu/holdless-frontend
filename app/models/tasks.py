"""Pydantic models for tasks table (Part 1 — domain, task, slots)."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class TaskBase(BaseModel):
    """Fields shared by create and response."""

    domain: str | None = None  # e.g. "pet_services"
    task: str | None = None  # e.g. "price_comparison", "appointment_booking"
    status: str = "ready_to_queue"
    parent_task_id: UUID | None = None
    slots: dict = Field(default_factory=dict)  # jsonb: slot name -> { value, source }
    payload: dict = Field(default_factory=dict)  # legacy / extra


class TaskCreate(TaskBase):
    """Payload for creating a task. user_id set by API."""

    pass


class TaskResponse(TaskBase):
    """Task as returned from DB."""

    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
