"""
State machine for the "return service" and "general_business_quote" flows.

- return_service: get phone (and optional reason) → confirm → confirmed.
- general_business_quote: get phone, then "what kind of service?" if missing → confirm → confirmed.

States: AWAITING_PHONE_OR_ZIP → [AWAITING_REASON for general_business only] → AWAITING_CALL_CONFIRM → CONFIRMED.
"""
from __future__ import annotations

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


class ReturnFlowState(str, Enum):
    AWAITING_PHONE_OR_ZIP = "RETURN_AWAITING_PHONE_OR_ZIP"
    AWAITING_REASON = "RETURN_AWAITING_REASON"  # general_business_quote only: ask what kind of service
    AWAITING_CALL_CONFIRM = "RETURN_AWAITING_CALL_CONFIRM"
    CONFIRMED = "RETURN_CONFIRMED"


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
    parts = [f"Description: {purpose}", ""]
    if context.get("phone"):
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
        phone_val = _normalize_phone(msg)
        if phone_val:
            context["phone"] = phone_val
            context["hospital_phone"] = phone_val
            reason = _extract_call_reason(msg)
            if reason:
                # Store extracted purpose/message (may already be prefixed like "Tell them: ...")
                context["call_reason"] = reason
            # general_business_quote or general_call: if we still don't have a specific reason, ask
            if is_general_call and not _reason_is_set(context):
                return (
                    ReturnFlowState.AWAITING_REASON,
                    context,
                    "Thanks, I have the number. What would you like me to ask them or what message should I deliver? (e.g. 'ask when they're available' or 'tell them we're going out tonight')",
                    None,
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
        # No phone: ask for it (general_business / general_call: also mention what to ask)
        if is_general_call:
            return (
                state,
                context,
                "What's the phone number (10 digits) and what should I ask them or tell them? (e.g. 'ask their hours' or 'tell them we're going out tonight')",
                None,
            )
        if is_general:
            return (
                state,
                context,
                "What's the business phone number (10 digits) and what do you want to ask? (e.g. price for a service, hours)",
                None,
            )
        return (
            state,
            context,
            "Please send the store's 10-digit phone number (e.g. from your receipt or order).",
            None,
        )

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
