"""Deterministic conversation state machine. No LLM; enum-based transitions."""
from __future__ import annotations

import re
from enum import Enum
from typing import Any

from app.services.places_search import resolve_clinics_near_zip

MAX_CLINIC_SELECTIONS = 4


def _apply_selected_clinics_phone(context: dict[str, Any], selected: list[dict]) -> None:
    """First selected clinic drives outbound call (chat.py uses hospital_phone)."""
    context["selected_clinics"] = selected
    if not selected:
        return
    p = (selected[0].get("phone") or "").strip()
    if p:
        context["hospital_phone"] = p
ZIP_PATTERN = re.compile(r"^\d{5}(-\d{4})?$")
# US NANP: optional +1/1, then 10 digits with optional separators (used for extraction and stripping)
_PHONE_PATTERN = re.compile(
    r"(?:\+1|1)?[-.\s()]*(?:\d{3})[-.\s)]*(?:\d{3})[-.\s]*(?:\d{4})\b"
)


class ConversationState(str, Enum):
    AWAITING_ZIP = "AWAITING_ZIP"
    SLOT_COLLECTING = "SLOT_COLLECTING"  # slot engine driving collection
    SLOT_AWAITING_PET_PROFILE = "SLOT_AWAITING_PET_PROFILE"  # ask "use existing profile?" (slot flow)
    SLOT_AWAITING_PET_SELECTION = "SLOT_AWAITING_PET_SELECTION"  # user picks profile 1,2,3 (slot flow)
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
    """Return 5-digit ZIP only when the message is essentially just digits (5 or 9)."""
    digits = re.sub(r"\D", "", msg.strip())
    if len(digits) == 5:
        return digits
    if len(digits) == 9:
        return f"{digits[:5]}-{digits[5:]}"
    return None


def _extract_zip_from_text(msg: str) -> str | None:
    """Extract a 5-digit (or 9-digit) ZIP from anywhere in the text (e.g. address ending in '90024')."""
    if not msg or not isinstance(msg, str):
        return None
    # Match 5-digit or 5+4 ZIP (US)
    match = re.search(r"\b(\d{5})(?:-\d{4})?\b", msg.strip())
    if match:
        return match.group(1)
    return None


def _looks_like_address(msg: str) -> bool:
    """True if message looks like a street address (letters + numbers, multiple words), not a phone or pure ZIP."""
    if not msg or len(msg.strip()) < 5:
        return False
    s = msg.strip()
    # Exclude: pure digits (ZIP), or phone-like (10–11 digits, maybe with separators)
    digits_only = re.sub(r"\D", "", s)
    if len(digits_only) <= 5 and len(s) <= 12:
        return False
    if len(digits_only) >= 10 and len(digits_only) <= 11:
        return False
    # Has letters and at least one digit or multiple words (e.g. "740 weyburn terrace")
    has_letter = bool(re.search(r"[A-Za-z]", s))
    word_count = len(s.split())
    return has_letter and (word_count >= 2 or re.search(r"\d", s) is not None)


def _normalize_phone(msg: str) -> str | None:
    """Accept 10–11 digit US phone; return digits only or with +1 prefix for storage."""
    if not msg or not isinstance(msg, str):
        return None
    s = msg.strip()
    if not s:
        return None
    # Substring match: if the user adds other digits in the same message (years, IDs like EK2026),
    # concatenating all digits breaks 10/11-length detection; prefer a NANP-shaped span first.
    for m in _PHONE_PATTERN.finditer(s):
        cand = re.sub(r"\D", "", m.group(0))
        if len(cand) == 10:
            return f"+1{cand}"
        if len(cand) == 11 and cand.startswith("1"):
            return f"+{cand}"
    digits = re.sub(r"\D", "", s)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def _fallback_vet_purpose_from_message(msg: str) -> str | None:
    """When structured patterns miss, infer a short vet purpose from keywords (appointment vs price)."""
    low = (msg or "").lower()
    if not any(
        k in low
        for k in (
            "vet",
            "veterinar",
            "pet hospital",
            "animal hospital",
            "clinic",
            "neuter",
            "spay",
            "neutering",
        )
    ):
        return None
    species = "pet"
    if "cat" in low or "kitten" in low:
        species = "cat"
    elif "dog" in low or "puppy" in low:
        species = "dog"
    if "neuter" in low or "spay" in low or "neutering" in low:
        if any(x in low for x in ("appointment", "schedule", "book", "make an appointment")):
            return f"Schedule a {species} neuter/spay appointment; confirm pricing, prep, and availability"
        return f"{species} neuter/spay pricing and availability"
    if any(x in low for x in ("appointment", "schedule", "book")):
        return "Veterinary appointment scheduling and details"
    return None


def _extract_call_reason(msg: str) -> str | None:
    """Extract call purpose from a message.

    Supports both:
    - information gathering: "call X to ask/check/find out ..."
    - message delivery: "call X and tell them/let them know/inform/share ..."
    """
    m = (msg or "").strip()
    if not m:
        return None
    # Strip leading "dial X and" / "call X and" so we match the intent clause (e.g. "check the neutering cost for a cat")
    m = re.sub(
        r"^(?:dial|call)\s+(?:\d[\d\s\-\.\(\)]+)\s+and\s+",
        "",
        m,
        flags=re.IGNORECASE,
    ).strip()
    # Strip common search preamble so patterns hit the real intent ("... call them to ...")
    m = re.sub(
        r"^(?:search|find)\s+(?:nearby\s+)?(?:a\s+)?(?:pet\s+)?(?:vet(?:erinary)?|hospital|clinic)s?\s+(?:near\s+me\s+)?(?:and\s+)?",
        "",
        m,
        flags=re.IGNORECASE,
    ).strip()
    # Chinese: purpose after 来问 / 询问 / 咨询 / 了解 (before sentence end)
    for pat in (
        r"来问(.+?)(?:\s*$|[。．，,])",
        r"询问(.+?)(?:\s*$|[。．，,])",
        r"咨询(.+?)(?:\s*$|[。．，,])",
        r"了解(.+?)(?:\s*$|[。．，,])",
    ):
        match = re.search(pat, m)
        if match:
            extracted = match.group(1).strip()
            extracted = _strip_phone_numbers(extracted)
            if extracted:
                return extracted[:120]
    # Scheduling / appointment phrasing (before generic "for/about" and before "call them" as delivery)
    appointment_first = [
        r"(?:make|book|schedule)\s+an?\s+appointment(?:\s+for|\s+in\s+getting|\s+to\s+get)?\s+(.+)",
        r"(?:make|book|schedule)\s+an?\s+appointment\s+to\s+(.+)",
        r"appointment\s+(?:for|to\s+get|in\s+getting)\s+(.+)",
        r"in\s+getting\s+(.+?)(?:\.|$)",
    ]
    for pat in appointment_first:
        match = re.search(pat, m, re.IGNORECASE | re.DOTALL)
        if match:
            extracted = match.group(1).strip()
            extracted = _strip_phone_numbers(extracted)
            while True:
                trimmed = re.sub(
                    r"\b(?:to|call|dial|phone)\b\s*$",
                    "",
                    extracted,
                    flags=re.IGNORECASE,
                ).strip()
                if trimmed == extracted:
                    break
                extracted = trimmed
            if extracted:
                # Keep scheduling intent: "make an appointment ... in getting a cat neuter" → not just "a cat neuter service"
                if "appointment" in m.lower() and re.match(r"^(a|an)\s+", extracted, re.I):
                    rest = re.sub(r"^(a|an)\s+", "", extracted, count=1, flags=re.I).strip()
                    if rest:
                        extracted = f"appointment for {rest}"
                return extracted[:120]
    # "... call them to <purpose>" — recurse on inner clause for nested appointment phrasing
    call_them = re.search(r"\bcall\s+them\s+to\s+(.+)", m, re.IGNORECASE | re.DOTALL)
    if call_them:
        inner = call_them.group(1).strip()
        nested = _extract_call_reason(inner)
        if nested:
            return nested[:120]
        inner = _strip_phone_numbers(inner)
        if inner:
            return inner[:120]
    # Patterns (order matters): prefer full task phrases so we keep "the neutering cost for a cat", not just "a cat"
    delivery_patterns: list[tuple[str, str]] = [
        # Message delivery (prefer explicit wording so we don't misclassify generic "for/about" clauses)
        # "to tell we are going out tonight" / "deliver a message to X to tell we are ..." (pronoun optional)
        (r"(?:to\s+)?tell\s+(?:him|her|them)?\s*(?:that\s+)?(.+)", "Tell them: "),
        (r"(?:to\s+)?let\s+(?:him|her|them)\s+know\s+(?:that\s+)?(.+)", "Tell them: "),
        (r"(?:to\s+)?inform\s+(?:him|her|them)\s+(?:that\s+)?(.+)", "Tell them: "),
        (r"(?:to\s+)?share\s+(?:the\s+)?information\s+(?:that\s+)?(.+)", "Tell them: "),
    ]
    info_patterns: list[str] = [
        r"(?:to\s+)?ask\s+(.+)",  # "ask the price for a cat neuter service" -> "the price for a cat neuter service"
        r"(?:to\s+)?ask\s+for\s+(.+)",
        r"to\s+get\s+(.+)",
        r"(?:inquire|get)\s+(?:about\s+)?(.+)",
        r"check\s+(.+)",  # "check the neutering cost for a cat" -> full phrase (before generic "for")
        r"find\s+out\s+(.+)",
        r"to\s+((?:return|cancel|reschedule|make|book|schedule|order|request|report|discuss|dispute|buy|change|update|complain|inquire)\b.+)",
        r"(?:can\s+you\s+)?(?:please\s+)?return\s+(.+)",  # e.g. "Can you return the damaged strawberries to 9452644540?"
        r"for\s+(.+)",
        r"about\s+(.+)",
    ]
    for pat, prefix in delivery_patterns:
        match = re.search(pat, m, re.IGNORECASE)
        if match:
            extracted = (prefix + match.group(1).strip()).strip()
            extracted = _strip_phone_numbers(extracted)
            # Phone stripping can leave trailing artifacts like "to call"; trim repeatedly.
            while True:
                trimmed = re.sub(
                    r"\b(?:to|call|dial|phone)\b\s*$",
                    "",
                    extracted,
                    flags=re.IGNORECASE,
                ).strip()
                if trimmed == extracted:
                    break
                extracted = trimmed
            return extracted[:120] if extracted else None
    for pat in info_patterns:
        match = re.search(pat, m, re.IGNORECASE)
        if match:
            extracted = match.group(1).strip()
            extracted = _strip_phone_numbers(extracted)
            while True:
                trimmed = re.sub(
                    r"\b(?:to|call|dial|phone)\b\s*$",
                    "",
                    extracted,
                    flags=re.IGNORECASE,
                ).strip()
                if trimmed == extracted:
                    break
                extracted = trimmed
            return extracted[:120] if extracted else None
    fb = _fallback_vet_purpose_from_message(m)
    return fb[:120] if fb else None


PURPOSE_MAX_LENGTH = 500


def _task_line_from_reason(reason: str) -> str:
    """One clear sentence for outbound calls; use 'Get …' only when it reads naturally."""
    r = (reason or "").strip()
    if not r:
        return "Veterinary service inquiry"
    low = r.lower()
    if low.startswith("tell them:"):
        return r[0].upper() + r[1:] if len(r) > 1 else r.capitalize()
    for prefix in (
        "appointment ",
        "schedule ",
        "book ",
        "make an ",
        "ask ",
        "request ",
        "compare ",
        "find ",
    ):
        if low.startswith(prefix):
            return r[0].upper() + r[1:] if len(r) > 1 else r.capitalize()
    return f"Get {r}"


def _strip_phone_numbers(text: str) -> str:
    """Remove US-style phone numbers from text so purpose/description stays clean (e.g. no 'from 9452644540')."""
    if not text or not isinstance(text, str):
        return text
    cleaned = _PHONE_PATTERN.sub("", text)
    # Collapse whitespace only; do not strip periods/commas (they separate sentences in call purpose).
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _build_call_purpose(context: dict[str, Any], profile: dict[str, Any] | None = None) -> str:
    """Build the same purpose string we send to the call backend (max 500 chars)."""
    reason = (context.get("call_reason") or "").strip() or "Veterinary service inquiry"
    reason = _strip_phone_numbers(reason) or "Veterinary service inquiry"
    task_line = _task_line_from_reason(reason)
    bits = []
    if context.get("pet_profile_id"):
        if profile is None:
            from app.services.pet_profile_service import get_pet_profile

            profile = get_pet_profile(context["pet_profile_id"])
        if profile:
            name = (profile.get("name") or "").strip() or "pet"
            bits.append(name)
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
            bits.append(name)
    elif context.get("name") or context.get("breed"):
        name = context.get("name") or "pet"
        breed = context.get("breed")
        age = context.get("age")
        weight = context.get("weight")
        bits.append(name)
        if breed:
            bits.append(f"breed {breed}")
        if age:
            bits.append(f"age {age}")
        if weight:
            bits.append(f"weight {weight}")
    # Prefer clear task-first wording; avoid "Get appointment …" (redundant).
    if bits:
        purpose = f"{task_line}. Pet: " + ", ".join(bits)
    else:
        purpose = f"{task_line}."
    # Strip any phone numbers that might have appeared in pet bits or elsewhere
    purpose = _strip_phone_numbers(purpose)
    return purpose[:PURPOSE_MAX_LENGTH]


def _is_yes(msg: str) -> bool:
    return msg.strip().lower() in ("yes", "y", "yeah", "yep", "confirm", "correct")


def is_positive_confirmation(msg: str) -> bool:
    """
    True if the message is a clear positive confirmation (e.g. accepting a hybrid offer to call).
    Used so we can start the slot engine deterministically when user says "yes, call" after
    a "Would you like me to call?" offer, without re-running Layer 1.
    """
    if not msg or not isinstance(msg, str):
        return False
    m = msg.strip().lower()
    if m in ("yes", "y", "yeah", "yep", "sure", "please", "please do", "ok", "okay", "confirm", "correct"):
        return True
    # Phrases that accept an offer to call
    call_accept = (
        "i would like you to call",
        "yes i would like you to call",
        "yes, i would like you to call",
        "please call",
        "go ahead and call",
        "yes please call",
        "call them",
        "call please",
    )
    return any(phrase in m for phrase in call_accept)


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
        # Preserve the user's stated purpose from the first (or any) message while we collect ZIP.
        if not (context.get("call_reason") or "").strip():
            extracted_reason = _extract_call_reason(msg)
            if extracted_reason:
                context["call_reason"] = extracted_reason
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
        # Accept ZIP embedded in text (e.g. "740 weyburn terrace, los angeles ca 90024") or full address
        zip_from_text = _extract_zip_from_text(msg)
        if zip_from_text:
            context["zip"] = zip_from_text
            context["location_query"] = msg.strip()[:200]
            return (
                ConversationState.AWAITING_PET_CONFIRM,
                context,
                "Thanks! I have your area (ZIP " + zip_from_text + "). Do you want to use an existing profile? (yes/no)",
                None,
            )
        if _looks_like_address(msg):
            context["address"] = msg.strip()[:200]
            context["location_query"] = msg.strip()[:200]
            zip_from_geocode = None
            try:
                from app.services.geocode import geocode_to_zip
                zip_from_geocode = geocode_to_zip(msg)
            except Exception:
                pass
            if zip_from_geocode:
                context["zip"] = zip_from_geocode
                return (
                    ConversationState.AWAITING_PET_CONFIRM,
                    context,
                    "Thanks! I have your address (area ZIP " + zip_from_geocode + "). Do you want to use an existing profile? (yes/no)",
                    None,
                )
            # Address but geocode failed or no API key: still accept and ask for ZIP as fallback
            return (
                state,
                context,
                "I have your address. To search clinics by area I need a ZIP code—please add it (e.g. 90210) or send just the 5-digit ZIP.",
                None,
            )
        return (
            state,
            context,
            "Please enter a 5-digit ZIP code or full address for the search area (e.g. 90210 or 740 Weyburn Terrace, Los Angeles), or a hospital phone number (10 digits).",
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
            # Yes, but no saved profiles (anonymous user, empty list, or DB issue): do not loop on the same prompt.
            if context.get("hospital_phone"):
                summary = _build_call_summary(context)
                return (
                    ConversationState.AWAITING_CALL_CONFIRM,
                    context,
                    "Please confirm before I place the call:\n\n" + summary,
                    None,
                )
            return (
                ConversationState.AWAITING_PET_NAME,
                context,
                "No saved pet profiles yet. What's your pet's name?",
                None,
            )
        if context.get("hospital_phone"):
            summary = _build_call_summary(context)
            return (
                ConversationState.AWAITING_CALL_CONFIRM,
                context,
                "Please confirm before I place the call:\n\n" + summary,
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
            purpose = _build_call_purpose(context)
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
            purpose = _build_call_purpose(context)
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
            purpose = _build_call_purpose(context)
            return (
                ConversationState.AWAITING_CALL_CONFIRM,
                context,
                "Please confirm before I place the call:\n\n" + summary,
                None,
            )
        zip_code = context.get("zip")
        clinics = resolve_clinics_near_zip(zip_code)
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
            _apply_selected_clinics_phone(context, selected)
            summary = _build_call_summary(context)
            purpose = _build_call_purpose(context)
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
            _apply_selected_clinics_phone(context, selected)
            summary = _build_call_summary(context)
            purpose = _build_call_purpose(context)
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
            
            from app.services.pet_profile_service import get_pet_profile
            profile = None
            if context.get("pet_profile_id"):
                profile = get_pet_profile(context["pet_profile_id"])
            purpose = _build_call_purpose(context, profile)
            
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
