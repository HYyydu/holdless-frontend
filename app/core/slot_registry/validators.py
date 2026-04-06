"""Shared validators for slot registry (ZIP, phone, etc.)."""
from __future__ import annotations

import re

from app.core.slot_registry.base_models import SlotValidationResult


def _digits(s: str) -> str:
    return re.sub(r"\D", "", (s or "").strip())


def validate_zip(value: Any) -> SlotValidationResult:
    if value is None:
        return SlotValidationResult(False, None, "ZIP is required")
    raw = str(value).strip()
    digits = _digits(raw)
    if len(digits) == 5:
        return SlotValidationResult(True, digits)
    if len(digits) == 9:
        return SlotValidationResult(True, f"{digits[:5]}-{digits[5:]}")
    return SlotValidationResult(False, None, "Please enter a 5-digit ZIP code.")


def validate_phone(value: Any) -> SlotValidationResult:
    if value is None:
        return SlotValidationResult(False, None, "Phone number is required")
    digits = _digits(str(value))
    if len(digits) == 10:
        return SlotValidationResult(True, f"+1{digits}")
    if len(digits) == 11 and digits.startswith("1"):
        return SlotValidationResult(True, f"+{digits}")
    return SlotValidationResult(False, None, "Please enter a 10-digit US phone number.")


def validate_enum(value: Any, allowed: list[str]) -> SlotValidationResult:
    if value is None or (isinstance(value, str) and not value.strip()):
        return SlotValidationResult(False, None, "A value is required")
    v = str(value).strip().lower()
    for a in allowed:
        if a.lower() == v:
            return SlotValidationResult(True, a)
    return SlotValidationResult(False, None, f"Please choose one of: {', '.join(allowed)}")
