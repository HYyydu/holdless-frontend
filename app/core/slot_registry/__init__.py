"""Slot schema registry: (domain, capability) -> list of SlotDefinition. Used by slot engine."""
from __future__ import annotations

from app.core.slot_registry.base_models import SlotDefinition, SlotType, SlotValidationResult
from app.core.slot_registry.registry import SlotRegistry

__all__ = ["SlotDefinition", "SlotType", "SlotValidationResult", "SlotRegistry"]
