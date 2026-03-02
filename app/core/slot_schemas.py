"""
Slot schema registry for task types (e.g. pet hospital price comparison).
Defines what information must be collected before calling — schema-driven, not hardcoded.
"""
from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Pet services: price comparison (get quotes from pet hospitals by area or phone)
# ---------------------------------------------------------------------------
# Required groups (at least one option per group must be filled):
#   - location: zip_code (area search) OR hospital_phone (specific hospital)
#   - pet_identity: pet_profile_id (existing profile) OR manual_pet_info (name, breed, age, weight)
# manual_pet_info when used: name and breed required; age and weight optional.
# ---------------------------------------------------------------------------

PRICE_COMPARISON_SCHEMA = {
    "domain": "pet_services",
    "task": "price_comparison",
    "description": "Get price quotes from pet hospitals — need location and pet info.",
    "required_groups": [
        {
            "group_name": "location",
            "one_of": ["zip_code", "hospital_phone"],
            "prompts": {
                "zip_code": "What's your ZIP code for area search? (e.g. 90210)",
                "hospital_phone": "Do you have a specific hospital phone number to get a quote from?",
            },
        },
        {
            "group_name": "pet_identity",
            "one_of": ["pet_profile_id", "manual_pet_info"],
            "prompts": {
                "pet_profile_id": "Do you have a pet profile to use? (yes/no)",
                "manual_pet_info": "I'll need your pet's name and breed (age and weight optional).",
            },
        },
    ],
    "manual_pet_info_slots": {
        "required": ["name", "breed"],
        "optional": ["age", "weight"],
    },
}

# All schemas keyed by "domain.task"
SLOT_SCHEMAS: dict[str, dict[str, Any]] = {
    "pet_services.price_comparison": PRICE_COMPARISON_SCHEMA,
}


def get_schema(domain: str, task: str) -> dict[str, Any] | None:
    """Return the slot schema for a domain.task, or None if not found."""
    key = f"{domain}.{task}"
    return SLOT_SCHEMAS.get(key)
