"""
Layer 1 — Intelligent Execution Router (V2).

Classifies each user message into:
- execution_mode: chat | call | hybrid | clarify
- capability: what the user wants to accomplish
- domain: type of business
- confidence tier (≥0.85 execute, 0.6–0.85 clarify, <0.6 chat fallback)

Layer 1 does NOT load slot schemas; it only decides what to do next.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# Execution modes
EXECUTION_CHAT = "chat"
EXECUTION_CALL = "call"
EXECUTION_HYBRID = "hybrid"
EXECUTION_CLARIFY = "clarify"

# Capabilities
CAPABILITY_PRICE_QUOTE = "price_quote"
CAPABILITY_BOOKING = "booking"
CAPABILITY_CANCELLATION = "cancellation"
CAPABILITY_STATUS_CHECK = "status_check"
CAPABILITY_COMPLAINT = "complaint"
CAPABILITY_INFORMATION_LOOKUP = "information_lookup"
CAPABILITY_UNKNOWN = "unknown"

# Domains
DOMAIN_PET = "pet"
DOMAIN_HEALTHCARE = "healthcare"
DOMAIN_DMV = "dmv"
DOMAIN_RETAIL = "retail"
DOMAIN_UTILITIES = "utilities"
DOMAIN_INSURANCE = "insurance"
DOMAIN_RESTAURANT = "restaurant"
DOMAIN_GOVERNMENT = "government"
DOMAIN_GENERAL_BUSINESS = "general_business"
DOMAIN_UNKNOWN = "unknown"

# Legacy flow_type mapping (for existing state machines)
# Layer 1 outputs capability + domain; we map to flow_type for backward compatibility
FLOW_NO_CALL = "no_call"
FLOW_RETURN_SERVICE = "return_service"
FLOW_HOSPITAL_PET_QUOTE = "hospital_pet_quote"
FLOW_GENERAL_BUSINESS_QUOTE = "general_business_quote"
FLOW_GENERAL_CALL = "general_call"  # call any number with a stated purpose (gather information)

_ROUTER_PROMPT = """You are the Layer 1 intent router for Holdless, an AI that can place phone calls for users OR answer via chat.

The user may write in any language (e.g. Chinese, Spanish). Classify intent from meaning, not from language.

Your job: decide WHAT to do next with this user message. Return ONLY valid JSON.

## 1) execution_mode (required)

- **chat** — User wants information, explanation, advice, or conversation. No call. Examples: "How much does neutering cost?", "What documents do I need for DMV?"
- **call** — User explicitly wants you to place a call NOW. Triggers: "Call…", "Can you call…", "Schedule an appointment", "Cancel my service", "Compare prices for me".
- **hybrid** — Research that can escalate to a call. Example: "How much does a dental cleaning cost near me?" → You can answer with average pricing AND offer to call. Use when the user asks for pricing/info that could lead to a call.
- **clarify** — Intent is ambiguous or incomplete. Example: "I need help with DMV." Not enough info to proceed.

Rule: Default to "chat" or "clarify" if uncertain. **Never** default to "call". Only choose call when the user **explicitly** requests action to contact someone on their behalf.

## 2) capability (required)

What the user wants to accomplish. One of:
price_quote | booking | cancellation | status_check | complaint | information_lookup | unknown

## 3) domain (required)

Type of business. One of:
pet | healthcare | dmv | retail | utilities | insurance | restaurant | government | general_business | unknown

## 4) confidence (required)

Number 0.0–1.0. How confident you are in this classification.
- Only use high confidence (≥0.85) for call when the user clearly asked to place a call.
- For ambiguous or short messages, use lower confidence so the system can ask to clarify.

## 5) reasoning (required)

One short sentence explaining your choice.

## 6) needs_clarification (required)

true if you are unsure between capabilities/domains or intent is incomplete; false otherwise.

## 7) multi_intent (required)

true if the user expressed multiple or conditional intents (e.g. "call the vet and then book if under $300"); false otherwise.

## Examples

User: "How much does dog neutering cost?"
→ execution_mode: chat (or hybrid if you want to offer to call), capability: price_quote, domain: pet

User: "Call a vet near 90007 and compare prices."
→ execution_mode: call, capability: price_quote, domain: pet, confidence high

User: "I need help with DMV."
→ execution_mode: clarify, capability: unknown, domain: dmv, needs_clarification: true

User: "Actually never mind, just tell me the average price."
→ execution_mode: chat, capability: price_quote, domain: pet (escape from call flow)

User: "Call the store about returning strawberries."
→ execution_mode: call, capability: complaint, domain: retail

User: "Can you call a clinic and ask for the price?"
→ execution_mode: call, capability: price_quote, domain: pet (treat "clinic" as vet/pet clinic for price quotes)

User: "Can you help me call 9452644540 to ask when she is available to go out?"
→ execution_mode: call, capability: information_lookup, domain: unknown (user gave phone + purpose; goal is to gather information)

Output format (JSON only, no other text):
{"execution_mode": "chat"|"call"|"hybrid"|"clarify", "capability": "...", "domain": "...", "confidence": number, "reasoning": "...", "needs_clarification": true|false, "multi_intent": true|false}
"""


@dataclass(frozen=True)
class Layer1Route:
    """Layer 1 router output. No slot schemas; only what to do next."""

    execution_mode: str  # chat | call | hybrid | clarify
    capability: str
    domain: str
    confidence: float
    reasoning: str
    needs_clarification: bool
    multi_intent: bool

    def is_high_confidence(self) -> bool:
        return self.confidence >= 0.85

    def is_medium_confidence(self) -> bool:
        return 0.6 <= self.confidence < 0.85

    def is_low_confidence(self) -> bool:
        return self.confidence < 0.6


# Backward compatibility: map (capability, domain) → flow_type for existing state machines
def layer1_to_flow_type(route: Layer1Route) -> str | None:
    """
    Map Layer 1 capability + domain to legacy flow_type.
    Returns None for no_call (chat/clarify/hybrid that should not start slot collection yet).
    """
    if route.execution_mode != EXECUTION_CALL:
        return None
    # call + price_quote + pet → hospital_pet_quote
    if route.capability == CAPABILITY_PRICE_QUOTE and route.domain == DOMAIN_PET:
        return FLOW_HOSPITAL_PET_QUOTE
    # call + complaint / retail (return, refund) → return_service
    if route.domain == DOMAIN_RETAIL:
        return FLOW_RETURN_SERVICE
    # call + pet (e.g. booking, price_quote) → hospital_pet_quote
    if route.domain == DOMAIN_PET:
        return FLOW_HOSPITAL_PET_QUOTE
    # call + price_quote + general_business → collect phone + "what kind of service", then call
    if route.capability == CAPABILITY_PRICE_QUOTE and route.domain == DOMAIN_GENERAL_BUSINESS:
        return FLOW_GENERAL_BUSINESS_QUOTE
    # call + information_lookup → general call (phone + purpose to gather information)
    if route.capability == CAPABILITY_INFORMATION_LOOKUP:
        return FLOW_GENERAL_CALL
    # Unsupported (dmv, healthcare, etc.): no flow_type yet, treat as no_call
    return None


def flow_type_for_domain_capability(domain: str, capability: str) -> str | None:
    """
    Map (domain, capability) to legacy flow_type when starting a call flow
    (e.g. after user confirms a pending hybrid offer). Same logic as layer1_to_flow_type for call.
    """
    if domain == DOMAIN_PET:
        return FLOW_HOSPITAL_PET_QUOTE
    if domain == DOMAIN_RETAIL:
        return FLOW_RETURN_SERVICE
    if domain == DOMAIN_GENERAL_BUSINESS and capability == CAPABILITY_PRICE_QUOTE:
        return FLOW_GENERAL_BUSINESS_QUOTE
    if capability == CAPABILITY_INFORMATION_LOOKUP:
        return FLOW_GENERAL_CALL
    return None


def _get_client() -> Any:
    try:
        from openai import OpenAI
        key = os.environ.get("OPENAI_API_KEY", "").strip()
        if key:
            return OpenAI(api_key=key)
    except Exception:
        pass
    return None


_VALID_MODES = {EXECUTION_CHAT, EXECUTION_CALL, EXECUTION_HYBRID, EXECUTION_CLARIFY}
_VALID_CAPABILITIES = {
    CAPABILITY_PRICE_QUOTE,
    CAPABILITY_BOOKING,
    CAPABILITY_CANCELLATION,
    CAPABILITY_STATUS_CHECK,
    CAPABILITY_COMPLAINT,
    CAPABILITY_INFORMATION_LOOKUP,
    CAPABILITY_UNKNOWN,
}
_VALID_DOMAINS = {
    DOMAIN_PET,
    DOMAIN_HEALTHCARE,
    DOMAIN_DMV,
    DOMAIN_RETAIL,
    DOMAIN_UTILITIES,
    DOMAIN_INSURANCE,
    DOMAIN_RESTAURANT,
    DOMAIN_GOVERNMENT,
    DOMAIN_GENERAL_BUSINESS,
    DOMAIN_UNKNOWN,
}


def _parse_router_response(raw: str) -> Layer1Route | None:
    """Parse JSON response; return Layer1Route or None if malformed."""
    raw = raw.strip()
    if not raw:
        return None
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    mode = (parsed.get("execution_mode") or "").strip().lower()
    if mode not in _VALID_MODES:
        mode = EXECUTION_CLARIFY
    capability = (parsed.get("capability") or "").strip().lower().replace(" ", "_")
    if capability not in _VALID_CAPABILITIES:
        capability = CAPABILITY_UNKNOWN
    domain = (parsed.get("domain") or "").strip().lower()
    if domain not in _VALID_DOMAINS:
        domain = DOMAIN_UNKNOWN
    confidence = max(0.0, min(1.0, float(parsed.get("confidence", 0.5))))
    reasoning = str(parsed.get("reasoning", ""))[:300]
    needs_clarification = bool(parsed.get("needs_clarification", False))
    multi_intent = bool(parsed.get("multi_intent", False))
    return Layer1Route(
        execution_mode=mode,
        capability=capability,
        domain=domain,
        confidence=confidence,
        reasoning=reasoning,
        needs_clarification=needs_clarification,
        multi_intent=multi_intent,
    )


def route_flow(
    message: str,
    conversation_history: list[dict[str, str]] | None = None,
    in_flow: bool = False,
    current_flow_type: str | None = None,
) -> Layer1Route | None:
    """
    Layer 1 classification: what to do next with this user message.

    Returns Layer1Route or None on API failure / parse failure after retry.
    On None, caller should fallback to chat and safe clarification.

    - in_flow: True if already inside a slot-collection flow (so router can detect continue vs escape vs switch).
    - current_flow_type: Current flow_type when in_flow is True (return_service | hospital_pet_quote).
    """
    msg = (message or "").strip()
    if not msg:
        return None
    client = _get_client()
    if not client:
        logger.warning("Flow router: no OpenAI client (OPENAI_API_KEY not set).")
        return None

    user_content = msg
    if conversation_history:
        last_few = conversation_history[-4:]
        if last_few:
            history_str = "\n".join(
                f"{m.get('role', 'user')}: {m.get('content', '')}" for m in last_few
            )
            user_content = f"Recent context:\n{history_str}\n\nLatest user message:\n{msg}"
    if in_flow and current_flow_type:
        user_content += f"\n\n[System: User is currently in a flow: {current_flow_type}. Detect if they are continuing (e.g. providing a slot value), escaping to chat (e.g. 'never mind, just tell me'), or switching to a different flow.]"

    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _ROUTER_PROMPT},
                {"role": "user", "content": user_content},
            ],
            max_tokens=200,
            temperature=0.2,
        )
        choice = (completion.choices or [None])[0]
        if choice is None:
            raw = ""
        elif hasattr(choice, "message"):
            raw = getattr(choice.message, "content", None) or ""
        else:
            raw = (choice.get("message") or {}).get("content") or "" if isinstance(choice, dict) else ""
        route = _parse_router_response(raw)
        if route is not None:
            return route
        # Retry once on malformed JSON
        completion2 = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _ROUTER_PROMPT},
                {"role": "user", "content": user_content + "\n\n[Previous response was invalid JSON. Reply with ONLY the JSON object, no markdown.]"},
            ],
            max_tokens=200,
            temperature=0.1,
        )
        choice2 = (completion2.choices or [None])[0]
        if choice2 is None:
            raw2 = ""
        elif hasattr(choice2, "message"):
            raw2 = getattr(choice2.message, "content", None) or ""
        else:
            raw2 = (choice2.get("message") or {}).get("content") or "" if isinstance(choice2, dict) else ""
        route = _parse_router_response(raw2)
        if route is not None:
            return route
        logger.warning("Flow router: malformed JSON after retry; falling back to clarify.")
        return None
    except Exception as e:
        logger.warning("Flow router: API or parse error: %s", e, exc_info=True)
        return None
