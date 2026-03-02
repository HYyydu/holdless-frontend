"""
Slot validation for task types. Checks that required slot groups are satisfied
(e.g. location: zip_code OR hospital_phone; pet_identity: pet_profile_id OR manual_pet_info).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core.slot_schemas import get_schema

# Slot value can be {"value": "...", "source": "user_input"|"profile"|...} or a simple value
def _slot_value(slots: dict[str, Any], key: str) -> Any:
    v = slots.get(key)
    if v is None:
        return None
    if isinstance(v, dict) and "value" in v:
        val = v["value"]
        return val if val is None or (isinstance(val, str) and val.strip()) else val
    if isinstance(v, str) and v.strip():
        return v.strip()
    return v


def _has_value(val: Any) -> bool:
    if val is None:
        return False
    if isinstance(val, str):
        return bool(val.strip())
    return True


@dataclass
class ValidationResult:
    """Result of validating a task's slots against its schema."""

    valid: bool
    missing_groups: list[str] = field(default_factory=list)
    missing_slot_names: list[str] = field(default_factory=list)
    next_prompt: str | None = None


def validate_price_comparison_slots(slots: dict[str, Any]) -> ValidationResult:
    """
    Validate slots for pet_services.price_comparison.
    Required:
      - location: zip_code OR hospital_phone
      - pet_identity: pet_profile_id OR manual_pet_info (name + breed required; age, weight optional)
    Returns ValidationResult with valid=True if all groups satisfied, else missing groups/slots and optional prompt.
    """
    schema = get_schema("pet_services", "price_comparison")
    if not schema:
        return ValidationResult(valid=False, missing_groups=["schema not found"])

    missing_groups: list[str] = []
    missing_slot_names: list[str] = []
    prompts_used: list[str] = []

    for group in schema.get("required_groups", []):
        group_name = group.get("group_name", "")
        one_of = group.get("one_of", [])
        group_satisfied = False
        first_missing_option = None

        for option in one_of:
            if option == "manual_pet_info":
                # Check manual_pet_info: need name + breed (and optionally age, weight)
                manual_cfg = schema.get("manual_pet_info_slots", {})
                required = manual_cfg.get("required", ["name", "breed"])
                optional = manual_cfg.get("optional", ["age", "weight"])
                all_required_filled = all(
                    _has_value(_slot_value(slots, s)) for s in required
                )
                if all_required_filled:
                    group_satisfied = True
                    break
                first_missing_option = option
                for s in required:
                    if not _has_value(_slot_value(slots, s)):
                        missing_slot_names.append(s)
            else:
                if _has_value(_slot_value(slots, option)):
                    group_satisfied = True
                    break
                first_missing_option = option

        if not group_satisfied:
            missing_groups.append(group_name)
            prompt_map = group.get("prompts", {})
            if first_missing_option and first_missing_option in prompt_map:
                prompts_used.append(prompt_map[first_missing_option])

    valid = len(missing_groups) == 0
    next_prompt = prompts_used[0] if prompts_used else None
    return ValidationResult(
        valid=valid,
        missing_groups=missing_groups,
        missing_slot_names=list(dict.fromkeys(missing_slot_names)),
        next_prompt=next_prompt,
    )
