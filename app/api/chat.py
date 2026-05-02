"""POST /chat: deterministic state machine chat endpoint."""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.services.conversation_persistence import (
    consume_user_request_quota,
    create_conversation,
    ensure_user,
    get_user_request_quota,
    get_user_request_quota_remaining,
    update_conversation,
    append_messages,
    list_conversations,
    get_conversation_messages,
    delete_conversation,
)
from app.services.conversation_store import load, save, create_new
from app.services.chatgpt_fallback import Intent, reply_for_no_call_intent
from app.services.language_bridge import (
    localize_assistant_reply,
    should_localize_to_chinese,
    update_reply_locale_from_message,
)
from app.services.flow_router import (
    EXECUTION_CALL,
    EXECUTION_CHAT,
    EXECUTION_CLARIFY,
    EXECUTION_HYBRID,
    FLOW_GENERAL_BUSINESS_QUOTE,
    FLOW_GENERAL_CALL,
    FLOW_HOSPITAL_PET_QUOTE,
    FLOW_RETURN_SERVICE,
    flow_type_for_domain_capability,
    layer1_to_flow_type,
    route_flow,
)
from app.services.slot_engine import (
    STATUS_READY,
    clear_slot_state,
    process as slot_engine_process,
)
from app.core.slot_registry.registry import SlotRegistry
from app.services.return_service_machine import (
    ReturnFlowState,
    is_return_flow_state,
    transition as return_transition,
)
from app.services.state_machine import (
    ConversationState,
    _build_call_summary,
    _clip_attachment_metadata_from_message,
    is_positive_confirmation,
    transition as hospital_transition,
)
from app.services.state_machine import _is_yes, _normalize_phone
from app.services.call_placement import (
    build_call_backend_payload,
    call_backend_configured,
    place_outbound_call,
    resolve_bearer_token,
)
from app.services.task_service import create_task, update_task

router = APIRouter()

# Do not use bare \bphone\b — attachment summaries contain "billing phone:" and would falsely
# trigger direct-call before bill-dispute prefill. Allow "phone 945..." as imperative.
_DIRECT_CALL_VERB_RE = re.compile(
    r"\b(call|dial|ring)\b|"
    r"\bphone\s+[\d\(+]|"
    r"给.*打电话|拨打",
    re.IGNORECASE,
)
_PARKING_QUEUE_PAYLOAD_RE = re.compile(r"^\[\[PARKING_QUEUE\]\]\s*(\{.*\})\s*$", re.DOTALL)
_PLACE_SEARCH_RE = re.compile(
    # Explicit search verbs + place nouns
    r"(search|find|look\s*for|查|搜索|找|寻找).*(place|places|location|locations|店|地点|商家|医院|诊所|停车|车位|parking|clinic|hospital|vet|veterinar)"
    r"|"
    r"(place|places|location|locations|店|地点|商家|医院|诊所|停车|车位|parking|clinic|hospital|vet|veterinar).*(search|find|look\s*for|查|搜索|找|寻找)"
    r"|"
    # Nearby phrasing + supported categories (parking / vet)
    r"(nearby|near me|附近|周边|附近的|周围).*(parking|车位|停车|车场|garage|lot|clinic|hospital|vet|veterinar|宠物医院|宠物诊所|动物医院)"
    r"|"
    r"(parking|车位|停车|车场|garage|lot|clinic|hospital|vet|veterinar|宠物医院|宠物诊所|动物医院).*(nearby|near me|附近|周边|附近的|周围)",
    re.IGNORECASE,
)
_PARKING_HINT_RE = re.compile(r"(parking|车位|停车|车场|garage|lot)", re.IGNORECASE)
# Pet / veterinary (check before generic 医院 so 宠物医院 maps here).
_PET_VET_HINT_RE = re.compile(
    r"(vet|veterinar|veterinary|宠物|兽医|宠物医院|宠物诊所|动物医院|pet\s+hospital|animal\s+hospital)",
    re.IGNORECASE,
)
# Human hospital / ER / walk-in (includes Chinese 医院; English hospital when spelled in Latin).
_HUMAN_MEDICAL_HINT_RE = re.compile(
    r"(医院|急诊|诊所|urgent\s*care|emergency(\s+room)?|\bhospital\b|walk\s*-?\s*in|walkin)",
    re.IGNORECASE,
)
_HAS_LOCATION_HINT_RE = re.compile(
    # ZIP / ZIP+4 (avoid \b so numbers next to CJK chars like "...吗90024" still match)
    r"(?<!\d)\d{5}(?:-\d{4})?(?!\d)"
    r"|"
    r"\d+\s+[A-Za-z0-9][A-Za-z0-9\s\.\-]{2,}"  # rough street number + text
    r"|"
    r"(los angeles|new york|san francisco|beijing|shanghai|seattle|austin)"
    r"|"
    r"(地址|city|area|district|zip|zipcode|postal)",
    re.IGNORECASE,
)
_ZIP_RE = re.compile(r"(?<!\d)(\d{5}(?:-\d{4})?)(?!\d)")
_INSURANCE_SEARCH_RE = re.compile(
    r"(insurance|health\s*insurance|medical\s*insurance|医保|保险)"
    r".*(search|find|look\s*for|best|top|compare|推荐|搜索|找|对比)"
    r"|"
    r"(search|find|look\s*for|best|top|compare|推荐|搜索|找|对比)"
    r".*(insurance|health\s*insurance|medical\s*insurance|医保|保险)",
    re.IGNORECASE,
)
_BILL_DISPUTE_RE = re.compile(
    r"(dispute\s+(?:my\s+|this\s+|the\s+|a\s+)?bill|billing\s+issue|bill(?:ing)?\s+problem|账单|争议账单|账单纠纷)",
    re.IGNORECASE,
)
# Bill / balance goals without the word "dispute" (e.g. "try to minimize the cost" + bill image)
_BILL_COST_OR_NEGOTIATION_RE = re.compile(
    r"\b(?:minimi[sz]e|reduce|lowering?|lower)\s+(?:the\s+)?(?:cost|amount|charges?|balance|bill)\b|"
    r"\b(?:waive|negotiate|settle|discount|adjustment|pay\s+less|too\s+high|overcharged)\b|"
    r"\b(?:get\s+(?:a\s+)?(?:better|lower)\s+(?:rate|price)|work\s+out\s+(?:a\s+)?payment)\b",
    re.IGNORECASE,
)
_CAL_BOOKING_INTENT_RE = re.compile(
    r"(book\s+(a\s+)?care|schedule\s+an?\s+appointment|book\s+an?\s+appointment|预约|安排预约)",
    re.IGNORECASE,
)
_CAL_BOOKING_PAYLOAD_RE = re.compile(r"^\[\[CAL_BOOKING\]\]\s*(\{.*\})\s*$", re.DOTALL)


def _needs_location_for_nearby_search(message: str) -> bool:
    msg = (message or "").strip()
    if not msg:
        return False
    if not _PLACE_SEARCH_RE.search(msg):
        return False
    # Nearby search intent exists but no clear location anchor in the text.
    return _HAS_LOCATION_HINT_RE.search(msg) is None


def _location_clarify_reply() -> str:
    return (
        "I can search nearby parking, vet clinics, or hospitals / urgent care. "
        "Please tell me the city, area, or a specific address so I can search the right location."
    )


def _parse_parking_queue_payload(message: str) -> dict | None:
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
    places: list[dict] = []
    for p in places_raw:
        if not isinstance(p, dict):
            continue
        phone = str(p.get("phone") or "").strip()
        name = str(p.get("name") or "Parking").strip()
        if not phone:
            continue
        places.append(
            {
                "name": name or "Parking",
                "phone": phone,
                "address": str(p.get("address") or "").strip(),
            }
        )
    if not places:
        return None
    reason = str(payload.get("call_reason") or "").strip()
    if not reason:
        reason = (
            "Ask monthly parking availability, monthly price, and contract/deposit requirements"
        )
    flow_tag = str(payload.get("flow_tag") or "").strip().lower()
    return {"places": places, "call_reason": reason, "flow_tag": flow_tag}


def _extract_location_query(message: str) -> str | None:
    msg = (message or "").strip()
    if not msg:
        return None
    m = _ZIP_RE.search(msg)
    if m:
        return m.group(1)
    # Fallback: pass the full user text when we cannot isolate a clean location token.
    return msg


def _parking_search_reply(message: str) -> tuple[str, list[dict] | None] | None:
    location_query = _extract_location_query(message)
    if not location_query:
        return None
    try:
        from app.services.places_search import search_parking_places
        places = search_parking_places(location_query, limit=5)
    except Exception:
        return None
    if not places:
        return (
            f"I couldn't find parking results for {location_query} right now. "
            "Please share a nearby landmark or full address and I can try again.",
            None,
        )
    lines = [f"I found monthly parking options near {location_query}:"]
    lines.append("")
    ui_options: list[dict] = []
    for i, p in enumerate(places, 1):
        name = p.get("name") or "Parking"
        addr = p.get("address") or "Address not available"
        phone = p.get("phone") or "N/A"
        rating = p.get("rating")
        rating_text = str(rating) if rating is not None else "N/A"
        open_now = p.get("open_now")
        open_text = "24h/Open now" if open_now is True else "Closed/Unknown"
        lines.append(f"{i}. {name}")
        lines.append(f"   Phone: {phone}")
        lines.append(f"   Address: {addr}")
        lines.append(f"   Rating: {rating_text} | Hours: {open_text}")
        lines.append("   Note: Can ask about monthly availability")
        lines.append("")
        ui_options.append(
            {
                "type": "parking_place",
                "index": i,
                "name": name,
                "phone": phone if phone != "N/A" else "",
                "address": addr,
                "rating": rating,
                "open_now": open_now,
                "location_query": location_query,
            }
        )
    lines.append("Tap a card below and I can call to ask monthly availability and price.")
    return "\n".join(lines), ui_options


def _vet_search_reply(message: str) -> tuple[str, list[dict] | None] | None:
    zip_match = _ZIP_RE.search((message or "").strip())
    if not zip_match:
        return (
            "I can search nearby vet clinics, but I need a ZIP code first (for example, 90024).",
            None,
        )
    zip_code = zip_match.group(1)
    try:
        from app.services.places_search import resolve_clinics_near_zip
        clinics = resolve_clinics_near_zip(zip_code)
    except Exception:
        return None
    if not clinics:
        return (
            f"I couldn't find veterinary clinics near {zip_code} right now. "
            "Please share a nearby landmark or full address and I can try again.",
            None,
        )
    lines = [f"I found nearby veterinary clinics around {zip_code}:", ""]
    ui_options: list[dict] = []
    for i, c in enumerate(clinics[:5], 1):
        name = c.get("name") or "Veterinary clinic"
        phone = c.get("phone") or "N/A"
        address = c.get("address") or "Address not available"
        rating = c.get("rating")
        rating_text = str(rating) if rating is not None else "N/A"
        distance = c.get("distance")
        dist_text = f"{distance} mi" if distance is not None else "distance unavailable"
        lines.append(f"{i}. {name}")
        lines.append(f"   Phone: {phone}")
        lines.append(f"   Address: {address}")
        lines.append(f"   Rating: {rating_text} | Distance: {dist_text}")
        lines.append("")
        ui_options.append(
            {
                # Reuse existing selectable-card UI path in frontend.
                "type": "parking_place",
                "index": i,
                "name": name,
                "phone": phone if phone != "N/A" else "",
                "address": address,
                "rating": rating,
                "open_now": None,
                "location_query": zip_code,
                "note": "Can ask vet pricing and appointment availability",
                "call_reason": "Ask about veterinary service pricing and appointment availability",
            }
        )
    lines.append("If you want, I can call one of these clinics and ask for details.")
    return "\n".join(lines), ui_options


def _human_medical_search_reply(message: str) -> tuple[str, list[dict] | None] | None:
    zip_match = _ZIP_RE.search((message or "").strip())
    if not zip_match:
        return (
            "I can search hospitals and urgent care near you, but I need a ZIP code first "
            "(for example, 90024).",
            None,
        )
    zip_code = zip_match.group(1)
    try:
        from app.services.places_search import search_human_medical_near_zip

        places = search_human_medical_near_zip(zip_code)
    except Exception:
        return None
    if not places:
        return (
            f"I couldn't find hospitals or urgent care near {zip_code} right now. "
            "Try a nearby landmark or full address and I can search again.",
            None,
        )
    walk_in = bool(
        re.search(r"walk\s*-?\s*in|walkin|急诊", message or "", re.IGNORECASE)
    )
    call_reason = (
        "Ask whether walk-in visits are accepted, current wait or triage process, and what to bring"
        if walk_in
        else "Ask about services, phone registration, and walk-in or same-day appointment availability"
    )
    lines = [f"I found hospitals / urgent care options around {zip_code}:", ""]
    ui_options: list[dict] = []
    for i, c in enumerate(places[:5], 1):
        name = c.get("name") or "Hospital"
        phone = c.get("phone") or "N/A"
        address = c.get("address") or "Address not available"
        rating = c.get("rating")
        rating_text = str(rating) if rating is not None else "N/A"
        distance = c.get("distance")
        dist_text = f"{distance} mi" if distance is not None else "distance unavailable"
        lines.append(f"{i}. {name}")
        lines.append(f"   Phone: {phone}")
        lines.append(f"   Address: {address}")
        lines.append(f"   Rating: {rating_text} | Distance: {dist_text}")
        lines.append("")
        ui_options.append(
            {
                "type": "parking_place",
                "index": i,
                "name": name,
                "phone": phone if phone != "N/A" else "",
                "address": address,
                "rating": rating,
                "open_now": None,
                "location_query": zip_code,
                "note": "Can ask walk-in / ER intake and wait times",
                "call_reason": call_reason,
            }
        )
    lines.append("Tap a card below if you want me to call and ask about walk-in or availability.")
    return "\n".join(lines), ui_options


def _place_search_reply(message: str) -> tuple[str, list[dict] | None] | None:
    msg = (message or "").strip()
    if not msg:
        return None
    # Category routing: parking → pet vet → human hospital/urgent care. Never default to parking.
    if _PARKING_HINT_RE.search(msg):
        return _parking_search_reply(msg)
    if _PET_VET_HINT_RE.search(msg):
        return _vet_search_reply(msg)
    if _HUMAN_MEDICAL_HINT_RE.search(msg):
        return _human_medical_search_reply(msg)
    return (
        "I can search nearby parking, veterinary clinics, or hospitals / urgent care. "
        "Say which you need and include an area or ZIP—for example: monthly parking near 90024, "
        "vet clinic near 90024, or hospital / walk-in near 90024.",
        None,
    )


def _insurance_search_reply(message: str) -> tuple[str, list[dict] | None] | None:
    msg = (message or "").strip()
    if not msg:
        return None
    try:
        from app.services.insurance_search import (
            search_health_insurance_companies,
            summarize_health_insurance_results,
        )

        companies = search_health_insurance_companies(msg, limit=5)
    except Exception:
        return None
    if not companies:
        return (
            "I couldn't find reliable insurance company phone results right now. "
            "Try adding a state/ZIP and I can search again (for example: best health insurance in CA 90024).",
            None,
        )
    reply_text = summarize_health_insurance_results(companies, location_hint=msg)
    ui_options: list[dict] = []
    for i, c in enumerate(companies, 1):
        ui_options.append(
            {
                # Reuse existing selectable-card flow in frontend.
                "type": "parking_place",
                "index": i,
                "name": c.get("name") or "Insurance company",
                "phone": c.get("phone") or "",
                "address": "",
                "rating": None,
                "open_now": None,
                "location_query": msg,
                "note": "Can ask about plan options, monthly premium, deductible, and network",
                "call_reason": "Ask about health insurance plan options, premium, deductible, network, and enrollment timing",
                "flow_tag": "insurance_search",
                "source_url": c.get("source_url"),
            }
        )
    return reply_text, ui_options


def _parse_cal_booking_payload(message: str) -> dict | None:
    msg = (message or "").strip()
    m = _CAL_BOOKING_PAYLOAD_RE.match(msg)
    if not m:
        return None
    try:
        payload = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    slot_start_at = str(payload.get("slot_start_at") or "").strip()
    timezone = str(payload.get("timezone") or "").strip()
    if not slot_start_at or not timezone:
        return None
    booking_url = str(payload.get("booking_url") or "").strip()
    return {
        "slot_start_at": slot_start_at,
        "timezone": timezone,
        "booking_url": booking_url,
    }


_TIMEZONE_ALIAS_MAP = {
    "pt": "America/Los_Angeles",
    "pst": "America/Los_Angeles",
    "pdt": "America/Los_Angeles",
    "mt": "America/Denver",
    "mst": "America/Denver",
    "mdt": "America/Denver",
    "ct": "America/Chicago",
    "cst": "America/Chicago",
    "cdt": "America/Chicago",
    "et": "America/New_York",
    "est": "America/New_York",
    "edt": "America/New_York",
    "utc": "UTC",
    "gmt": "UTC",
    "tokyo": "Asia/Tokyo",
    "japan": "Asia/Tokyo",
    "beijing": "Asia/Shanghai",
    "shanghai": "Asia/Shanghai",
    "hong kong": "Asia/Hong_Kong",
    "singapore": "Asia/Singapore",
    "london": "Europe/London",
    "paris": "Europe/Paris",
    "berlin": "Europe/Berlin",
    "sydney": "Australia/Sydney",
}


def _resolve_timezones(message: str, personal_profile: dict | None) -> list[str]:
    msg = (message or "").strip()
    zones: list[str] = []
    iana_matches = re.findall(r"\b([A-Za-z]+/[A-Za-z_]+(?:/[A-Za-z_]+)?)\b", msg)
    for z in iana_matches:
        if z not in zones:
            zones.append(z)
    low_msg = msg.lower()
    for token, zone in _TIMEZONE_ALIAS_MAP.items():
        if token in low_msg and zone not in zones:
            zones.append(zone)
    if isinstance(personal_profile, dict):
        profile_tz = str(
            personal_profile.get("timeZone")
            or personal_profile.get("timezone")
            or ""
        ).strip()
        if profile_tz and profile_tz not in zones:
            zones.insert(0, profile_tz)
    if not zones:
        zones.append("UTC")
    return zones[:3]


def _cal_booking_reply(message: str, personal_profile: dict | None) -> tuple[str, list[dict] | None] | None:
    timezones = _resolve_timezones(message, personal_profile)
    try:
        from app.services.calcom import calcom_env_configured, list_slots_and_booking_url

        grouped: list[tuple[str, list[dict], str | None, str | None]] = []
        for tz in timezones:
            slots, booking_url, fetch_err = list_slots_and_booking_url(timezone=tz, limit=4)
            grouped.append((tz, slots, booking_url, fetch_err))
    except Exception:
        grouped = [(timezones[0], [], None, None)]
    all_slots = sum((len(slots) for _, slots, _, _ in grouped), 0)
    if all_slots == 0:
        timezone = timezones[0]
        booking_url = grouped[0][2]
        fetch_err = grouped[0][3]
        lines = [
            "I can help schedule this appointment.",
            f"I'll use timezone: {timezone}.",
            "Please pick a time directly in Cal.com:",
        ]
        if booking_url:
            lines.append(booking_url)
        elif not calcom_env_configured():
            lines.append(
                "Cal.com is not configured yet. Set CAL_COM_API_KEY and CAL_COM_EVENT_TYPE_ID in `.env` "
                "at the project root, then restart the Python backend so it reloads env (e.g. restart `npm run server`)."
            )
        else:
            detail = (fetch_err or "").strip()
            lines.append(
                "Could not load time slots from Cal.com. "
                "Confirm CAL_COM_EVENT_TYPE_ID is the numeric event type ID, API key is valid, "
                "and restart the backend after editing `.env`."
            )
            if detail:
                lines.append(f"Cal.com response: {detail[:240]}")
        return "\n".join(lines), None
    ui_options: list[dict] = []
    idx = 1
    primary_booking_url = grouped[0][2] or ""
    for timezone, slots, booking_url, _ in grouped:
        if booking_url and not primary_booking_url:
            primary_booking_url = booking_url
        for slot in slots:
            ui_options.append(
                {
                    "type": "cal_slot",
                    "index": idx,
                    "label": str(slot.get("label") or f"Option {idx}") + f" [{timezone}]",
                    "slot_start_at": str(slot.get("start_at") or ""),
                    "timezone": timezone,
                    "booking_url": booking_url or "",
                }
            )
            idx += 1
    lines = [
        f"I found appointment times in: {', '.join(timezones)}.",
        "Select one slot below and I will use it when placing the call.",
    ]
    if primary_booking_url:
        lines.append(f"If you prefer, you can also book directly here: {primary_booking_url}")
    lines.append("Tip: you can ask for multiple zones, e.g. 'show slots in America/New_York and Asia/Tokyo'.")
    return "\n".join(lines), ui_options


class ChatRequest(BaseModel):
    user_id: str
    message: str = ""
    conversation_id: str | None = None
    attachments: list[dict] | None = None
    personal_profile: dict | None = None


def _summarize_attachment_fields(fields: dict) -> str:
    if not isinstance(fields, dict):
        return ""
    parts: list[str] = []
    for key, label in (
        ("companyProviderName", "provider"),
        ("billAmount", "bill amount"),
        ("invoiceNumber", "invoice"),
        ("accountNumber", "account"),
        ("accountOrInvoiceNumber", "account/invoice"),
        ("billDueDate", "due date"),
        ("chargeOrServiceDate", "service date"),
        ("billingPhoneNumber", "billing phone"),
    ):
        value = str(fields.get(key) or "").strip()
        if not value:
            continue
        if key == "accountOrInvoiceNumber" and (
            str(fields.get("invoiceNumber") or "").strip()
            or str(fields.get("accountNumber") or "").strip()
        ):
            continue
        parts.append(f"{label}: {value}")
    return "; ".join(parts)


def _merge_extracted_bill_fields_from_attachments(attachments: list[dict] | None) -> dict[str, str]:
    merged: dict[str, str] = {}
    if not isinstance(attachments, list):
        return merged
    keys = (
        "companyProviderName",
        "billAmount",
        "invoiceNumber",
        "accountNumber",
        "accountOrInvoiceNumber",
        "billDueDate",
        "chargeOrServiceDate",
        "billingPhoneNumber",
    )
    for item in attachments:
        if not isinstance(item, dict):
            continue
        ex = item.get("extractedFields")
        if not isinstance(ex, dict):
            continue
        for k in keys:
            v = str(ex.get(k) or "").strip()
            if v and not merged.get(k):
                merged[k] = v
    return merged


def _bill_dispute_prefill_from_fields(
    fields: dict[str, str],
    user_message: str | None = None,
) -> tuple[str, str]:
    """Short call purpose (one aim) + structured talking points from OCR; no attachment filenames."""
    provider = str(fields.get("companyProviderName") or "").strip()
    if provider:
        purpose = f"Dispute the bill from {provider}"
    else:
        purpose = "Dispute this medical bill"
    lines: list[str] = []
    if provider:
        lines.append(f"Company/provider: {provider}")
    inv = str(fields.get("invoiceNumber") or "").strip()
    acct = str(fields.get("accountNumber") or "").strip()
    legacy = str(fields.get("accountOrInvoiceNumber") or "").strip()
    if inv:
        lines.append(f"Invoice number: {inv}")
    if acct:
        lines.append(f"Account number: {acct}")
    if not inv and not acct and legacy:
        lines.append(f"Account/invoice: {legacy}")
    for label, key in (
        ("Bill amount", "billAmount"),
        ("Bill due date", "billDueDate"),
        ("Date of charge/service", "chargeOrServiceDate"),
    ):
        v = str(fields.get(key) or "").strip()
        if v:
            lines.append(f"{label}: {v}")

    um = _clip_attachment_metadata_from_message((user_message or "").strip())
    if um:
        low = um.lower()
        if re.search(
            r"\b(minimi[sz]e|reduce|lowering?|lower)\s+(the\s+)?(cost|amount|charges?|balance)\b",
            low,
        ) or re.search(r"\b(waive|negotiate|settle|discount|adjustment)\b", low):
            purpose = f"{purpose} and try to minimize the cost"
        lines.append(f"Caller request: {um}")

    details = "\n".join(lines) if lines else ""
    return purpose, details


def _build_attachment_context(attachments: list[dict] | None) -> tuple[str, str | None]:
    if not isinstance(attachments, list) or not attachments:
        return "", None
    lines = ["Uploaded attachments:"]
    billing_phone = None
    for idx, item in enumerate(attachments, 1):
        if not isinstance(item, dict):
            continue
        file_name = str(item.get("fileName") or item.get("file_name") or f"file-{idx}").strip()
        content_type = str(item.get("contentType") or item.get("content_type") or "").strip()
        extracted = item.get("extractedFields")
        if file_name:
            lines.append(f"- {file_name} ({content_type or 'unknown type'})")
        field_summary = _summarize_attachment_fields(extracted if isinstance(extracted, dict) else {})
        if field_summary:
            lines.append(f"  extracted: {field_summary}")
        if billing_phone is None and isinstance(extracted, dict):
            candidate = str(extracted.get("billingPhoneNumber") or "").strip()
            if candidate:
                billing_phone = candidate
    return ("\n".join(lines) if len(lines) > 1 else ""), billing_phone


def _context_for_redis(context: dict) -> dict:
    """Strip any non-persisted keys from context before saving to Redis."""
    return {
        "flow_type": context.get("flow_type"),
        "slot_state": context.get("slot_state"),
        "slot_domain": context.get("slot_domain"),
        "slot_capability": context.get("slot_capability"),
        "pending_hybrid_offer": context.get("pending_hybrid_offer"),
        "zip": context.get("zip"),
        "address": context.get("address"),
        "location_query": context.get("location_query"),
        "hospital_phone": context.get("hospital_phone"),
        "phone": context.get("phone"),
        "call_reason": context.get("call_reason"),
        "call_details": context.get("call_details"),
        "pet_profile_id": context.get("pet_profile_id"),
        "pet_profile_name": context.get("pet_profile_name"),
        "pet_profile_candidates": context.get("pet_profile_candidates") or [],
        "name": context.get("name"),
        "breed": context.get("breed"),
        "age": context.get("age"),
        "weight": context.get("weight"),
        "availability": context.get("availability"),
        "clinic_candidates": context.get("clinic_candidates") or [],
        "selected_clinics": context.get("selected_clinics") or [],
        "insurance_precall_required": context.get("insurance_precall_required"),
        "insurance_call_profile": context.get("insurance_call_profile") or {},
        "insurance_profile_prefill_candidate": context.get("insurance_profile_prefill_candidate") or {},
        "insurance_profile_prefill_decided": context.get("insurance_profile_prefill_decided"),
        "personal_profile": context.get("personal_profile") or {},
        "reply_locale": context.get("reply_locale"),
        "booking_timezone": context.get("booking_timezone"),
        "booking_start_at": context.get("booking_start_at"),
    }

def _resolve_profile_first_name(personal_profile: dict | None) -> str:
    if not isinstance(personal_profile, dict):
        return ""
    explicit = str(personal_profile.get("firstName") or "").strip()
    if explicit:
        return explicit
    full_name = str(personal_profile.get("name") or "").strip()
    if not full_name:
        return ""
    return full_name.split()[0]


def _show_clinic_selection(context: dict) -> tuple[dict, str, list]:
    """Fetch clinics for the area (context['zip']): Google Places when configured, else demo list."""
    from app.services.places_search import resolve_clinics_near_zip

    clinics = resolve_clinics_near_zip(context.get("zip"))
    new_ctx = {**context, "clinic_candidates": [dict(c) for c in clinics]}
    lines = ["Here are some clinics near you:"]
    for i, c in enumerate(clinics, 1):
        lines.append(f"  {i}. {c['name']} — rating {c['rating']}, {c['distance']} mi")
    lines.append("Reply with the numbers you want (e.g. 1,3,4). You can pick up to 4.")
    return new_ctx, "\n".join(lines), clinics


def _pet_quote_slots_ready_branch(
    updated_context: dict,
) -> tuple[dict, str, list | None, ConversationState]:
    """After pet price_quote slots complete: fake clinic list vs direct hospital phone."""
    if updated_context.get("hospital_phone"):
        ctx = clear_slot_state(updated_context)
        return (
            ctx,
            "Thanks! I'll use that hospital number. Do you want to use an existing profile? (yes/no)",
            None,
            ConversationState.AWAITING_PET_CONFIRM,
        )
    clinics_ctx, reply, options = _show_clinic_selection(updated_context)
    return clinics_ctx, reply, options, ConversationState.AWAITING_CLINIC_SELECTION


@router.post("/chat")
def post_chat(body: ChatRequest, request: Request) -> dict:
    """
    Input: { user_id: str, message: str, conversation_id?: str }
    Output: { reply_text, ui_options?, conversation_id, debug_state }
    """
    user_id = body.user_id
    message = body.message or ""
    raw_message = message
    attachment_context, extracted_billing_phone = _build_attachment_context(body.attachments)
    if attachment_context:
        message = f"{raw_message.strip()}\n\n{attachment_context}".strip()
    conversation_id = body.conversation_id if body.conversation_id else None
    personal_profile = body.personal_profile if isinstance(body.personal_profile, dict) else None

    ensure_user(user_id)

    conv = load(conversation_id) if conversation_id else None
    if not conv:
        conversation_id, conv = create_new(user_id)
        state = conv["state"]
        context = conv["context"].copy()
        try:
            create_conversation(
                conversation_id,
                user_id,
                state.value,
                persisted_context := _context_for_redis(context),
            )
        except Exception as e:
            raise HTTPException(
                status_code=503,
                detail=f"Failed to persist conversation: {e!s}",
            )
    else:
        state = conv["state"]
        context = conv["context"].copy()
        persisted_context = None

    if personal_profile:
        context["personal_profile"] = {
            k: v for k, v in personal_profile.items() if isinstance(v, (str, int, float, bool))
        }

    # Resolve current state string for branching.
    current_state_str = state.value if hasattr(state, "value") else state
    at_entry_no_flow = (
        current_state_str == ConversationState.AWAITING_ZIP.value
        and context.get("flow_type") is None
    )

    # Layer 1: 3-tier confidence (≥0.85 execute, 0.6–0.85 clarify, <0.6 chat fallback). Never default to call.
    in_flow = not at_entry_no_flow
    current_flow_type = context.get("flow_type") if in_flow else None

    # Deterministic hybrid: if we previously showed "Would you like me to call?" and user confirms,
    # start the slot engine directly without re-running Layer 1 (avoids Layer 1 re-classifying "yes" as chat).
    new_state, updated_context, reply_text, ui_options = None, None, None, None

    # Bill dispute / cost negotiation + billing phone from OCR — MUST run before direct-call:
    # attachment context includes the substring "billing phone:" which used to match \bphone\b
    # and skip prefill, yielding "What message should I deliver?".
    _bill_fast_path_intent = _BILL_DISPUTE_RE.search(raw_message or "") or _BILL_COST_OR_NEGOTIATION_RE.search(
        raw_message or ""
    )
    if (
        at_entry_no_flow
        and _bill_fast_path_intent
        and extracted_billing_phone
    ):
        context["flow_type"] = FLOW_GENERAL_CALL
        original_block = raw_message.strip()
        merged_bill = _merge_extracted_bill_fields_from_attachments(body.attachments)
        pre_reason, pre_details = _bill_dispute_prefill_from_fields(merged_bill, original_block)
        context["bill_dispute_prefill"] = {
            "call_reason": pre_reason,
            "call_details": pre_details,
        }
        combined_message = (
            f"Please call {extracted_billing_phone} and help me dispute this bill.\n\n"
            f"{original_block}"
        ).strip()
        new_state, updated_context, reply_text, ui_options = return_transition(
            ReturnFlowState.AWAITING_PHONE_OR_ZIP, combined_message, context
        )

    # Deterministic direct-call entry: if user clearly provides "call + phone number", bypass Layer 1.
    if (
        new_state is None
        and at_entry_no_flow
        and _normalize_phone(message)
        and _DIRECT_CALL_VERB_RE.search(message or "")
    ):
        context["flow_type"] = FLOW_GENERAL_CALL
        return_state = ReturnFlowState.AWAITING_PHONE_OR_ZIP
        new_state, updated_context, reply_text, ui_options = return_transition(
            return_state, message, context
        )

    if (
        new_state is None
        and at_entry_no_flow
        and context.get("pending_hybrid_offer")
        and is_positive_confirmation(message)
    ):
        offer = context["pending_hybrid_offer"]
        if isinstance(offer, dict):
            domain = offer.get("domain")
            capability = offer.get("capability")
            original_message = offer.get("original_message") or ""
            flow_type = flow_type_for_domain_capability(domain or "", capability or "")
            if flow_type and SlotRegistry.has_schema(domain or "", capability or ""):
                context["flow_type"] = flow_type
                context["slot_domain"] = domain
                context["slot_capability"] = capability
                context["slot_state"] = {"slots": {}, "status": "collecting"}
                context["pending_hybrid_offer"] = None
                # Pass original message + confirmation so slot engine can extract slots (e.g. "cat neuter service")
                combined_message = f"{original_message.strip()} {message.strip()}".strip() or message
                updated_context, reply_text, slot_status, ui_options, _ = slot_engine_process(
                    domain, capability, combined_message, context
                )
                new_state = ConversationState.SLOT_COLLECTING
                if slot_status == STATUS_READY:
                    if flow_type == FLOW_HOSPITAL_PET_QUOTE:
                        updated_context, reply_text, ui_options, new_state = (
                            _pet_quote_slots_ready_branch(updated_context)
                        )
                    else:
                        new_state = ReturnFlowState.AWAITING_CALL_CONFIRM
            elif flow_type in (FLOW_RETURN_SERVICE, FLOW_GENERAL_BUSINESS_QUOTE, FLOW_GENERAL_CALL):
                # Hybrid confirm for return/general_business/general_call: no slot schema, start return flow
                context["flow_type"] = flow_type
                context["pending_hybrid_offer"] = None
                return_state = ReturnFlowState.AWAITING_PHONE_OR_ZIP
                combined_message = f"{original_message.strip()} {message.strip()}".strip() or message
                new_state, updated_context, reply_text, ui_options = return_transition(
                    return_state, combined_message, context
                )

    if new_state is None and at_entry_no_flow:
        queue_payload = _parse_parking_queue_payload(message)
        if queue_payload:
            selected_places = queue_payload["places"]
            context["selected_clinics"] = selected_places
            context["hospital_phone"] = selected_places[0]["phone"]
            context["call_reason"] = queue_payload["call_reason"]
            context["flow_type"] = FLOW_GENERAL_CALL
            if queue_payload.get("flow_tag"):
                context["insurance_precall_required"] = (
                    queue_payload.get("flow_tag") == "insurance_search"
                )
            return_state = ReturnFlowState.AWAITING_PHONE_OR_ZIP
            new_state, updated_context, reply_text, ui_options = return_transition(
                return_state, message, context
            )

    if new_state is None and at_entry_no_flow and _PLACE_SEARCH_RE.search(message or ""):
        if _needs_location_for_nearby_search(message):
            new_state, updated_context, reply_text, ui_options = (
                state,
                context,
                _location_clarify_reply(),
                None,
            )
        else:
            searched = _place_search_reply(message)
            if searched:
                searched_reply, searched_options = searched
                new_state, updated_context, reply_text, ui_options = (
                    state,
                    context,
                    searched_reply,
                    searched_options,
                )

    if new_state is None and at_entry_no_flow and _INSURANCE_SEARCH_RE.search(message or ""):
        searched = _insurance_search_reply(message)
        if searched:
            searched_reply, searched_options = searched
            new_state, updated_context, reply_text, ui_options = (
                state,
                context,
                searched_reply,
                searched_options,
            )

    if new_state is None and at_entry_no_flow and _CAL_BOOKING_INTENT_RE.search(message or ""):
        cal_reply = _cal_booking_reply(message, personal_profile)
        if cal_reply:
            searched_reply, searched_options = cal_reply
            new_state, updated_context, reply_text, ui_options = (
                state,
                context,
                searched_reply,
                searched_options,
            )

    if new_state is None and at_entry_no_flow:
        cal_payload = _parse_cal_booking_payload(message)
        if cal_payload:
            slot_start_at = cal_payload["slot_start_at"]
            timezone = cal_payload["timezone"]
            booking_url = cal_payload.get("booking_url") or ""
            context["flow_type"] = FLOW_GENERAL_CALL
            context["booking_start_at"] = slot_start_at
            context["booking_timezone"] = timezone
            context["availability"] = f"{slot_start_at} ({timezone})"
            context["call_reason"] = f"Book an appointment at {slot_start_at} ({timezone})"
            context["call_details"] = (
                f"Booking target slot: {slot_start_at}\n"
                f"Timezone: {timezone}\n"
                + (f"Cal.com booking page: {booking_url}" if booking_url else "")
            ).strip()
            return_state = ReturnFlowState.AWAITING_PHONE_OR_ZIP
            new_state, updated_context, reply_text, ui_options = return_transition(
                return_state, "I want to book this appointment slot", context
            )

    if new_state is None:
        route = route_flow(
            message,
            conversation_history=None,
            in_flow=in_flow,
            current_flow_type=current_flow_type,
        )

        def _chat_reply(intent_name: str) -> tuple:
            return (
                state,
                context,
                reply_for_no_call_intent(message, Intent(intent=intent_name)),
                None,
            )

        if at_entry_no_flow:
            # At entry: Layer 1 decides execution_mode + capability + domain; we apply confidence tiers.
            if route is None:
                # API failure: fallback to chat, safe clarification
                reply_text = reply_for_no_call_intent(message, Intent(intent="ROUTER_NO_CALL"))
                new_state, updated_context, reply_text, ui_options = state, context, reply_text, None
            elif route.is_low_confidence():
                # Tier C: never start call
                new_state, updated_context, reply_text, ui_options = _chat_reply("ROUTER_NO_CALL")
            elif route.is_medium_confidence():
                # Tier B: clarify before committing
                new_state, updated_context, reply_text, ui_options = _chat_reply("CLARIFY")
            else:
                # Tier A: high confidence — execute based on execution_mode
                # Multi-intent: ask clarification, do not start call (per design)
                flow_type = layer1_to_flow_type(route) if route.execution_mode == EXECUTION_CALL else None
                if route.multi_intent and flow_type is not None:
                    new_state, updated_context, reply_text, ui_options = _chat_reply("CLARIFY")
                elif flow_type is not None:
                    # call + supported (pet/retail) → slot engine if schema exists, else legacy state machine
                    context["flow_type"] = flow_type
                    if SlotRegistry.has_schema(route.domain, route.capability):
                        context["slot_domain"] = route.domain
                        context["slot_capability"] = route.capability
                        context["slot_state"] = {"slots": {}, "status": "collecting"}
                        updated_context, reply_text, slot_status, ui_options, _ = slot_engine_process(
                            route.domain, route.capability, message, context
                        )
                        new_state = ConversationState.SLOT_COLLECTING
                        if slot_status == STATUS_READY:
                            if flow_type == FLOW_HOSPITAL_PET_QUOTE:
                                updated_context, reply_text, ui_options, new_state = (
                                    _pet_quote_slots_ready_branch(updated_context)
                                )
                            else:
                                new_state = ReturnFlowState.AWAITING_CALL_CONFIRM
                    elif flow_type in (FLOW_RETURN_SERVICE, FLOW_GENERAL_BUSINESS_QUOTE, FLOW_GENERAL_CALL):
                        return_state = ReturnFlowState.AWAITING_PHONE_OR_ZIP
                        new_state, updated_context, reply_text, ui_options = return_transition(
                            return_state, message, context
                        )
                    else:
                        new_state, updated_context, reply_text, ui_options = hospital_transition(
                            state, message, context, user_id
                        )
                elif route.execution_mode == EXECUTION_HYBRID:
                    context["pending_hybrid_offer"] = {
                        "domain": route.domain,
                        "capability": route.capability,
                        "original_message": message,
                    }
                    new_state, updated_context, reply_text, ui_options = _chat_reply("HYBRID_OFFER")
                elif route.execution_mode == EXECUTION_CLARIFY or route.needs_clarification:
                    new_state, updated_context, reply_text, ui_options = _chat_reply("CLARIFY")
                elif route.execution_mode == EXECUTION_CALL and flow_type is None:
                    # User asked to call but domain unsupported (e.g. "call a clinic" → healthcare). Offer vet/returns.
                    new_state, updated_context, reply_text, ui_options = _chat_reply("CALL_OFFER_VET_OR_RETURNS")
                else:
                    # chat
                    new_state, updated_context, reply_text, ui_options = _chat_reply("ROUTER_NO_CALL")
        else:
            # Already in a flow: Layer 1 can signal continue, escape to chat, or switch flow.
            new_state, updated_context, reply_text, ui_options = None, None, None, None
            if route is None:
                # Router failed: continue in current flow (state machine handles message)
                pass
            elif route.is_high_confidence() and route.execution_mode == EXECUTION_CHAT:
                # Escape to no-call: stop flow, reset to entry, respond in chat
                new_state = ConversationState.AWAITING_ZIP
                updated_context = clear_slot_state({**context, "flow_type": None})
                reply_text = reply_for_no_call_intent(message, Intent(intent="ROUTER_NO_CALL"))
                ui_options = None
            elif route.is_high_confidence() and route.execution_mode == EXECUTION_CALL:
                switch_flow_type = layer1_to_flow_type(route)
                if switch_flow_type is not None and switch_flow_type != current_flow_type:
                    # Switch flow: terminate previous, start new
                    context["flow_type"] = switch_flow_type
                    if switch_flow_type in (FLOW_RETURN_SERVICE, FLOW_GENERAL_BUSINESS_QUOTE, FLOW_GENERAL_CALL):
                        return_state = ReturnFlowState.AWAITING_PHONE_OR_ZIP
                        new_state, updated_context, reply_text, ui_options = return_transition(
                            return_state, message, context
                        )
                    else:
                        new_state, updated_context, reply_text, ui_options = hospital_transition(
                            state, message, context, user_id
                        )
                # else: continue in current flow (new_state stays None)
            # else: medium/low confidence — continue in flow (new_state stays None)

            if new_state is None:
                if current_state_str == ConversationState.SLOT_AWAITING_PET_PROFILE.value:
                    # User said yes/no to "Do you want to use an existing profile?"
                    if _is_yes(message):
                        from app.services.pet_profile_service import list_pet_profiles_for_user
                        profiles = list_pet_profiles_for_user(user_id) if user_id else []
                        if profiles:
                            candidates = [{"id": str(p["id"]), "name": (p.get("name") or "Unnamed pet")} for p in profiles]
                            updated_context = {**context, "pet_profile_candidates": candidates}
                            lines = ["Here are your pet profiles:"]
                            for i, p in enumerate(candidates, 1):
                                lines.append(f"  {i}. {p['name']}")
                            lines.append("Reply with the number of the profile you want to use (e.g. 1).")
                            reply_text = "\n".join(lines)
                            new_state = ConversationState.SLOT_AWAITING_PET_SELECTION
                            ui_options = candidates
                        else:
                            updated_context = context
                            reply_text = "No saved profiles. What's your pet's name?"
                            new_state = ConversationState.SLOT_COLLECTING
                            ui_options = None
                    else:
                        updated_context = context
                        reply_text = "No problem. What's your pet's name?"
                        new_state = ConversationState.SLOT_COLLECTING
                        ui_options = None
                elif current_state_str == ConversationState.SLOT_AWAITING_PET_SELECTION.value:
                    # User picked profile number (1, 2, 3...)
                    candidates = context.get("pet_profile_candidates") or []
                    n = len(candidates)
                    raw = message.strip().replace(" ", "")
                    if n == 0 or not raw.isdigit():
                        updated_context = context
                        reply_text = f"Please reply with a number from 1 to {len(candidates) or 1} (e.g. 1)."
                        new_state = ConversationState.SLOT_AWAITING_PET_SELECTION
                        ui_options = candidates
                    else:
                        try:
                            idx = int(raw)
                        except ValueError:
                            idx = 0
                        if idx < 1 or idx > n:
                            updated_context = context
                            reply_text = f"Please reply with a number from 1 to {n} (e.g. 1)."
                            new_state = ConversationState.SLOT_AWAITING_PET_SELECTION
                            ui_options = candidates
                        else:
                            from app.services.pet_profile_service import get_pet_profile
                            chosen = candidates[idx - 1]
                            profile = get_pet_profile(chosen["id"])
                            updated_context = {**context, "pet_profile_id": chosen["id"], "pet_profile_name": chosen.get("name") or "your pet"}
                            slot_state = (updated_context.get("slot_state") or {}).copy()
                            slots = (slot_state.get("slots") or {}).copy()
                            if profile:
                                if profile.get("name"):
                                    slots["name"] = {"value": str(profile["name"]).strip(), "valid": True, "attempts": 1}
                                if profile.get("breed"):
                                    slots["breed"] = {"value": str(profile["breed"]).strip(), "valid": True, "attempts": 1}
                                age_val = profile.get("age") or profile.get("age_years")
                                if age_val is not None:
                                    slots["age"] = {"value": str(age_val), "valid": True, "attempts": 1}
                                if profile.get("weight"):
                                    slots["weight"] = {"value": str(profile["weight"]), "valid": True, "attempts": 1}
                                if profile.get("species") and profile["species"].lower() in ("dog", "cat"):
                                    slots["pet_type"] = {"value": profile["species"].lower(), "valid": True, "attempts": 1}
                            slot_state["slots"] = slots
                            updated_context["slot_state"] = slot_state
                            updated_context["pet_profile_candidates"] = []
                            domain = context.get("slot_domain") or "pet"
                            capability = context.get("slot_capability") or "price_quote"
                            updated_context, reply_text, slot_status, ui_options, _ = slot_engine_process(
                                domain, capability, "", updated_context
                            )
                            new_state = ConversationState.SLOT_COLLECTING
                            if slot_status == STATUS_READY:
                                updated_context, reply_text, ui_options, new_state = (
                                    _pet_quote_slots_ready_branch(updated_context)
                                )
                elif current_state_str == ConversationState.SLOT_COLLECTING.value:
                    domain = context.get("slot_domain") or "pet"
                    capability = context.get("slot_capability") or "price_quote"
                    updated_context, reply_text, slot_status, ui_options, next_slot_name = slot_engine_process(
                        domain, capability, message, context
                    )
                    new_state = ConversationState.SLOT_COLLECTING
                    if slot_status == STATUS_READY:
                        flow_type = context.get("flow_type")
                        if flow_type == FLOW_HOSPITAL_PET_QUOTE:
                            updated_context, reply_text, ui_options, new_state = (
                                _pet_quote_slots_ready_branch(updated_context)
                            )
                        else:
                            new_state = ReturnFlowState.AWAITING_CALL_CONFIRM
                    elif (
                        next_slot_name == "name"
                        and context.get("flow_type") == FLOW_HOSPITAL_PET_QUOTE
                        and user_id
                    ):
                        from app.services.pet_profile_service import list_pet_profiles_for_user
                        profiles = list_pet_profiles_for_user(user_id)
                        if profiles:
                            reply_text = "Thanks! Do you want to use an existing profile? (yes/no)"
                            new_state = ConversationState.SLOT_AWAITING_PET_PROFILE
                elif is_return_flow_state(current_state_str):
                    return_state = ReturnFlowState(current_state_str)
                    new_state, updated_context, reply_text, ui_options = return_transition(
                        return_state, message, context
                    )
                else:
                    hospital_state = state if isinstance(state, ConversationState) else ConversationState(current_state_str)
                    new_state, updated_context, reply_text, ui_options = hospital_transition(
                        hospital_state, message, context, user_id
                    )

    base_context = updated_context if updated_context is not None else context
    merged_context = update_reply_locale_from_message(dict(base_context), raw_message)
    if reply_text and should_localize_to_chinese(merged_context, raw_message):
        reply_text = localize_assistant_reply(reply_text, user_message=raw_message)
    persisted_context = _context_for_redis(merged_context)
    save(conversation_id, user_id, new_state, persisted_context)

    new_state_value = new_state.value if hasattr(new_state, "value") else new_state
    try:
        update_conversation(conversation_id, new_state_value, persisted_context)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to persist chat: {e!s}",
        )

    task_id = None
    placed_call_id: str | None = None
    placed_call_reason: str | None = None
    placed_domain: str | None = None
    queued_calls: list[dict[str, str]] = []
    call_reason_effective: str | None = None
    call_placement_hints = None
    call_trial_remaining_reported: int | None = None
    is_confirmed = new_state_value in (
        ConversationState.CONFIRMED.value,
        ReturnFlowState.CONFIRMED.value,
    )
    if is_confirmed:
        default_reason = (
            "Customer return/refund inquiry"
            if persisted_context.get("flow_type") == FLOW_RETURN_SERVICE
            else "Price or service inquiry"
            if persisted_context.get("flow_type") == FLOW_GENERAL_BUSINESS_QUOTE
            else "Information gathering"
            if persisted_context.get("flow_type") == FLOW_GENERAL_CALL
            else "Veterinary service inquiry"
        )
        call_reason_effective = persisted_context.get("call_reason") or default_reason
        call_additional_instructions = (
            str(persisted_context.get("call_details") or "").strip()[:2000]
        )
        payload = {
            "zip": persisted_context.get("zip"),
            "hospital_phone": persisted_context.get("hospital_phone"),
            "call_reason": persisted_context.get("call_reason"),
            "call_details": persisted_context.get("call_details"),
            "pet_profile_id": persisted_context.get("pet_profile_id"),
            "name": persisted_context.get("name"),
            "breed": persisted_context.get("breed"),
            "age": persisted_context.get("age"),
            "weight": persisted_context.get("weight"),
            "availability": persisted_context.get("availability"),
            "selected_clinics": persisted_context.get("selected_clinics"),
        }
        try:
            task = create_task(user_id, payload)
            task_id = task.get("id") if isinstance(task, dict) else None
        except Exception as e:
            raise HTTPException(
                status_code=503,
                detail=f"Conversation confirmed but task creation failed: {e!s}",
            )

        selected = persisted_context.get("selected_clinics") or []
        queue_targets: list[str] = []
        seen_phones: set[str] = set()
        if isinstance(selected, list):
            for c in selected:
                if not isinstance(c, dict):
                    continue
                p = str(c.get("phone") or "").strip()
                if p and p not in seen_phones:
                    seen_phones.add(p)
                    queue_targets.append(p)
        fallback_phone = (persisted_context.get("hospital_phone") or "").strip()
        if fallback_phone and fallback_phone not in seen_phones:
            queue_targets.append(fallback_phone)

        if task_id and queue_targets and call_backend_configured():
            if get_user_request_quota_remaining(user_id) < 1:
                reply_text = (
                    f"{reply_text}\n\n"
                    "You have no call requests left in your Holdless trial. "
                    "Increase your quota to place outbound calls."
                )
            else:
                auth = resolve_bearer_token(request.headers.get("authorization"))
                caller_first_name = _resolve_profile_first_name(
                    persisted_context.get("personal_profile")
                )
                call_placement_hints = {
                    k: v
                    for k, v in build_call_backend_payload(
                        queue_targets[0],
                        call_reason_effective,
                        additional_instructions=call_additional_instructions or None,
                        caller_name=caller_first_name or None,
                    ).items()
                    if k != "phone_number"
                }
                queued_call_ids: list[str] = []
                selected_by_phone: dict[str, dict] = {}
                if isinstance(selected, list):
                    for c in selected:
                        if not isinstance(c, dict):
                            continue
                        p = str(c.get("phone") or "").strip()
                        if p and p not in selected_by_phone:
                            selected_by_phone[p] = c
                for target_phone in queue_targets:
                    if get_user_request_quota_remaining(user_id) < 1:
                        break
                    placement = place_outbound_call(
                        target_phone,
                        call_reason_effective,
                        bearer_token=auth,
                        additional_instructions=call_additional_instructions or None,
                        caller_name=caller_first_name or None,
                    )
                    if placement.get("callId"):
                        call_id = str(placement["callId"])
                        queued_call_ids.append(call_id)
                        selected_item = selected_by_phone.get(target_phone) or {}
                        queued_calls.append(
                            {
                                "callId": call_id,
                                "phone": target_phone,
                                "name": str(selected_item.get("name") or "").strip()
                                or target_phone,
                            }
                        )
                        if not placed_call_id:
                            placed_call_id = call_id
                            placed_call_reason = placement.get("callReason") or call_reason_effective
                            placed_domain = placement.get("domain") or "unknown"
                        try:
                            consume_user_request_quota(user_id)
                        except ValueError as qe:
                            if str(qe) != "quota_exceeded":
                                raise
                            print(
                                "[Chat] consume quota after successful call: unexpectedly exhausted",
                                flush=True,
                            )
                        ft_ok = placement.get("free_trial_remaining")
                        if isinstance(ft_ok, (int, float)):
                            v = int(ft_ok)
                            call_trial_remaining_reported = (
                                v
                                if call_trial_remaining_reported is None
                                else min(call_trial_remaining_reported, v)
                            )
                    elif placement.get("error"):
                        print(
                            f"[Chat] placeCall failed for {target_phone}: {placement.get('error')}"
                        )
                        ft_err = placement.get("free_trial_remaining")
                        if isinstance(ft_err, (int, float)):
                            v = int(ft_err)
                            call_trial_remaining_reported = (
                                v
                                if call_trial_remaining_reported is None
                                else min(call_trial_remaining_reported, v)
                            )
                if placed_call_id:
                    try:
                        update_task(
                            task_id,
                            user_id,
                            payload={
                                "type": "call",
                                "callId": placed_call_id,
                                "queuedCallIds": queued_call_ids,
                                "callReason": placed_call_reason,
                                "title": placed_domain,
                                "description": placed_call_reason,
                                "vendor": "Phone Call",
                            },
                        )
                    except Exception as patch_err:
                        print(f"[Chat] Failed to update task with callId: {patch_err}")

    try:
        append_messages(conversation_id, raw_message, reply_text)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to persist chat messages: {e!s}",
        )

    request_quota_remaining = get_user_request_quota_remaining(user_id)
    result = {
        "reply_text": reply_text,
        "conversation_id": conversation_id,
        "debug_state": new_state_value,
        "request_quota_remaining": request_quota_remaining,
        # Keep this alias for existing UI hooks until renamed.
        "free_trial_remaining": request_quota_remaining,
    }
    if call_trial_remaining_reported is not None:
        result["call_trial_remaining"] = call_trial_remaining_reported
    if ui_options is not None:
        result["ui_options"] = ui_options
    if task_id is not None:
        result["task_id"] = task_id
        result["hospital_phone"] = persisted_context.get("hospital_phone")
        result["call_reason"] = call_reason_effective or (
            persisted_context.get("call_reason") or "Veterinary service inquiry"
        )
        if placed_call_id:
            result["callId"] = placed_call_id
            result["callReason"] = placed_call_reason
            result["domain"] = placed_domain
        if queued_calls:
            result["queued_calls"] = queued_calls
        if call_placement_hints is not None:
            result["call_placement_hints"] = call_placement_hints
    return result


@router.get("/conversations")
def get_conversations_list(user_id: str) -> dict:
    """List conversations for the given user_id. Query param: user_id."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    try:
        items = list_conversations(user_id)
        return {"conversations": items}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/users/{user_id}/request-quota")
def get_request_quota(user_id: str) -> dict:
    """Get request quota totals for a user."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    try:
        quota = get_user_request_quota(user_id)
        return {
            "user_id": user_id,
            "request_quota_total": quota["total"],
            "request_quota_used": quota["used"],
            "request_quota_remaining": quota["remaining"],
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/users/{user_id}/consume-request-quota")
def post_consume_request_quota(user_id: str) -> dict:
    """Consume one call-slot from the user's trial (server-to-server after a successful outbound call)."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    try:
        remaining = consume_user_request_quota(user_id)
        quota = get_user_request_quota(user_id)
        return {
            "user_id": user_id,
            "request_quota_remaining": remaining,
            "request_quota_total": quota["total"],
            "request_quota_used": quota["used"],
        }
    except ValueError as e:
        if str(e) == "quota_exceeded":
            rem = get_user_request_quota_remaining(user_id)
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Request quota exceeded. Please increase your quota.",
                    "code": "quota_exceeded",
                    "request_quota_remaining": rem,
                },
            )
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/conversations/{conversation_id}/messages")
def get_messages(conversation_id: str) -> dict:
    """Get all messages for a conversation."""
    try:
        messages = get_conversation_messages(conversation_id)
        return {"messages": messages}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.delete("/conversations/{conversation_id}")
def delete_conversation_route(
    conversation_id: str,
    user_id: str = Query(..., description="User ID (required for auth)"),
) -> dict:
    """Delete a conversation and its messages. Requires user_id query param."""
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    try:
        delete_conversation(conversation_id, user_id)
        return {"ok": True, "id": conversation_id}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
