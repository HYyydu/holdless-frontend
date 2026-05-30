"""Detect when a chat turn should use saved Medical Insurance profile for a coverage call."""
from __future__ import annotations

import re
from typing import Any

# Fields needed to place an insurance coverage call (image path is UI-only).
_MEDICAL_INSURANCE_CALL_KEYS = (
    "insuranceMemberName",
    "insuranceDateOfBirth",
    "insuranceMemberId",
    "insuranceCompanyName",
    "insurancePhoneNumber",
    "insuranceEmail",
    "insuranceAddress",
)

# User wants insurer to cover / pay / review a hospital or medical bill (not shop for plans).
_INSURANCE_COVERAGE_ASK_RE = re.compile(
    r"\b(?:cover(?:age)?|pay\s+for|reimburse|get\s+reimbursed)\b.{0,100}\b(?:bill|charge|invoice|hospital|medical)\b"
    r"|"
    r"\b(?:bill|hospital|medical\s+bill|invoice)\b.{0,100}\b(?:cover(?:age)?|insurance|insurer)\b"
    r"|"
    r"\b(?:ask|call|contact|reach)\b.{0,80}\b(?:my\s+)?(?:medical\s+)?insurance\b.{0,120}\b(?:cover|about|regarding|for|if)\b"
    r"|"
    r"\b(?:insurance\s+company|my\s+insurance|insurer|health\s+plan)\b.{0,100}\b(?:cover|pay\s+for|this\s+bill)\b"
    r"|"
    r"\b(?:check|verify|confirm)\b.{0,60}\b(?:coverage|eligible|eligibility)\b.{0,60}\b(?:bill|charge|hospital)\b",
    re.IGNORECASE,
)

_BILL_CONTEXT_RE = re.compile(
    r"\b(?:bill|billing|invoice|statement|charge|hospital|clinic|medical\s+center|urgent\s*care)\b|账单",
    re.IGNORECASE,
)

_INSURANCE_SHOPPING_RE = re.compile(
    r"\b(?:buy|purchase|quote|premium|affordable|compare|enroll|plan\s+options?|which\s+insurance)\b.{0,80}"
    r"\b(?:insurance|health\s+plan)\b"
    r"|"
    r"\b(?:search|find|look\s*for)\b.{0,60}\b(?:health\s*)?(?:medical\s*)?insurance\b",
    re.IGNORECASE,
)

_HOSPITAL_BILL_DISPUTE_RE = re.compile(
    r"\bdispute\b.{0,40}\b(?:bill|billing|charge)\b"
    r"|"
    r"\b(?:minimi[sz]e|reduce|lower|negotiate)\b.{0,40}\b(?:bill|cost|charge|balance)\b",
    re.IGNORECASE,
)


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def has_complete_medical_insurance_profile(profile: dict[str, Any] | None) -> bool:
    """True when chat/call can use saved Medical Insurance (member + institution phone)."""
    if not isinstance(profile, dict):
        return False
    return all(_safe_str(profile.get(key)) for key in _MEDICAL_INSURANCE_CALL_KEYS)


def _merge_bill_fields_from_attachments(attachments: list[dict] | None) -> dict[str, str]:
    merged: dict[str, str] = {}
    if not isinstance(attachments, list):
        return merged
    keys = (
        "documentType",
        "companyProviderName",
        "billAmount",
        "billDueDate",
        "chargeOrServiceDate",
        "invoiceNumber",
        "accountNumber",
    )
    for item in attachments:
        if not isinstance(item, dict):
            continue
        ex = item.get("extractedFields")
        if not isinstance(ex, dict):
            continue
        for k in keys:
            v = _safe_str(ex.get(k))
            if v and not merged.get(k):
                merged[k] = v
    return merged


def has_medical_bill_signal(
    message: str,
    attachments: list[dict] | None = None,
) -> bool:
    """True when the turn references a bill or attachments look like a medical bill."""
    if _BILL_CONTEXT_RE.search(message or ""):
        return True
    fields = _merge_bill_fields_from_attachments(attachments)
    if not fields:
        return False
    doc_type = _safe_str(fields.get("documentType")).lower()
    if doc_type == "medical_bill":
        return True
    return bool(
        fields.get("companyProviderName")
        or fields.get("billAmount")
        or fields.get("billDueDate")
        or fields.get("chargeOrServiceDate")
    )


def wants_insurance_coverage_for_bill(message: str) -> bool:
    text = (message or "").strip()
    if not text:
        return False
    if _INSURANCE_SHOPPING_RE.search(text):
        return False
    if _HOSPITAL_BILL_DISPUTE_RE.search(text) and not _INSURANCE_COVERAGE_ASK_RE.search(text):
        return False
    return bool(_INSURANCE_COVERAGE_ASK_RE.search(text))


def analyze_medical_insurance_coverage_use(
    message: str,
    *,
    attachments: list[dict] | None = None,
    personal_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Decide whether this turn should offer the saved Medical Insurance card for the call.

    Returns:
        use_profile: bool — show "Should we use that?" when profile is complete
        profile_complete: bool
        bill_fields: dict — OCR bill facts from attachments
        insurer_phone: str — institution phone from profile when complete
        insurer_name: str
        reason: str — short machine-readable tag when use_profile is false
    """
    profile = personal_profile if isinstance(personal_profile, dict) else {}
    profile_complete = has_complete_medical_insurance_profile(profile)
    bill_fields = _merge_bill_fields_from_attachments(attachments)
    coverage_ask = wants_insurance_coverage_for_bill(message)
    bill_signal = has_medical_bill_signal(message, attachments)

    use_profile = bool(
        profile_complete
        and coverage_ask
        and bill_signal
    )

    insurer_phone = _safe_str(profile.get("insurancePhoneNumber")) if profile_complete else ""
    insurer_name = _safe_str(profile.get("insuranceCompanyName")) if profile_complete else ""

    reason = "ok"
    if not coverage_ask:
        reason = "no_coverage_intent"
    elif not bill_signal:
        reason = "no_bill_signal"
    elif not profile_complete:
        reason = "incomplete_profile"

    return {
        "use_profile": use_profile,
        "profile_complete": profile_complete,
        "bill_fields": bill_fields,
        "insurer_phone": insurer_phone,
        "insurer_name": insurer_name,
        "coverage_ask": coverage_ask,
        "bill_signal": bill_signal,
        "reason": reason,
    }


def format_bill_information_lines(bill_fields: dict[str, str]) -> list[str]:
    lines: list[str] = []
    provider = _safe_str(bill_fields.get("companyProviderName"))
    if provider:
        lines.append(f"Institution: {provider}")
    bill_date = _safe_str(bill_fields.get("chargeOrServiceDate")) or _safe_str(
        bill_fields.get("billDueDate")
    )
    if bill_date:
        lines.append(f"Date: {bill_date}")
    amount = _safe_str(bill_fields.get("billAmount"))
    if amount:
        lines.append(f"Amount: {amount}")
    if not lines:
        lines.append("Institution: (not extracted from bill)")
    return lines


def format_medical_insurance_coverage_confirmation(context: dict[str, Any]) -> str:
    """User-facing confirmation before placing the insurance coverage call."""
    profile = context.get("personal_profile")
    if not isinstance(profile, dict):
        profile = {}
    insurer_name = _safe_str(profile.get("insuranceCompanyName")) or "Medical insurance"
    insurer_phone = _safe_str(context.get("phone") or profile.get("insurancePhoneNumber"))
    bill_fields = context.get("medical_coverage_bill_fields")
    if not isinstance(bill_fields, dict):
        bill_fields = {}

    purpose = _safe_str(context.get("call_reason"))
    if not purpose:
        provider = _safe_str(bill_fields.get("companyProviderName"))
        if provider:
            purpose = (
                f"Ask {insurer_name} whether they can cover a medical bill from {provider}"
            )
        else:
            purpose = f"Ask {insurer_name} whether they can cover a medical bill"

    talking_points: list[str] = []
    for item in format_bill_information_lines(bill_fields):
        talking_points.append(item)
    caller_request = _safe_str(context.get("medical_coverage_user_message"))
    if caller_request:
        talking_points.append(f"Caller request: {caller_request}")
    details = _safe_str(context.get("call_details"))
    if details and not talking_points:
        talking_points = [
            x.strip(" -•\t")
            for x in re.split(r"[.?!]\s+|\n+", details)
            if x.strip()
        ]

    member_name = _safe_str(profile.get("insuranceMemberName"))
    member_dob = _safe_str(profile.get("insuranceDateOfBirth"))
    member_id = _safe_str(profile.get("insuranceMemberId"))
    member_email = _safe_str(profile.get("insuranceEmail"))
    member_address = _safe_str(profile.get("insuranceAddress"))

    lines = [
        "**Confirmation**",
        "",
        "**Purpose**",
        purpose,
        "",
        "**Talking points**",
    ]
    if talking_points:
        for item in talking_points:
            lines.append(f"• {item}")
    else:
        lines.append("• (none captured)")
    lines.extend(
        [
            "",
            "**Personal information**",
        ]
    )
    if member_name:
        lines.append(f"• Name: {member_name}")
    if member_dob:
        lines.append(f"• Date of birth: {member_dob}")
    if member_id:
        lines.append(f"• Member ID: {member_id}")
    if member_email:
        lines.append(f"• Email: {member_email}")
    if member_address:
        lines.append(f"• Address: {member_address}")
    if not member_name and not member_dob and not member_id and not member_email and not member_address:
        lines.append("• (not available from profile)")
    lines.extend(
        [
            "",
            "**Medical**",
            f"**Call institution:** {insurer_phone or '—'} ({insurer_name})",
            "",
            "**Bill information**",
        ]
    )
    for item in format_bill_information_lines(bill_fields):
        lines.append(f"• {item}")
    lines.extend(["", "Should I proceed with the call? (Yes/No)"])
    return "\n".join(lines)


def apply_medical_insurance_profile_to_call_context(context: dict[str, Any]) -> dict[str, Any]:
    """After user confirms using the saved card, set phone, purpose, and member details."""
    profile = context.get("personal_profile")
    if not isinstance(profile, dict):
        return context

    phone = _safe_str(profile.get("insurancePhoneNumber"))
    from app.services.state_machine import _normalize_phone

    normalized = _normalize_phone(phone) if phone else None
    if normalized:
        context["phone"] = normalized
        context["hospital_phone"] = normalized

    insurer = _safe_str(profile.get("insuranceCompanyName")) or "the insurance company"
    bill_fields = context.get("medical_coverage_bill_fields")
    if not isinstance(bill_fields, dict):
        bill_fields = {}
    provider = _safe_str(bill_fields.get("companyProviderName"))
    if provider:
        context["call_reason"] = (
            f"Ask {insurer} whether they can cover a medical bill from {provider}"
        )
    else:
        context["call_reason"] = f"Ask {insurer} whether they can cover a medical bill"

    member_name = _safe_str(profile.get("insuranceMemberName"))
    member_id = _safe_str(profile.get("insuranceMemberId"))
    dob = _safe_str(profile.get("insuranceDateOfBirth"))
    insurance_email = _safe_str(profile.get("insuranceEmail"))
    insurance_address = _safe_str(profile.get("insuranceAddress"))

    detail_lines = format_bill_information_lines(bill_fields)
    um = _safe_str(context.get("medical_coverage_user_message"))
    if um:
        detail_lines.append(f"Caller request: {um}")
    if member_name:
        detail_lines.append(f"Member name: {member_name}")
    if member_id:
        detail_lines.append(f"Member ID: {member_id}")
    if dob:
        detail_lines.append(f"Date of birth: {dob}")
    if insurance_email:
        detail_lines.append(f"Email: {insurance_email}")
    if insurance_address:
        detail_lines.append(f"Address: {insurance_address}")
    context["call_details"] = "\n".join(detail_lines)

    # Member slots already on profile — skip re-asking when card was confirmed.
    context["insurance_member_precall_required"] = True
    context["insurance_precall_required"] = False
    context["insurance_precall_mode"] = "member"
    context["insurance_profile_prefill_decided"] = True
    context.pop("insurance_profile_prefill_candidate", None)
    call_profile: dict[str, str] = {}
    if member_name:
        call_profile["name"] = member_name
    if dob:
        call_profile["date_of_birth"] = dob
    if member_id:
        call_profile["member_id"] = member_id
    phone_personal = _safe_str(profile.get("phone"))
    if phone_personal:
        call_profile["phone"] = phone_personal
    if insurance_email:
        call_profile["email"] = insurance_email
    elif _safe_str(profile.get("email")):
        call_profile["email"] = _safe_str(profile.get("email"))
    if insurance_address:
        call_profile["address"] = insurance_address
    elif _safe_str(profile.get("address")):
        call_profile["address"] = _safe_str(profile.get("address"))
    context["insurance_call_profile"] = call_profile
    return context
