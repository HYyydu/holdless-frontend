"""
State machine for the "return service" and "general_business_quote" flows.

- return_service: get phone (and optional reason) → confirm → confirmed.
- general_business_quote: get phone, then "what kind of service?" if missing → confirm → confirmed.

States: AWAITING_PHONE_OR_ZIP → [AWAITING_REASON for general_business only] → AWAITING_CALL_CONFIRM → CONFIRMED.
"""
from __future__ import annotations

import json
import re
from enum import Enum
from typing import Any

# Reuse phone/reason helpers from main state machine to stay consistent
from app.services.state_machine import (
    _extract_call_reason,
    _is_no,
    _is_yes,
    _normalize_phone,
    _strip_phone_numbers,
)
from app.services.state_machine import PURPOSE_MAX_LENGTH

# Prefix for return-flow states so chat layer can tell which machine to use
RETURN_STATE_PREFIX = "RETURN_"

FLOW_GENERAL_BUSINESS_QUOTE = "general_business_quote"
FLOW_GENERAL_CALL = "general_call"  # call any number with purpose (gather information)
DEFAULT_RETURN_REASON = "Customer return/refund inquiry"
DEFAULT_GENERAL_BUSINESS_REASON = "Price or service inquiry"
DEFAULT_GENERAL_CALL_REASON = "Information gathering"
DEFAULT_GENERAL_CALL_DELIVERY_REASON = "Message delivery"
CALL_DETAILS_MAX_LENGTH = 2000
_PARKING_QUEUE_PAYLOAD_RE = re.compile(r"^\[\[PARKING_QUEUE\]\]\s*(\{.*\})\s*$", re.DOTALL)
_ZIP_RE = re.compile(r"(?<!\d)(\d{5}(?:-\d{4})?)(?!\d)")


class ReturnFlowState(str, Enum):
    AWAITING_PHONE_OR_ZIP = "RETURN_AWAITING_PHONE_OR_ZIP"
    AWAITING_REASON = "RETURN_AWAITING_REASON"  # general_business_quote only: ask what kind of service
    AWAITING_PERSONAL_INFO_CONFIRM = "RETURN_AWAITING_PERSONAL_INFO_CONFIRM"
    AWAITING_INSURANCE_DETAILS = "RETURN_AWAITING_INSURANCE_DETAILS"
    AWAITING_CALL_CONFIRM = "RETURN_AWAITING_CALL_CONFIRM"
    CONFIRMED = "RETURN_CONFIRMED"

INSURANCE_FLOW_TAG = "insurance_search"
INSURANCE_SLOT_ORDER: list[str] = [
    "zip_code",
    "age",
    "household_size",
    "annual_income",
    "preferred_doctors",
    "prescriptions",
    "budget_range",
    "coverage_type",
]
INSURANCE_OPTIONAL_SLOTS = {"preferred_doctors", "prescriptions"}
INSURANCE_SLOT_PROMPTS: dict[str, str] = {
    "zip_code": "What is your ZIP code for plan pricing/network checks?",
    "age": "What is your age?",
    "household_size": "How many people are in your household?",
    "annual_income": "What is your approximate annual household income?",
    "preferred_doctors": "Any preferred doctors? (optional, type 'skip' if none)",
    "prescriptions": "Any current prescriptions to check coverage for? (optional, type 'skip' if none)",
    "budget_range": "What monthly budget range do you prefer for premium + expected costs?",
    "coverage_type": "What coverage tier do you prefer: bronze, silver, gold, or unsure?",
}


def _is_insurance_quote_intent(text: str) -> bool:
    low = (text or "").strip().lower()
    if not low:
        return False
    # Dispute/explanation intents should never go through quote intake.
    dispute_signals = (
        "dispute",
        "billing",
        "bill",
        "claim",
        "adjustment",
        "overcharge",
        "extra charge",
        "incorrect",
        "wrong charge",
        "why",
        "explain",
        "understand whether",
    )
    if any(sig in low for sig in dispute_signals):
        return False
    quote_signals = (
        "quote",
        "plan",
        "premium",
        "deductible",
        "coverage",
        "enroll",
        "marketplace",
        "compare",
        "shopping",
    )
    return any(sig in low for sig in quote_signals)


def _insurance_profile(context: dict[str, Any]) -> dict[str, str]:
    raw = context.get("insurance_call_profile")
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items() if v is not None}
    return {}


def _saved_personal_profile(context: dict[str, Any]) -> dict[str, str]:
    raw = context.get("personal_profile")
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key in (
        "name",
        "email",
        "phone",
        "address",
        "dateOfBirth",
        "state",
        "zipCode",
        "householdSize",
        "annualIncome",
        "budgetRange",
        "coverageType",
        "preferredDoctors",
        "prescriptions",
    ):
        val = raw.get(key)
        if val is None:
            continue
        text = str(val).strip()
        if text:
            out[key] = text
    return out


def _age_from_date_of_birth(value: str) -> str:
    """Best-effort age from YYYY-MM-DD (or YYYY/MM/DD)."""
    m = re.match(r"^\s*(\d{4})[-/](\d{2})[-/](\d{2})\s*$", value or "")
    if not m:
        return ""
    try:
        from datetime import date

        year = int(m.group(1))
        month = int(m.group(2))
        day = int(m.group(3))
        dob = date(year, month, day)
        today = date.today()
        age = today.year - dob.year - (
            (today.month, today.day) < (dob.month, dob.day)
        )
        if age < 0 or age > 120:
            return ""
        return str(age)
    except Exception:
        return ""


def _insurance_slot_label(slot: str) -> str:
    labels = {
        "zip_code": "ZIP code",
        "age": "age",
        "household_size": "household size",
        "annual_income": "annual income",
        "preferred_doctors": "preferred doctors",
        "prescriptions": "prescriptions",
        "budget_range": "budget range",
        "coverage_type": "coverage type",
    }
    return labels.get(slot, slot.replace("_", " "))


def _insurance_prefill_from_personal_profile(context: dict[str, Any]) -> dict[str, str]:
    profile = _saved_personal_profile(context)
    if not profile:
        return {}
    prefill: dict[str, str] = {}
    zip_code = (profile.get("zipCode") or "").strip()
    if zip_code:
        prefill["zip_code"] = zip_code
    age = _age_from_date_of_birth(profile.get("dateOfBirth") or "")
    if age:
        prefill["age"] = age
    household_size = (profile.get("householdSize") or "").strip()
    if household_size:
        prefill["household_size"] = household_size
    annual_income = (profile.get("annualIncome") or "").strip()
    if annual_income:
        prefill["annual_income"] = annual_income
    preferred_doctors = (profile.get("preferredDoctors") or "").strip()
    if preferred_doctors:
        prefill["preferred_doctors"] = preferred_doctors
    prescriptions = (profile.get("prescriptions") or "").strip()
    if prescriptions:
        prefill["prescriptions"] = prescriptions
    budget_range = (profile.get("budgetRange") or "").strip()
    if budget_range:
        prefill["budget_range"] = budget_range
    coverage_type = _normalize_coverage_type(profile.get("coverageType") or "")
    if coverage_type:
        prefill["coverage_type"] = coverage_type
    return prefill


def _insurance_prefill_prompt(prefill: dict[str, str]) -> str:
    lines = ["Can I use your saved Personal Information?", ""]
    for slot in INSURANCE_SLOT_ORDER:
        value = str(prefill.get(slot) or "").strip()
        if not value:
            continue
        lines.append(f"• {_insurance_slot_label(slot)}: {value}")
    lines.append("")
    lines.append("(yes/no)")
    return "\n".join(lines)


def _needs_insurance_details(context: dict[str, Any]) -> bool:
    if context.get("insurance_precall_required") is True:
        return True
    reason = str(context.get("call_reason") or "")
    details = str(context.get("call_details") or "")
    return _is_insurance_quote_intent(f"{reason}\n{details}")


def _normalize_coverage_type(value: str) -> str:
    v = (value or "").strip().lower()
    if not v:
        return ""
    if "bronze" in v:
        return "bronze"
    if "silver" in v:
        return "silver"
    if "gold" in v:
        return "gold"
    if "unsure" in v or "not sure" in v or "don't know" in v or "dont know" in v:
        return "unsure"
    return ""


def _next_insurance_slot(context: dict[str, Any]) -> str | None:
    profile = _insurance_profile(context)
    for slot in INSURANCE_SLOT_ORDER:
        if slot in INSURANCE_OPTIONAL_SLOTS:
            # Optional slots are considered complete once user answered anything, including skip.
            if slot in profile:
                continue
        val = str(profile.get(slot) or "").strip()
        if val:
            continue
        return slot
    return None


def _advance_insurance_collection(
    context: dict[str, Any],
    *,
    preface: str | None = None,
) -> tuple[ReturnFlowState, dict[str, Any], str, dict[str, Any] | None]:
    profile = _insurance_profile(context)
    slot = _next_insurance_slot(context)
    if not slot:
        context["insurance_call_profile"] = profile
        context["call_details"] = _format_insurance_details(context)
        summary = _build_return_summary(context)
        return (
            ReturnFlowState.AWAITING_CALL_CONFIRM,
            context,
            "Thanks — I have the insurance details. Please confirm:\n\n" + summary,
            None,
        )

    prefill_decided = bool(context.get("insurance_profile_prefill_decided"))
    if not prefill_decided:
        prefill = _insurance_prefill_from_personal_profile(context)
        if prefill:
            context["insurance_profile_prefill_candidate"] = prefill
            context["insurance_profile_prefill_decided"] = False
            prompt = _insurance_prefill_prompt(prefill)
            if preface:
                prompt = f"{preface}\n\n{prompt}"
            return (
                ReturnFlowState.AWAITING_PERSONAL_INFO_CONFIRM,
                context,
                prompt,
                None,
            )
        context["insurance_profile_prefill_decided"] = True

    prompt = INSURANCE_SLOT_PROMPTS.get(slot, f"Please provide {slot}.")
    if preface:
        prompt = f"{preface}\n\n{prompt}"
    return (
        ReturnFlowState.AWAITING_INSURANCE_DETAILS,
        context,
        prompt,
        None,
    )


def _format_insurance_details(context: dict[str, Any]) -> str:
    profile = _insurance_profile(context)
    if not profile:
        return ""
    ordered_labels = [
        ("zip_code", "ZIP"),
        ("age", "Age"),
        ("household_size", "Household size"),
        ("annual_income", "Annual income"),
        ("preferred_doctors", "Preferred doctors"),
        ("prescriptions", "Prescriptions"),
        ("budget_range", "Budget range"),
        ("coverage_type", "Coverage type"),
    ]
    lines = []
    for key, label in ordered_labels:
        value = str(profile.get(key) or "").strip()
        if value:
            lines.append(f"{label}: {value}")
    return "\n".join(lines)


def _is_general_business_quote(context: dict[str, Any]) -> bool:
    return context.get("flow_type") == FLOW_GENERAL_BUSINESS_QUOTE


def _is_general_call(context: dict[str, Any]) -> bool:
    return context.get("flow_type") == FLOW_GENERAL_CALL


def _build_return_call_purpose(context: dict[str, Any]) -> str:
    """Build purpose string for call backend (no pet info)."""
    if _is_general_call(context):
        # If this is a "tell them ..." style call, default wording should reflect delivery
        default = (
            DEFAULT_GENERAL_CALL_DELIVERY_REASON
            if _general_call_is_delivery(context.get("call_reason"))
            else DEFAULT_GENERAL_CALL_REASON
        )
    elif _is_general_business_quote(context):
        default = DEFAULT_GENERAL_BUSINESS_REASON
    else:
        default = DEFAULT_RETURN_REASON
    reason = (context.get("call_reason") or "").strip() or default
    reason = _strip_phone_numbers(reason) or default
    return reason[:PURPOSE_MAX_LENGTH]


def _build_return_summary(context: dict[str, Any]) -> str:
    """Summary for confirmation step (no pet, no clinics)."""
    purpose = _build_return_call_purpose(context)
    context["call_reason"] = purpose
    parts = [f"Purpose: {purpose}", ""]
    details = str(context.get("call_details") or "").strip()
    if details:
        # Keep simple sentence splitting so users can verify all captured asks before placing the call.
        raw_items = [x.strip(" -•\t") for x in re.split(r"[.?!]\s+|\n+", details) if x.strip()]
        if raw_items:
            parts.append("Talking points:")
            for item in raw_items:
                parts.append(f"• {item}")
            parts.append("")
    if _needs_insurance_details(context):
        insurance_details = _format_insurance_details(context)
        if insurance_details:
            parts.append("Insurance pre-call profile:")
            for ln in insurance_details.splitlines():
                parts.append(f"• {ln}")
            parts.append("")
    selected = context.get("selected_clinics") or []
    if isinstance(selected, list) and selected:
        parts.append(f"Selected places ({len(selected)}):")
        for idx, item in enumerate(selected, 1):
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or f"Place {idx}").strip()
            phone = str(item.get("phone") or "").strip()
            address = str(item.get("address") or "").strip()
            line = f"{idx}. {name}"
            if phone:
                line += f" ({phone})"
            parts.append(line)
            if address:
                parts.append(f"   Address: {address}")
        parts.append("")
    elif context.get("phone"):
        parts.append(f"• I will call: {context['phone']}")
    return "\n".join(parts) + "\n\nShould I proceed with the call? (Yes/No)"


def _reason_is_set(context: dict[str, Any]) -> bool:
    """True if we have a non-default call reason (user specified what to ask)."""
    reason = (context.get("call_reason") or "").strip()
    if not reason:
        return False
    reason = _strip_phone_numbers(reason)
    return reason and reason not in (
        DEFAULT_RETURN_REASON,
        DEFAULT_GENERAL_BUSINESS_REASON,
        DEFAULT_GENERAL_CALL_REASON,
        DEFAULT_GENERAL_CALL_DELIVERY_REASON,
    )


def _general_call_is_delivery(reason: Any) -> bool:
    """Heuristic: does the purpose look like delivering a message (vs asking a question)?"""
    if not isinstance(reason, str):
        return False
    r = reason.strip().lower()
    return bool(
        re.search(
            r"\b(tell|let\s+them\s+know|inform|share)\b",
            r,
        )
    )


def _general_call_vague_delivery(msg: str) -> bool:
    """Detect vague replies like 'just tell them' without the actual message."""
    m = (msg or "").strip().lower()
    if not m:
        return True
    # Very short "tell" intents without content are usually missing the message.
    if len(m) < 80 and re.search(r"\b(just\s+)?(tell|inform|let)\b", m):
        if "that" not in m and ":" not in m and "\"" not in m and "'" not in m and len(m.split()) <= 10:
            return True
    return False


def _extract_general_call_details(msg: str) -> str:
    """
    Preserve the user's full call objective/details (constraints + questions), while
    removing phone digits and generic call-command prefixes.
    """
    text = _strip_phone_numbers((msg or "").strip())
    # Ignore raw machine payload used by multi-select cards.
    text = _PARKING_QUEUE_PAYLOAD_RE.sub("", text).strip()
    if not text:
        return ""
    text = re.sub(
        r"^\s*(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:help\s+me\s+)?(?:call|dial|phone)\b(?:\s+(?:them|this\s+number|that\s+number))?(?:\s+and)?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip(" .,:;-\t")
    # "to ask ..." reads better without the leading "to ".
    text = re.sub(r"^\s*to\s+(?=ask\b)", "", text, flags=re.IGNORECASE).strip()
    return text[:CALL_DETAILS_MAX_LENGTH]


def _parse_parking_queue_payload(message: str) -> dict[str, Any] | None:
    msg = (message or "").strip()
    m = _PARKING_QUEUE_PAYLOAD_RE.match(msg)
    if not m:
        return None
    try:
        payload = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    places_raw = payload.get("places")
    if not isinstance(places_raw, list):
        return None
    places: list[dict[str, str]] = []
    for p in places_raw:
        if not isinstance(p, dict):
            continue
        phone = str(p.get("phone") or "").strip()
        if not phone:
            continue
        places.append(
            {
                "name": str(p.get("name") or "Place").strip() or "Place",
                "phone": phone,
                "address": str(p.get("address") or "").strip(),
            }
        )
    if not places:
        return None
    reason = str(payload.get("call_reason") or "").strip() or DEFAULT_GENERAL_CALL_REASON
    flow_tag = str(payload.get("flow_tag") or "").strip().lower()
    return {"places": places, "call_reason": reason, "flow_tag": flow_tag}


def _build_region_place_options(
    zip_code: str,
    *,
    flow_type: str | None,
    call_reason: str,
) -> tuple[str, list[dict[str, Any]] | None]:
    reason_low = (call_reason or "").lower()
    ui_options: list[dict[str, Any]] = []
    places: list[dict[str, Any]] = []
    try:
        if "parking" in reason_low:
            from app.services.places_search import search_parking_places

            places = search_parking_places(zip_code, limit=5) or []
            note = "Can ask monthly parking price and availability"
            effective_reason = (
                "Ask monthly parking availability, monthly price, and contract/deposit requirements"
            )
        elif "vet" in reason_low or "pet" in reason_low:
            from app.services.places_search import resolve_clinics_near_zip

            places = resolve_clinics_near_zip(zip_code) or []
            note = "Can ask vet appointment availability and pricing"
            effective_reason = "Ask about veterinary service pricing and appointment availability"
        else:
            from app.services.places_search import search_human_medical_near_zip

            places = search_human_medical_near_zip(zip_code) or []
            note = "Can ask walk-in / appointment availability"
            effective_reason = "Ask about appointment availability and earliest booking times"
    except Exception:
        places = []
        note = "Can ask appointment availability"
        effective_reason = call_reason or DEFAULT_GENERAL_CALL_REASON

    for i, p in enumerate(places[:5], 1):
        name = str(p.get("name") or "Place").strip() or "Place"
        phone = str(p.get("phone") or "").strip()
        if not phone:
            continue
        ui_options.append(
            {
                "type": "parking_place",
                "index": i,
                "name": name,
                "phone": phone,
                "address": str(p.get("address") or "").strip(),
                "rating": p.get("rating"),
                "open_now": p.get("open_now"),
                "location_query": zip_code,
                "note": note,
                "call_reason": effective_reason,
                "flow_tag": "insurance_search"
                if flow_type == FLOW_GENERAL_CALL and _is_insurance_quote_intent(call_reason)
                else "",
            }
        )

    if not ui_options:
        return (
            f"I couldn't find callable places near {zip_code}. Please share a full phone number (10 digits), "
            "or try a different ZIP/city.",
            None,
        )
    return (
        f"I found places near {zip_code}. Select one or more cards below, then tap Start to call.",
        ui_options,
    )


def transition(
    state: ReturnFlowState,
    message: str,
    context: dict[str, Any],
) -> tuple[ReturnFlowState, dict[str, Any], str, list[Any] | None]:
    """
    Transition for the return-service flow. Returns (new_state, context, reply_text, ui_options).
    context should have flow_type="return_service"; we use "phone" for the number (not hospital_phone).
    """
    msg = (message or "").strip()
    is_general = _is_general_business_quote(context)
    is_general_call = _is_general_call(context)

    if state == ReturnFlowState.AWAITING_PHONE_OR_ZIP:
        if is_general_call:
            queue_payload = _parse_parking_queue_payload(msg)
            if queue_payload:
                selected_places = queue_payload["places"]
                first_phone = selected_places[0]["phone"]
                context["selected_clinics"] = selected_places
                context["hospital_phone"] = first_phone
                context["phone"] = first_phone
                context["call_reason"] = queue_payload["call_reason"]
                context["call_details"] = ""
                context["insurance_precall_required"] = queue_payload.get("flow_tag") == INSURANCE_FLOW_TAG
                if context.get("insurance_precall_required"):
                    return _advance_insurance_collection(
                        context,
                        preface="Before I call the insurance company, I need a few details.",
                    )
                summary = _build_return_summary(context)
                return (
                    ReturnFlowState.AWAITING_CALL_CONFIRM,
                    context,
                    "Thanks! I'll call the selected places. Please confirm:\n\n" + summary,
                    None,
                )
        phone_val = _normalize_phone(msg)
        if phone_val:
            context["phone"] = phone_val
            context["hospital_phone"] = phone_val
            reason = _extract_call_reason(msg)
            details = _extract_general_call_details(msg) if is_general_call else ""
            if reason:
                # Store extracted purpose/message (may already be prefixed like "Tell them: ...")
                context["call_reason"] = reason
            if details:
                context["call_details"] = details
            # general_business_quote or general_call: if we still don't have a specific reason, ask
            if is_general_call and not _reason_is_set(context):
                return (
                    ReturnFlowState.AWAITING_REASON,
                    context,
                    "Thanks, I have the number. What would you like me to ask them or what message should I deliver? (e.g. 'ask when they're available' or 'tell them we're going out tonight')",
                    None,
                )
            if is_general_call and _needs_insurance_details(context):
                context["insurance_precall_required"] = True
                return _advance_insurance_collection(
                    context,
                    preface="Before I call the insurance company, I need a few details.",
                )
            if is_general and not _reason_is_set(context):
                return (
                    ReturnFlowState.AWAITING_REASON,
                    context,
                    "Thanks, I have the number. What kind of service or what do you want to ask them? (e.g. price for plumbing, hours, availability)",
                    None,
                )
            summary = _build_return_summary(context)
            if is_general_call:
                confirm_intro = (
                    "Thanks! I'll call that number to deliver your message. Please confirm:\n\n"
                    if _general_call_is_delivery(context.get("call_reason"))
                    else "Thanks! I'll call that number to gather the information. Please confirm:\n\n"
                )
            elif is_general:
                confirm_intro = "Thanks! I'll call that number. Please confirm:\n\n"
            else:
                confirm_intro = "Thanks! I'll call that number for your return. Please confirm:\n\n"
            return (
                ReturnFlowState.AWAITING_CALL_CONFIRM,
                context,
                confirm_intro + summary,
                None,
            )
        zip_match = _ZIP_RE.search(msg)
        if zip_match:
            zip_code = zip_match.group(1)
            reason_for_search = (
                str(context.get("call_reason") or "").strip() or DEFAULT_GENERAL_CALL_REASON
            )
            reply, options = _build_region_place_options(
                zip_code,
                flow_type=context.get("flow_type"),
                call_reason=reason_for_search,
            )
            return (state, context, reply, options)
        # No phone: ask for it (general_business / general_call: also mention what to ask)
        if is_general_call:
            return (
                state,
                context,
                "What's the phone number (10 digits) or region (e.g. ZIP code), and what should I ask them or tell them? "
                "(e.g. 'ask their hours' or 'tell them we're going out tonight')",
                None,
            )
        if is_general:
            return (
                state,
                context,
                "What's the business phone number (10 digits) or region (e.g. ZIP code), and what do you want to ask? "
                "(e.g. price for a service, hours)",
                None,
            )
        return (
            state,
            context,
            "Please send the store's 10-digit phone number, or share a ZIP code and I can search nearby places to call.",
            None,
        )

    if state == ReturnFlowState.AWAITING_PERSONAL_INFO_CONFIRM:
        if _is_yes(msg):
            profile = _insurance_profile(context)
            candidate = context.get("insurance_profile_prefill_candidate")
            if isinstance(candidate, dict):
                for slot in INSURANCE_SLOT_ORDER:
                    value = str(candidate.get(slot) or "").strip()
                    if value:
                        profile[slot] = value
            context["insurance_call_profile"] = profile
            context["insurance_profile_prefill_decided"] = True
            context.pop("insurance_profile_prefill_candidate", None)
            return _advance_insurance_collection(context, preface="Great — I used your saved Personal Information.")
        if _is_no(msg):
            context["insurance_profile_prefill_decided"] = True
            context.pop("insurance_profile_prefill_candidate", None)
            return _advance_insurance_collection(context, preface="No problem — let's fill it manually.")
        return (
            state,
            context,
            "Please answer yes or no: can I use your saved Personal Information?",
            None,
        )

    if state == ReturnFlowState.AWAITING_INSURANCE_DETAILS:
        profile = _insurance_profile(context)
        slot = _next_insurance_slot(context)
        if not slot:
            return _advance_insurance_collection(context)
        raw = (msg or "").strip()
        if not raw:
            return (
                state,
                context,
                INSURANCE_SLOT_PROMPTS.get(slot, f"Please provide {slot}."),
                None,
            )
        if slot in INSURANCE_OPTIONAL_SLOTS and raw.lower() in ("skip", "none", "n/a", "na", "no"):
            profile[slot] = "skip"
        elif slot == "coverage_type":
            normalized = _normalize_coverage_type(raw)
            if not normalized:
                return (
                    state,
                    context,
                    "Please answer coverage type as bronze, silver, gold, or unsure.",
                    None,
                )
            profile[slot] = normalized
        else:
            profile[slot] = raw[:200]
        context["insurance_call_profile"] = profile
        return _advance_insurance_collection(context)

    if state == ReturnFlowState.AWAITING_REASON:
        # User provides what they want to ask / what to say.
        if is_general_call and _general_call_vague_delivery(msg):
            return (
                state,
                context,
                "Sure — what exact message should I deliver? You can paste it verbatim (e.g. \"We're going out tonight at 8.\").",
                None,
            )
        if msg:
            trimmed = msg.strip()[:PURPOSE_MAX_LENGTH]
            # If user writes "tell them ..." make the purpose explicit and consistent.
            if is_general_call and _general_call_is_delivery(trimmed) and not trimmed.lower().startswith("tell them:"):
                trimmed = f"Tell them: {trimmed}"
            context["call_reason"] = trimmed
            if is_general_call:
                details = _extract_general_call_details(msg)
                if details:
                    context["call_details"] = details
        summary = _build_return_summary(context)
        return (
            ReturnFlowState.AWAITING_CALL_CONFIRM,
            context,
            "Thanks! Please confirm:\n\n" + summary,
            None,
        )

    if state == ReturnFlowState.AWAITING_CALL_CONFIRM:
        if _is_yes(msg):
            phone = context.get("phone") or context.get("hospital_phone")
            if is_general_call:
                outro = " to gather that information. Thank you!"
            elif is_general:
                outro = ". Thank you!"
            else:
                outro = " for your return. Thank you!"
            purpose = _build_return_call_purpose(context)
            return (
                ReturnFlowState.CONFIRMED,
                context,
                f"Confirmed. I'll call {phone or 'them'}{outro}",
                None,
            )
        if _is_no(msg):
            return (
                ReturnFlowState.AWAITING_CALL_CONFIRM,
                context,
                "No problem. Your request is not placed. Send a new number if you'd like to try again.",
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
        "This return request is complete. Start a new conversation if you need another call.",
        None,
    )


def is_return_flow_state(state_value: str) -> bool:
    """True if state_value belongs to the return-service state machine."""
    return state_value.startswith(RETURN_STATE_PREFIX)
