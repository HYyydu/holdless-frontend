"""Deterministic conversation state machine. No LLM; enum-based transitions."""
from __future__ import annotations

import re
from enum import Enum
from typing import Any

from app.services.fake_clinics import get_fake_clinics

MAX_CLINIC_SELECTIONS = 4
ZIP_PATTERN = re.compile(r"^\d{5}(-\d{4})?$")


class ConversationState(str, Enum):
    AWAITING_ZIP = "AWAITING_ZIP"
    AWAITING_PET_CONFIRM = "AWAITING_PET_CONFIRM"
    AWAITING_PET_SELECTION = "AWAITING_PET_SELECTION"
    AWAITING_PET_NAME = "AWAITING_PET_NAME"
    AWAITING_PET_BREED = "AWAITING_PET_BREED"
    AWAITING_PET_AGE_WEIGHT = "AWAITING_PET_AGE_WEIGHT"
    AWAITING_AVAILABILITY = "AWAITING_AVAILABILITY"
    SHOWING_CLINICS = "SHOWING_CLINICS"
    AWAITING_CLINIC_SELECTION = "AWAITING_CLINIC_SELECTION"
    AWAITING_CALL_CONFIRM = "AWAITING_CALL_CONFIRM"
    CONFIRMED = "CONFIRMED"


def _normalize_zip(msg: str) -> str | None:
    digits = re.sub(r"\D", "", msg.strip())
    if len(digits) == 5:
        return digits
    if len(digits) == 9:
        return f"{digits[:5]}-{digits[5:]}"
    return None


def _normalize_phone(msg: str) -> str | None:
    """Accept 10–11 digit US phone; return digits only or with +1 prefix for storage."""
    digits = re.sub(r"\D", "", msg.strip())
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def _extract_call_reason(msg: str) -> str | None:
    """Extract call purpose from message like 'Call X to ask for cat neuter price'."""
    m = (msg or "").strip()
    if not m:
        return None
    # Patterns: "ask for X", "to ask for X", "to get X", "for X", "about X"
    for pat in [
        r"(?:to\s+)?ask\s+for\s+(.+)",
        r"to\s+get\s+(.+)",
        r"(?:inquire|get)\s+(?:about\s+)?(.+)",
        r"for\s+(.+)",
        r"about\s+(.+)",
    ]:
        match = re.search(pat, m, re.IGNORECASE)
        if match:
            return match.group(1).strip()[:120]
    return None


PURPOSE_MAX_LENGTH = 500


def _build_call_purpose(context: dict[str, Any], profile: dict[str, Any] | None = None) -> str:
    """Build the same purpose string we send to the call backend (max 500 chars)."""
    reason = (context.get("call_reason") or "").strip() or "Veterinary price inquiry"
    bits = []
    if context.get("pet_profile_id"):
        if profile is None:
            from app.services.pet_profile_service import get_pet_profile

            profile = get_pet_profile(context["pet_profile_id"])
        if profile:
            name = (profile.get("name") or "").strip() or "pet"
            bits.append(f"pet {name}")
            if profile.get("species"):
                bits.append(f"species {profile['species']}")
            if profile.get("breed"):
                bits.append(f"breed {profile['breed']}")
            age = profile.get("age") or profile.get("age_years")
            if age is not None:
                bits.append(f"age {age}")
            if profile.get("weight"):
                bits.append(f"weight {profile['weight']}")
            dob = profile.get("date_of_birth")
            if dob:
                bits.append(f"date of birth {str(dob)}")
        else:
            name = context.get("pet_profile_name") or "pet"
            bits.append(f"pet {name}")
    elif context.get("name") or context.get("breed"):
        name = context.get("name") or "pet"
        breed = context.get("breed")
        age = context.get("age")
        weight = context.get("weight")
        bits.append(f"pet {name}")
        if breed:
            bits.append(f"breed {breed}")
        if age:
            bits.append(f"age {age}")
        if weight:
            bits.append(f"weight {weight}")
    purpose = f"Get {reason} for the " + ", ".join(bits) if bits else f"Get {reason}."
    return purpose[:PURPOSE_MAX_LENGTH]


def _is_yes(msg: str) -> bool:
    return msg.strip().lower() in ("yes", "y", "yeah", "yep", "confirm", "correct")


def _is_no(msg: str) -> bool:
    return msg.strip().lower() in ("no", "n", "nope")


def _build_call_summary(context: dict[str, Any]) -> str:
    """Build a short summary of the request and who we'll call, for confirmation."""
    from app.services.pet_profile_service import get_pet_profile

    profile = None
    if context.get("pet_profile_id"):
        profile = get_pet_profile(context["pet_profile_id"])
    purpose = _build_call_purpose(context, profile)
    context["call_reason"] = purpose
    parts = [f"Description: {purpose}", ""]
    # Location
    if context.get("zip"):
        parts.append(f"• Location: ZIP {context['zip']}")
    elif context.get("hospital_phone"):
        parts.append(f"• Location: Hospital at {context['hospital_phone']}")
    # Pet
    if context.get("pet_profile_id"):
        if profile:
            pet_parts = [profile.get("name") or "your saved profile"]
            if profile.get("species"):
                pet_parts.append(f"species: {profile['species']}")
            if profile.get("breed"):
                pet_parts.append(f"breed: {profile['breed']}")
            age_val = profile.get("age") if profile.get("age") is not None else profile.get("age_years")
            if age_val is not None:
                pet_parts.append(f"age: {age_val}")
            if profile.get("weight"):
                pet_parts.append(f"weight: {profile['weight']}")
            if profile.get("date_of_birth"):
                pet_parts.append(f"DOB: {str(profile['date_of_birth'])}")
            parts.append("• Pet: " + ", ".join(str(p) for p in pet_parts))
        else:
            name = context.get("pet_profile_name") or "your saved profile"
            parts.append(f"• Pet: {name}")
    elif context.get("name") or context.get("breed"):
        pet_bits = [context.get("name"), context.get("breed")]
        if context.get("age"):
            pet_bits.append(context.get("age"))
        if context.get("weight"):
            pet_bits.append(context.get("weight"))
        parts.append("• Pet: " + ", ".join(str(x) for x in pet_bits if x))
    # Availability
    if context.get("availability"):
        parts.append(f"• Availability: {context['availability']}")
    # Who we'll call
    selected = context.get("selected_clinics") or []
    if selected:
        names = ", ".join(c.get("name", "?") for c in selected)
        parts.append(f"• I will call: {names}")
    elif context.get("hospital_phone"):
        parts.append(f"• I will call: the hospital at {context['hospital_phone']}")
    if len(parts) <= 2:  # only Description and blank line
        return "\n".join(parts) + "\n\nHere's your request. Should I proceed with the call? (Yes/No)"
    return "\n".join(parts) + "\n\nShould I proceed with the call? (Yes/No)"


def parse_clinic_selection(message: str, num_candidates: int) -> list[int] | None:
    """
    Parse message like "1,3,4" into list of 1-based indices.
    Validates range [1, num_candidates], max MAX_CLINIC_SELECTIONS.
    Returns None if invalid.
    """
    if num_candidates <= 0:
        return None
    raw = re.sub(r"\s+", "", message.strip())
    if not re.match(r"^[\d,]+$", raw):
        return None
    parts = [p for p in raw.split(",") if p]
    if not parts:
        return None
    try:
        indices = [int(p) for p in parts]
    except ValueError:
        return None
    if len(indices) > MAX_CLINIC_SELECTIONS:
        return None
    seen = set()
    for i in indices:
        if i < 1 or i > num_candidates or i in seen:
            return None
        seen.add(i)
    return sorted(indices)


def transition(
    state: ConversationState,
    message: str,
    context: dict[str, Any],
    user_id: str,
) -> tuple[ConversationState, dict[str, Any], str, list[Any] | None]:
    """
    Deterministic transition. Returns (new_state, updated_context, reply_text, ui_options).
    ui_options is optional (e.g. list of clinics or choices).
    """
    msg = (message or "").strip()

    if state == ConversationState.AWAITING_ZIP:
        zip_val = _normalize_zip(msg)
        phone_val = _normalize_phone(msg)
        if zip_val:
            context["zip"] = zip_val
            return (
                ConversationState.AWAITING_PET_CONFIRM,
                context,
                "Thanks! I have your ZIP as " + zip_val + ". Do you want to use an existing profile? (yes/no)",
                None,
            )
        if phone_val:
            context["hospital_phone"] = phone_val
            reason = _extract_call_reason(msg)
            if reason:
                context["call_reason"] = reason
            return (
                ConversationState.AWAITING_PET_CONFIRM,
                context,
                "Thanks! I'll use that hospital number. Do you want to use an existing profile? (yes/no)",
                None,
            )
        return (
            state,
            context,
            "Please enter a 5-digit ZIP code for area search, or a hospital phone number (e.g. 10 digits).",
            None,
        )

    if state == ConversationState.AWAITING_PET_CONFIRM:
        if _is_yes(msg):
            from app.services.pet_profile_service import list_pet_profiles_for_user

            if user_id:
                profiles = list_pet_profiles_for_user(user_id)
                if profiles:
                    # Store minimal list for selection (id, name) so it can be persisted
                    candidates = [{"id": str(p["id"]), "name": (p.get("name") or "Unnamed pet")} for p in profiles]
                    context["pet_profile_candidates"] = candidates
                    lines = ["Here are your pet profiles:"]
                    for i, p in enumerate(candidates, 1):
                        lines.append(f"  {i}. {p['name']}")
                    lines.append("Reply with the number of the profile you want to use (e.g. 1).")
                    return (
                        ConversationState.AWAITING_PET_SELECTION,
                        context,
                        "\n".join(lines),
                        candidates,
                    )
            # No profiles: if hospital_phone, skip availability; else ask availability
            if context.get("hospital_phone"):
                summary = _build_call_summary(context)
                return (
                    ConversationState.AWAITING_CALL_CONFIRM,
                    context,
                    "Please confirm before I place the call:\n\n" + summary,
                    None,
                )
            return (
                ConversationState.AWAITING_AVAILABILITY,
                context,
                "When are you available? (e.g. weekends, weekdays after 5pm)",
                None,
            )
        if _is_no(msg):
            return (
                ConversationState.AWAITING_PET_NAME,
                context,
                "No problem. What's your pet's name?",
                None,
            )
        return (
            state,
            context,
            "Please answer yes or no: do you want to use an existing profile?",
            None,
        )

    if state == ConversationState.AWAITING_PET_SELECTION:
        candidates = context.get("pet_profile_candidates") or []
        n = len(candidates)
        if n == 0:
            return (
                ConversationState.AWAITING_PET_CONFIRM,
                context,
                "No profiles to choose from. Do you want to use an existing profile? (yes/no)",
                None,
            )
        raw = re.sub(r"\s+", "", msg.strip())
        if not re.match(r"^\d+$", raw):
            return (
                state,
                context,
                f"Please reply with a number from 1 to {n} (e.g. 1).",
                candidates,
            )
        try:
            idx = int(raw)
        except ValueError:
            return (
                state,
                context,
                f"Please reply with a number from 1 to {n} (e.g. 1).",
                candidates,
            )
        if idx < 1 or idx > n:
            return (
                state,
                context,
                f"Please reply with a number from 1 to {n} (e.g. 1).",
                candidates,
            )
        chosen = candidates[idx - 1]
        context["pet_profile_id"] = chosen["id"]
        context["pet_profile_name"] = chosen.get("name") or "your pet"
        name = context["pet_profile_name"]
        # If user gave a specific phone number (price inquiry), skip availability and go to confirm
        if context.get("hospital_phone"):
            summary = _build_call_summary(context)
            return (
                ConversationState.AWAITING_CALL_CONFIRM,
                context,
                "Please confirm before I place the call:\n\n" + summary,
                None,
            )
        return (
            ConversationState.AWAITING_AVAILABILITY,
            context,
            f"Using profile for {name}. When are you available? (e.g. weekends, weekdays after 5pm)",
            None,
        )

    if state == ConversationState.AWAITING_PET_NAME:
        if not msg:
            return (state, context, "Please tell me your pet's name.", None)
        context["name"] = msg.strip()
        return (
            ConversationState.AWAITING_PET_BREED,
            context,
            "What's the breed? (e.g. Golden Retriever)",
            None,
        )

    if state == ConversationState.AWAITING_PET_BREED:
        if not msg:
            return (state, context, "Please tell me the breed.", None)
        context["breed"] = msg.strip()
        return (
            ConversationState.AWAITING_PET_AGE_WEIGHT,
            context,
            "Age and weight? (optional — e.g. 3 years, 25 lbs — or say 'skip' to continue)",
            None,
        )

    if state == ConversationState.AWAITING_PET_AGE_WEIGHT:
        if msg.strip().lower() in ("skip", "no", "n", "none", ""):
            context["age"] = None
            context["weight"] = None
        else:
            # Store as single string for optional age/weight; validator accepts either
            context["age"] = msg.strip()[:50]
            context["weight"] = msg.strip()[:30]
        # If user gave a specific phone number (price inquiry), skip availability and go to confirm
        if context.get("hospital_phone"):
            summary = _build_call_summary(context)
            return (
                ConversationState.AWAITING_CALL_CONFIRM,
                context,
                "Please confirm before I place the call:\n\n" + summary,
                None,
            )
        return (
            ConversationState.AWAITING_AVAILABILITY,
            context,
            "When are you available? (e.g. weekends, weekdays after 5pm)",
            None,
        )

    if state == ConversationState.AWAITING_AVAILABILITY:
        if not msg:
            return (
                state,
                context,
                "Please describe your availability (e.g. weekends, weekdays after 5pm).",
                None,
            )
        context["availability"] = msg
        # If user already gave a specific hospital phone number, skip clinic search and go to call confirmation.
        if context.get("hospital_phone"):
            summary = _build_call_summary(context)
            return (
                ConversationState.AWAITING_CALL_CONFIRM,
                context,
                "Please confirm before I place the call:\n\n" + summary,
                None,
            )
        clinics = get_fake_clinics()
        context["clinic_candidates"] = [c for c in clinics]
        lines = ["Here are some clinics near you:"]
        for i, c in enumerate(clinics, 1):
            lines.append(f"  {i}. {c['name']} — rating {c['rating']}, {c['distance']} mi")
        lines.append("Reply with the numbers you want (e.g. 1,3,4). You can pick up to 4.")
        return (
            ConversationState.AWAITING_CLINIC_SELECTION,
            context,
            "\n".join(lines),
            clinics,
        )

    if state == ConversationState.AWAITING_CLINIC_SELECTION:
        candidates = context.get("clinic_candidates") or []
        n = len(candidates)
        indices = parse_clinic_selection(msg, n) if n else None
        if indices is not None:
            selected = [candidates[i - 1] for i in indices]
            context["selected_clinics"] = selected
            summary = _build_call_summary(context)
            return (
                ConversationState.AWAITING_CALL_CONFIRM,
                context,
                "Please confirm before I place the call:\n\n" + summary,
                None,
            )
        return (
            state,
            context,
            f"Please reply with up to 4 numbers from 1 to {n}, separated by commas (e.g. 1,3,4).",
            candidates,
        )

    if state == ConversationState.SHOWING_CLINICS:
        candidates = context.get("clinic_candidates") or []
        n = len(candidates)
        indices = parse_clinic_selection(msg, n) if n else None
        if indices is not None:
            selected = [candidates[i - 1] for i in indices]
            context["selected_clinics"] = selected
            summary = _build_call_summary(context)
            return (
                ConversationState.AWAITING_CALL_CONFIRM,
                context,
                "Please confirm before I place the call:\n\n" + summary,
                None,
            )
        return (
            ConversationState.AWAITING_CLINIC_SELECTION,
            context,
            f"Please reply with up to 4 numbers from 1 to {n}, separated by commas (e.g. 1,3,4).",
            candidates,
        )

    if state == ConversationState.AWAITING_CALL_CONFIRM:
        if _is_yes(msg):
            names = ", ".join(c.get("name", "?") for c in (context.get("selected_clinics") or []))
            if not names and context.get("hospital_phone"):
                names = f"the hospital at {context['hospital_phone']}"
            return (
                ConversationState.CONFIRMED,
                context,
                f"Confirmed. I'll reach out to {names or 'the selected clinics'} soon. Thank you!",
                None,
            )
        if _is_no(msg):
            return (
                ConversationState.AWAITING_CALL_CONFIRM,
                context,
                "No problem. Your request is not placed. You can start a new request anytime, or reply with different clinic numbers to change your selection.",
                None,
            )
        return (
            state,
            context,
            "Please answer Yes or No: should I proceed with the call?",
            None,
        )

    return (
        state,
        context,
        "This conversation is complete. Start a new one if you need more help.",
        None,
    )
