"""Retail domain slot schemas (complaint / return)."""
from __future__ import annotations

from app.core.slot_registry.base_models import SlotDefinition, SlotType
from app.core.slot_registry.validators import validate_phone

# Return/refund call: phone + optional reason
RETURN_SERVICE: list[SlotDefinition] = [
    SlotDefinition(
        name="phone",
        description="Store or business phone number to call",
        type=SlotType.PHONE,
        required=True,
        validator=validate_phone,
        prompt="What's the store's 10-digit phone number? (e.g. from your receipt)",
    ),
    SlotDefinition(
        name="call_reason",
        description="Reason for the call (return, refund, complaint)",
        type=SlotType.STRING,
        required=False,
        prompt="What should I say when I call? (e.g. returning strawberries, request refund)",
    ),
]
