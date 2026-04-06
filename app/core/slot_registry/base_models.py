"""Core data models for the slot schema registry (Layer 1 capability + domain)."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable


class SlotType(str, Enum):
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    DATE = "date"
    BOOLEAN = "boolean"
    ENUM = "enum"
    PHONE = "phone"
    ZIP = "zip"
    EMAIL = "email"


@dataclass
class SlotValidationResult:
    valid: bool
    normalized_value: Any = None
    error_message: str | None = None


@dataclass
class SlotDefinition:
    name: str
    description: str
    type: SlotType
    required: bool = True
    enum_values: list[str] | None = None
    validator: Callable[[Any], SlotValidationResult] | None = None
    depends_on: str | None = None
    condition: Callable[[dict[str, Any]], bool] | None = None
    retry_limit: int = 2
    prompt: str | None = None  # question to ask when this slot is missing
