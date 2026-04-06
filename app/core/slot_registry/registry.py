"""Slot schema registry: (domain, capability) -> list[SlotDefinition]."""
from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.slot_registry.pet import PET_PRICE_QUOTE
from app.core.slot_registry.retail import RETURN_SERVICE

if TYPE_CHECKING:
    from app.core.slot_registry.base_models import SlotDefinition


class SlotRegistry:
    """Maps (domain, capability) to slot schema. Used by slot engine after Layer 1."""

    _registry: dict[tuple[str, str], list["SlotDefinition"]] = {
        ("pet", "price_quote"): PET_PRICE_QUOTE,
        ("retail", "complaint"): RETURN_SERVICE,
    }

    @classmethod
    def get_schema(cls, domain: str, capability: str) -> list["SlotDefinition"] | None:
        return cls._registry.get((domain, capability))

    @classmethod
    def has_schema(cls, domain: str, capability: str) -> bool:
        return (domain, capability) in cls._registry
