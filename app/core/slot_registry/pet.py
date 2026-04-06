"""Pet domain slot schemas (price_quote)."""
from __future__ import annotations

from typing import Any

from app.core.slot_registry.base_models import SlotDefinition, SlotType
from app.core.slot_registry.validators import validate_phone, validate_zip, validate_enum


def _validate_pet_type(value: Any):
    from app.core.slot_registry.base_models import SlotValidationResult
    if value is None or (isinstance(value, str) and not value.strip()):
        return SlotValidationResult(False, None, "Please say dog, cat, or another animal (e.g. rabbit, bird, other).")
    v = str(value).strip().lower()
    if v in ("dog", "cat"):
        return SlotValidationResult(True, v)
    # "other" or "none of them" or specific species (rabbit, bird, etc.)
    other_phrases = ("other", "none", "neither", "none of them", "neither of them", "another animal")
    if v in other_phrases or any(p in v for p in other_phrases):
        return SlotValidationResult(True, "other")
    # Common other animals: accept as "other" so we don't reject
    other_animals = ("rabbit", "bird", "hamster", "guinea pig", "ferret", "reptile", "lizard", "snake", "turtle", "fish", "horse", "bunny")
    if any(a in v for a in other_animals):
        return SlotValidationResult(True, "other")
    # Single word that's not dog/cat: treat as other (e.g. "rabbit", "bird")
    if v and len(v) < 30 and v.replace(" ", "") == v:
        return SlotValidationResult(True, "other")
    return SlotValidationResult(False, None, "Please say dog, cat, or another animal (e.g. rabbit, bird, other).")


PET_PRICE_QUOTE: list[SlotDefinition] = [
    SlotDefinition(
        name="zip_code",
        description="ZIP code or full address of the search area",
        type=SlotType.ZIP,
        required=True,
        validator=validate_zip,
        prompt="What's your 5-digit ZIP code or full address for the search area? (e.g. 90210 or 740 Weyburn Terrace, Los Angeles)",
    ),
    SlotDefinition(
        name="phone",
        description="Clinic phone number (10 digits) when you already know who to call",
        type=SlotType.PHONE,
        required=False,
        validator=validate_phone,
        prompt="What's the clinic's 10-digit US phone number?",
    ),
    # Freeform purpose from the user's wording (e.g. "the price for cat neuter service").
    # Persisted via merge so it is not dropped; preferred over service_type in call description.
    SlotDefinition(
        name="call_reason",
        description="What to ask or find out on the call (verbatim from user when possible)",
        type=SlotType.STRING,
        required=False,
        prompt="What should we ask or find out on the call?",
    ),
    SlotDefinition(
        name="service_type",
        description="Type of service (e.g. neutering, vaccination)",
        type=SlotType.STRING,
        required=True,
        prompt="What service do you need? (e.g. neutering, vaccination, check-up)",
    ),
    SlotDefinition(
        name="pet_type",
        description="Type of pet (dog, cat, or other animal)",
        type=SlotType.ENUM,
        required=True,
        enum_values=["dog", "cat", "other"],
        validator=_validate_pet_type,
        prompt="Is this for a dog, a cat, or another animal? (If another animal, say which one or 'other')",
    ),
    SlotDefinition(
        name="name",
        description="Pet's name",
        type=SlotType.STRING,
        required=True,
        prompt="What's your pet's name?",
    ),
    SlotDefinition(
        name="breed",
        description="Breed of the pet",
        type=SlotType.STRING,
        required=False,
        prompt="What's the breed? (e.g. Golden Retriever, or say skip)",
    ),
    SlotDefinition(
        name="age",
        description="Age of the pet in years",
        type=SlotType.STRING,
        required=False,
        prompt="How old is your pet? (e.g. 3 years, or say skip)",
    ),
    SlotDefinition(
        name="weight",
        description="Weight in pounds",
        type=SlotType.STRING,
        required=False,
        prompt="Weight in lbs? (optional, or say skip)",
    ),
]
