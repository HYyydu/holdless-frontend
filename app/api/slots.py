"""
Slot schema and validation API for task flows (e.g. pet hospital price comparison).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.slot_schemas import SLOT_SCHEMAS, get_schema
from app.core.validators import validate_price_comparison_slots, ValidationResult

router = APIRouter()


class ValidateSlotsBody(BaseModel):
    """Request body for validating slots (e.g. from conversation context)."""

    domain: str = Field(..., description="e.g. pet_services")
    task: str = Field(..., description="e.g. price_comparison")
    slots: dict = Field(default_factory=dict, description="Slot name -> { value, source } or plain value")


@router.get("/slot-schema/{domain}/{task}")
def get_slot_schema(domain: str, task: str) -> dict:
    """Return the slot schema for a task type (what to ask before calling)."""
    schema = get_schema(domain, task)
    if not schema:
        raise HTTPException(status_code=404, detail=f"No schema for {domain}.{task}")
    return schema


@router.get("/slot-schemas")
def list_slot_schemas() -> dict:
    """List all registered slot schemas (keys and descriptions)."""
    return {
        key: {
            "domain": s.get("domain"),
            "task": s.get("task"),
            "description": s.get("description"),
        }
        for key, s in SLOT_SCHEMAS.items()
    }


@router.post("/slot-schemas/validate", response_model=dict)
def validate_slots(body: ValidateSlotsBody) -> dict:
    """
    Validate slots for a task type. Returns valid, missing_groups, missing_slot_names, next_prompt.
    Use this to decide what to ask next in the conversation.
    """
    if body.domain == "pet_services" and body.task == "price_comparison":
        result = validate_price_comparison_slots(body.slots)
    else:
        raise HTTPException(
            status_code=404,
            detail=f"No validator for {body.domain}.{body.task}",
        )
    return {
        "valid": result.valid,
        "missing_groups": result.missing_groups,
        "missing_slot_names": result.missing_slot_names,
        "next_prompt": result.next_prompt,
    }


def context_to_slots(context: dict) -> dict:
    """
    Map conversation context (from state machine) to slot shape for validation.
    Use when validating current state: zip -> zip_code, pet_profile_id -> pet_profile_id,
    and manual pet fields name, breed, age, weight if present.
    """
    slots = {}
    if context.get("zip"):
        slots["zip_code"] = {"value": context["zip"], "source": "user_input"}
    if context.get("hospital_phone") or context.get("business_phone"):
        slots["hospital_phone"] = {
            "value": context.get("hospital_phone") or context.get("business_phone"),
            "source": "user_input",
        }
    if context.get("pet_profile_id"):
        slots["pet_profile_id"] = {"value": context["pet_profile_id"], "source": "profile"}
    for key in ("name", "breed", "age", "weight"):
        if context.get(key) is not None and str(context.get(key)).strip():
            slots[key] = {"value": str(context[key]).strip(), "source": "user_input"}
    return slots
