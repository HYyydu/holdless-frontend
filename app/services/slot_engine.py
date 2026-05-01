"""
Minimal slot engine: drives slot collection from (domain, capability) schema.
Used after Layer 1 when execution_mode=call and a schema exists.
Extract -> validate -> store -> next question or ready; exports to legacy context for confirm/task.
"""
from __future__ import annotations

import re
from typing import Any

from app.core.slot_registry.base_models import SlotDefinition, SlotValidationResult
from app.core.slot_registry.registry import SlotRegistry
from app.core.slot_registry.validators import validate_phone, validate_zip

# Reuse extraction from state machine where possible
from app.services.state_machine import (
    _extract_call_reason,
    _extract_zip_from_text,
    _looks_like_address,
    _normalize_phone,
    _normalize_zip,
)

STATUS_COLLECTING = "collecting"
STATUS_READY = "ready"

# Layer 1 may classify vet calls as price_quote or booking; both use the same pet schema.
_PET_SLOT_CAPABILITIES = frozenset({"price_quote", "booking"})
_INSURANCE_BILL_REQUIRED_SLOTS = (
    "company_provider_name",
    "bill_amount",
    "account_or_invoice_number",
    "bill_due_date",
    "charge_or_service_date",
)

SLOT_STATE_KEY = "slot_state"
SLOT_DOMAIN_KEY = "slot_domain"
SLOT_CAPABILITY_KEY = "slot_capability"


def _clean_charge_or_service_date(raw: Any) -> str:
    """Normalize noisy extracted date strings like '/service is April 28, 2024'."""
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    s = re.sub(r"^[\s/\\\-:]+", "", s)
    s = re.sub(
        r"^(?:date\s+of\s+)?(?:charge|service)\s*(?:date)?\s*(?:is|:)\s*",
        "",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(r"^/service\s+is\s+", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s).strip(" ,.;")
    return s[:40]


def _looks_like_non_outcome_noise(message: str) -> bool:
    """Detect boilerplate lines that should not fill desired_outcome."""
    m = (message or "").strip().lower()
    if not m:
        return True
    if "uploaded bill document" in m:
        return True
    if m in {
        "fix claim or billing issues",
        "fix claim and billing issues",
        "claim or billing issues",
    }:
        return True
    return False


def _slot_state_from_context(context: dict[str, Any]) -> dict[str, Any]:
    """Get or init slot_state in context."""
    state = context.get(SLOT_STATE_KEY)
    if isinstance(state, dict) and "slots" in state:
        return state
    return {"slots": {}, "status": STATUS_COLLECTING}


def _extract_slots_from_message(
    message: str,
    domain: str,
    capability: str,
    schema: list[SlotDefinition],
) -> dict[str, Any]:
    """Extract slot values from user message using regex and simple patterns. Returns { slot_name: value }."""
    msg = (message or "").strip()
    out: dict[str, Any] = {}

    # ZIP: from pure digits, from text (e.g. address "740 weyburn terrace, 90024"), or from geocode(address)
    zip_val = _normalize_zip(msg)
    if not zip_val:
        zip_val = _extract_zip_from_text(msg)
    if not zip_val and _looks_like_address(msg):
        try:
            from app.services.geocode import geocode_to_zip
            zip_val = geocode_to_zip(msg)
        except Exception:
            pass
    if zip_val:
        out["zip_code"] = zip_val

    # Phone
    phone_val = _normalize_phone(msg)
    if phone_val:
        out["phone"] = phone_val

    # Call reason (pet or retail)
    reason = _extract_call_reason(msg)
    if reason:
        out["call_reason"] = reason
    # Also accept freeform "for X" / "about X" at end
    if "call_reason" not in out and msg:
        for pat in [r"\bfor\s+(.+?)(?:\.|$)", r"\babout\s+(.+?)(?:\.|$)"]:
            m = re.search(pat, msg, re.IGNORECASE)
            if m:
                out["call_reason"] = m.group(1).strip()[:120]
                break

    # Pet: service_type (neutering, vaccination, etc.) — Chinese then English
    zh_service = [
        ("绝育", "neutering"),
        ("阉割", "neutering"),
        ("节育", "neutering"),
        ("疫苗", "vaccination"),
        ("打针", "vaccination"),
        ("体检", "checkup"),
        ("牙科", "dental"),
        ("手术", "surgery"),
    ]
    for kw, norm in zh_service:
        if kw in msg:
            out["service_type"] = norm
            break
    service_keywords = [
        ("neutering", "neutering"), ("neuter", "neutering"), ("spay", "neutering"),
        ("vaccination", "vaccination"), ("vaccine", "vaccination"),
        ("checkup", "checkup"), ("check-up", "checkup"), ("check up", "checkup"),
        ("dental", "dental"), ("surgery", "surgery"),
    ]
    low = msg.lower()
    if "service_type" not in out:
        for kw, norm in service_keywords:
            if kw in low:
                out["service_type"] = norm
                break

    # Pet: dog / cat / other (Chinese + English)
    if "pet_type" not in out:
        if ("狗" in msg or "犬" in msg) and "猫" not in msg:
            out["pet_type"] = "dog"
        elif "猫" in msg and "狗" not in msg and "犬" not in msg:
            out["pet_type"] = "cat"
        elif "dog" in low and "cat" not in low:
            out["pet_type"] = "dog"
        elif "cat" in low and "dog" not in low:
            out["pet_type"] = "cat"
        elif any(x in low for x in ("none of them", "neither", "other", "another animal", "rabbit", "bird", "hamster", "bunny")):
            out["pet_type"] = "other"

    # Pet: name (simple: "my dog X" or "pet name is X" or single word after "name is")
    name_match = re.search(r"(?:my\s+(?:dog|cat|pet)\s+is\s+|name\s+is\s+|pet(?:'s)?\s+name\s+is?\s+)([a-zA-Z]+)", msg, re.IGNORECASE)
    if name_match:
        out["name"] = name_match.group(1).strip()
    # Single word that could be a name (avoid numbers) — only if we don't later set breed to the same word
    if "name" not in out and re.match(r"^[A-Za-z]{2,20}$", msg.strip()):
        out["name"] = msg.strip()

    # Breed: "breed is X", or known breed names only (so "Buddy" isn't captured as breed)
    breed_after_is = re.search(r"\bbreed\s+is\s+([a-zA-Z\s]+?)(?=\s*$|,|\s+age|\s+weight|\.)", msg, re.IGNORECASE)
    if breed_after_is:
        out["breed"] = breed_after_is.group(1).strip()[:50]
    if "breed" not in out:
        known_breeds = r"golden\s+retriever|labrador|german\s+shepherd|beagle|poodle|siamese|persian|maine\s+coon|bulldog|chihuahua|mixed"
        breed_match = re.search(rf"\b({known_breeds})\b", msg, re.IGNORECASE)
        if breed_match:
            out["breed"] = breed_match.group(1).strip()[:50]
    if "skip" in low and "breed" not in out:
        out["breed"] = ""

    # If we set both name and breed to the same value (e.g. single word "Buddy" matched both), keep only name
    if out.get("name") and out.get("breed") and out["name"].strip().lower() == out["breed"].strip().lower():
        del out["breed"]

    # Age (number + "year" or "yo" so we don't treat plain ZIP as age)
    age_match = re.search(r"(?:age\s+is\s+)?(\d+)\s*(?:years?|y\.?o\.?)\b", msg, re.IGNORECASE)
    if age_match:
        out["age"] = age_match.group(1)
    if "skip" in low and "age" not in out:
        out["age"] = ""

    # Weight
    weight_match = re.search(r"(\d+)\s*(?:lbs?|pounds?)", msg, re.IGNORECASE)
    if weight_match:
        out["weight"] = weight_match.group(1)
    if "skip" in low and "weight" not in out:
        out["weight"] = ""

    # Insurance billing dispute fields.
    if domain == "insurance" and capability == "complaint":
        provider_match = re.search(
            r"(?:company|provider|insurer|insurance(?:\s+company)?)(?:\s+name)?\s*(?:is|:)\s*([^\n,.;]+)",
            msg,
            re.IGNORECASE,
        )
        if provider_match:
            out["company_provider_name"] = provider_match.group(1).strip()[:120]

        amount_match = re.search(
            r"(?:bill\s+amount|amount(?:\s+due)?|charge(?:\s+amount)?)\s*(?:is|:)?\s*(\$?\s?\d[\d,]*(?:\.\d{1,2})?)",
            msg,
            re.IGNORECASE,
        )
        if amount_match:
            out["bill_amount"] = amount_match.group(1).strip()

        account_match = re.search(
            r"(?:account(?:\s+number)?|invoice(?:\s+number)?|acct)\s*(?:number|no\.?|#)?\s*(?:is|:)?\s*([A-Za-z0-9\-]{4,})",
            msg,
            re.IGNORECASE,
        )
        if account_match:
            out["account_or_invoice_number"] = account_match.group(1).strip()[:80]

        due_match = re.search(
            r"(?:bill\s+due\s+date|due\s+date)\s*(?:is|:)?\s*([A-Za-z0-9,\-/ ]{4,40})",
            msg,
            re.IGNORECASE,
        )
        if due_match:
            out["bill_due_date"] = due_match.group(1).strip()[:40]

        service_match = re.search(
            r"(?:date\s+of\s+(?:charge|service)|charge\s+date|service\s+date)\s*(?:is|:)?\s*([A-Za-z0-9,\-/ ]{4,40})",
            msg,
            re.IGNORECASE,
        )
        if service_match:
            cleaned_service_date = _clean_charge_or_service_date(service_match.group(1))
            if cleaned_service_date:
                out["charge_or_service_date"] = cleaned_service_date

        outcome_match = re.search(
            r"(?:desired\s+outcome|outcome|resolution|goal|want)\s*(?:is|:)?\s*([^\n]{6,300})",
            msg,
            re.IGNORECASE,
        )
        if outcome_match:
            out["desired_outcome"] = outcome_match.group(1).strip()[:300]

        if re.search(r"\b(upload|uploaded|attach|attached|photo|image|pdf)\b", low) or ".pdf" in low:
            out["bill_upload"] = True

    return out


def _validate_and_merge(
    schema: list[SlotDefinition],
    extracted: dict[str, Any],
    current_slots: dict[str, dict],
) -> dict[str, dict]:
    """Validate extracted values and merge into slot state. current_slots is slot_state['slots']."""
    merged = dict(current_slots)
    for name, raw_value in extracted.items():
        if raw_value is None or (isinstance(raw_value, str) and not raw_value.strip()):
            continue
        defn = next((s for s in schema if s.name == name), None)
        if not defn:
            continue
        if defn.validator:
            result = defn.validator(raw_value)
            if result.valid:
                merged[name] = {
                    "value": result.normalized_value if result.normalized_value is not None else raw_value,
                    "valid": True,
                    "attempts": merged.get(name, {}).get("attempts", 0) + 1,
                }
            else:
                merged[name] = {
                    "value": raw_value,
                    "valid": False,
                    "attempts": merged.get(name, {}).get("attempts", 0) + 1,
                    "error": result.error_message,
                }
        else:
            merged[name] = {
                "value": raw_value,
                "valid": True,
                "attempts": merged.get(name, {}).get("attempts", 0) + 1,
            }
    return merged


def _missing_required(
    schema: list[SlotDefinition],
    slots: dict[str, dict],
    domain: str | None = None,
    capability: str | None = None,
) -> list[SlotDefinition]:
    """Return list of required slot definitions that are not filled and valid."""
    filled = {
        name for name, data in slots.items()
        if data.get("valid") and data.get("value") is not None
        and (not isinstance(data.get("value"), str) or data.get("value", "").strip())
    }
    missing = []
    for s in schema:
        if s.required and s.name not in filled:
            missing.append(s)
    # Pet price quote: ZIP search vs direct dial — either satisfies "where to target"
    if domain == "pet" and capability in _PET_SLOT_CAPABILITIES:
        phone_entry = slots.get("phone") or {}
        if phone_entry.get("valid") and phone_entry.get("value"):
            missing = [m for m in missing if m.name != "zip_code"]
    # Insurance bill dispute: bill upload can replace typing all bill fields.
    if domain == "insurance" and capability == "complaint":
        upload_entry = slots.get("bill_upload") or {}
        if upload_entry.get("valid") and upload_entry.get("value") is True:
            missing = [m for m in missing if m.name not in _INSURANCE_BILL_REQUIRED_SLOTS]
    return missing


def _next_question(
    schema: list[SlotDefinition],
    slots: dict[str, dict],
    domain: str | None = None,
    capability: str | None = None,
) -> tuple[SlotDefinition | None, str]:
    """Return (next slot to ask, prompt text)."""
    missing = _missing_required(schema, slots, domain, capability)
    if not missing:
        return None, ""
    slot = missing[0]
    return slot, slot.prompt or f"Please provide {slot.description}."


def _is_ready(
    schema: list[SlotDefinition],
    slots: dict[str, dict],
    domain: str | None = None,
    capability: str | None = None,
) -> bool:
    return len(_missing_required(schema, slots, domain, capability)) == 0


def _export_to_context(domain: str, capability: str, slots: dict[str, dict]) -> dict[str, Any]:
    """Map slot_state.slots to legacy context keys for confirm/task payload."""
    ctx: dict[str, Any] = {}
    get_val = lambda n: (slots.get(n) or {}).get("value")

    if domain == "pet" and capability in _PET_SLOT_CAPABILITIES:
        z = get_val("zip_code")
        if z:
            ctx["zip"] = z
        phone = get_val("phone")
        if phone:
            ctx["hospital_phone"] = phone
        # Prefer extracted purpose; else synthesize from species + service (not a generic "price inquiry").
        st_raw = get_val("service_type")
        pt_raw = (get_val("pet_type") or "").strip().lower()
        pet_label = "cat" if pt_raw == "cat" else "dog" if pt_raw == "dog" else "pet"
        synthesized = None
        if st_raw and not get_val("call_reason"):
            st = str(st_raw).strip().lower()
            if st == "neutering":
                synthesized = (
                    f"{pet_label} neuter/spay: pricing, availability, and scheduling"
                )
            else:
                synthesized = f"{pet_label} {st}: pricing, availability, and scheduling"
        ctx["call_reason"] = (
            get_val("call_reason") or synthesized or "Veterinary service inquiry"
        )
        ctx["name"] = get_val("name")
        ctx["breed"] = get_val("breed")
        ctx["age"] = get_val("age")
        ctx["weight"] = get_val("weight")
    elif domain == "retail" and capability == "complaint":
        phone = get_val("phone")
        ctx["phone"] = phone
        ctx["hospital_phone"] = phone
        ctx["call_reason"] = get_val("call_reason") or "Customer return/refund inquiry"
    elif domain == "insurance" and capability == "complaint":
        phone = get_val("phone")
        provider = get_val("company_provider_name")
        amount = get_val("bill_amount")
        account = get_val("account_or_invoice_number")
        due_date = get_val("bill_due_date")
        charge_date = get_val("charge_or_service_date")
        desired_outcome = get_val("desired_outcome")
        uploaded = bool(get_val("bill_upload"))

        reason = "Dispute a billing issue"
        if provider:
            reason = f"Dispute a billing issue with {provider}"
        if desired_outcome:
            reason = f"{reason} and request: {str(desired_outcome).strip()[:200]}"
        ctx["call_reason"] = reason
        if phone:
            ctx["phone"] = phone
            ctx["hospital_phone"] = phone

        detail_lines = []
        if provider:
            detail_lines.append(f"Company/provider: {provider}")
        if desired_outcome:
            detail_lines.append(f"Desired outcome: {desired_outcome}")
        if amount:
            detail_lines.append(f"Bill amount: {amount}")
        if account:
            detail_lines.append(f"Account/invoice number: {account}")
        if due_date:
            detail_lines.append(f"Bill due date: {due_date}")
        if charge_date:
            detail_lines.append(f"Date of charge/service: {charge_date}")
        if uploaded:
            detail_lines.append("Bill uploaded: photo/PDF provided by user")
        if detail_lines:
            ctx["call_details"] = "\n".join(detail_lines)
    return {k: v for k, v in ctx.items() if v is not None}


def process(
    domain: str,
    capability: str,
    message: str,
    context: dict[str, Any],
) -> tuple[dict[str, Any], str, str, list[Any] | None, str | None]:
    """
    Run one slot-engine step. Returns (updated_context, reply_text, status, ui_options, next_slot_name).
    status is STATUS_COLLECTING or STATUS_READY.
    next_slot_name is the slot we're about to ask for (e.g. "name") when status is collecting; None when ready.
    """
    schema = SlotRegistry.get_schema(domain, capability)
    if not schema:
        return context, "I don't have a form for that yet. Sorry.", STATUS_COLLECTING, None, None

    slot_state = _slot_state_from_context(context)
    current_slots = slot_state.get("slots") or {}

    current_next_slot, _ = _next_question(schema, current_slots, domain, capability)
    extracted = _extract_slots_from_message(message, domain, capability, schema)
    # Insurance dispute: when we're explicitly asking desired outcome, accept freeform user intent
    # unless the input is known boilerplate (quick-action/upload line).
    if (
        domain == "insurance"
        and capability == "complaint"
        and (current_next_slot is not None and current_next_slot.name == "desired_outcome")
        and "desired_outcome" not in extracted
    ):
        msg = (message or "").strip()
        if msg and not _looks_like_non_outcome_noise(msg):
            extracted["desired_outcome"] = msg[:300]
    merged_slots = _validate_and_merge(schema, extracted, current_slots)

    if _is_ready(schema, merged_slots, domain, capability):
        slot_state["slots"] = merged_slots
        slot_state["status"] = STATUS_READY
        updated = {**context, SLOT_STATE_KEY: slot_state}
        legacy = _export_to_context(domain, capability, merged_slots)
        for k, v in legacy.items():
            updated[k] = v
        # Build a short summary for the reply
        summary_parts = []
        for name, data in merged_slots.items():
            if data.get("valid") and data.get("value"):
                summary_parts.append(f"• {name}: {data['value']}")
        if domain == "retail" and capability == "complaint":
            from app.services.state_machine import _strip_phone_numbers
            raw_reason = merged_slots.get("call_reason", {}).get("value") or "Customer return/refund inquiry"
            purpose = _strip_phone_numbers(raw_reason)[:500]
            reply = f"I have everything I need.\n\nPurpose: {purpose}\n\n• phone: {merged_slots.get('phone', {}).get('value', '')}\n\nShould I proceed with the call? (Yes/No)"
        elif domain == "insurance" and capability == "complaint":
            phone = (merged_slots.get("phone") or {}).get("value") or ""
            provider = (merged_slots.get("company_provider_name") or {}).get("value") or ""
            amount = (merged_slots.get("bill_amount") or {}).get("value") or ""
            account = (merged_slots.get("account_or_invoice_number") or {}).get("value") or ""
            due_date = (merged_slots.get("bill_due_date") or {}).get("value") or ""
            charge_date = (merged_slots.get("charge_or_service_date") or {}).get("value") or ""
            desired_outcome = (merged_slots.get("desired_outcome") or {}).get("value") or ""
            uploaded = bool((merged_slots.get("bill_upload") or {}).get("value"))
            lines = ["I have your bill dispute details:", ""]
            if phone:
                lines.append(f"• Phone: {phone}")
            if provider:
                lines.append(f"• Company/provider name: {provider}")
            if desired_outcome:
                lines.append(f"• Desired outcome: {desired_outcome}")
            if amount:
                lines.append(f"• Bill amount: {amount}")
            if account:
                lines.append(f"• Account/invoice number: {account}")
            if due_date:
                lines.append(f"• Bill due date: {due_date}")
            if charge_date:
                lines.append(f"• Date of charge/service: {charge_date}")
            if uploaded:
                lines.append("• Bill upload: provided (photo/PDF)")
            lines.append("")
            lines.append("Should I proceed with the call? (Yes/No)")
            reply = "\n".join(lines)
        else:
            reply = "I have everything I need.\n\n" + "\n".join(summary_parts) + "\n\nShould I proceed with the call? (Yes/No)"
        return updated, reply, STATUS_READY, None, None

    # Still collecting: show error for last invalid if any, else ask next
    next_slot, prompt = _next_question(schema, merged_slots, domain, capability)
    slot_state["slots"] = merged_slots
    slot_state["status"] = STATUS_COLLECTING
    updated = {**context, SLOT_STATE_KEY: slot_state}
    next_slot_name = next_slot.name if next_slot else None

    # If user sent something but we have a validation error, show it
    errors = [d.get("error") for d in merged_slots.values() if d.get("error")]
    if errors:
        reply = errors[-1] or prompt
    elif next_slot:
        reply = prompt
    else:
        reply = "What else can you tell me?"
    return updated, reply, STATUS_COLLECTING, None, next_slot_name


def slot_state_ready(context: dict[str, Any]) -> bool:
    """True if context has slot_state with status ready."""
    state = context.get(SLOT_STATE_KEY)
    return isinstance(state, dict) and state.get("status") == STATUS_READY


def clear_slot_state(context: dict[str, Any]) -> dict[str, Any]:
    """Return context with slot_state, slot_domain/capability, and pending_hybrid_offer removed."""
    out = {
        k: v
        for k, v in context.items()
        if k not in (SLOT_STATE_KEY, SLOT_DOMAIN_KEY, SLOT_CAPABILITY_KEY, "pending_hybrid_offer")
    }
    return out
