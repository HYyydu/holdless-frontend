"""Outbound calls via the Realtime call backend (POST /api/calls), aligned with server/index.js placeCallViaBackend."""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from app.services.language_bridge import purpose_to_english_for_call_api
from app.services.state_machine import PURPOSE_MAX_LENGTH, _strip_phone_numbers


def call_backend_configured() -> bool:
    return bool((os.environ.get("CALL_BACKEND_URL") or "").strip())


def _allow_no_auth() -> bool:
    return (os.environ.get("CALL_BACKEND_ALLOW_NO_AUTH") or "").lower() == "true"


def _fallback_api_token() -> str:
    return (os.environ.get("CALL_API_TOKEN") or "").strip()


def resolve_bearer_token(authorization_header: str | None) -> str | None:
    if not authorization_header:
        return None
    h = authorization_header.strip()
    if h.lower().startswith("bearer "):
        t = h[7:].strip()
        return t or None
    return None


def _build_talking_points(details: str, *, fallback_purpose: str) -> list[str]:
    text = (details or "").strip() or (fallback_purpose or "").strip()
    if not text:
        return []
    chunks = re.split(r"[.?!]\s+|\n+|;\s+", text)
    points: list[str] = []
    seen: set[str] = set()
    for raw in chunks:
        item = _strip_phone_numbers(raw.strip(" -•\t"))
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        points.append(item[:180])
        if len(points) >= 8:
            break
    return points


def _to_first_person(text: str) -> str:
    """Convert common objective phrasing into first-person-singular wording."""
    t = (text or "").strip()
    if not t:
        return t
    low = t.lower()
    if "we're aiming" in low:
        return re.sub(r"\bwe're aiming\b", "I want", t, flags=re.IGNORECASE)
    if "we are aiming" in low:
        return re.sub(r"\bwe are aiming\b", "I want", t, flags=re.IGNORECASE)
    if low.startswith("try your best"):
        return "I want to minimize the cost as much as possible."
    return t


def _prioritize_talking_points(points: list[str]) -> list[str]:
    """Keep points useful for opening; avoid unsolicited detail dumping."""
    prioritized: list[str] = []
    for p in points:
        p = re.sub(
            r"^\s*i am confused because\s+",
            "I need clarification because ",
            p,
            flags=re.IGNORECASE,
        ).strip()
        low = p.lower()
        # Keep core identity + desired outcome + amount/account.
        if any(
            k in low
            for k in (
                "company/provider",
                "desired outcome",
                "bill amount",
                "account/invoice",
            )
        ):
            prioritized.append(p)
            continue
        # Keep date fields only as reference and not in the primary talking points.
        if "bill due date" in low or "date of charge/service" in low:
            continue
        prioritized.append(p)
    return prioritized[:6]


def _build_opening_line(purpose: str, caller_name: str | None = None) -> str:
    low = (purpose or "").strip()
    speaker = (caller_name or "").strip() or "Holdless"
    if not low:
        return f"Hi, this is {speaker} calling. I'm calling with a customer inquiry."
    text = _to_first_person(low).strip()
    low_text = text.lower()
    if low_text.startswith("ask whether "):
        rest = text[12:].strip()
        if rest:
            return f"Hi, this is {speaker} calling. I'm calling to ask whether {rest}."
    if low_text.startswith("ask about "):
        rest = text[10:].strip()
        if rest:
            return f"Hi, this is {speaker} calling. I'm calling about {rest}."
    if low_text.startswith("i am calling ") or low_text.startswith("i'm calling "):
        return f"Hi, this is {speaker} calling. {text}"
    first = text[0].lower() + text[1:] if len(text) > 1 else text.lower()
    return f"Hi, this is {speaker} calling. I'm calling about {first}."


def _is_vague_objective(text: str) -> bool:
    t = (text or "").strip(" .").lower()
    if not t:
        return True
    if len(t) <= 18 and t.startswith("for "):
        return True
    vague_phrases = {
        "explanation",
        "for explanation",
        "for an explanation",
        "inquiry",
        "question",
        "help",
        "customer inquiry",
    }
    return t in vague_phrases


def _derive_objective(purpose: str, talking_points: list[str]) -> str:
    """Use a concrete first-person objective when purpose is too vague."""
    base = _to_first_person(purpose).strip()
    if not _is_vague_objective(base):
        return base
    for point in talking_points or []:
        p = (point or "").strip(" -.\t")
        if not p:
            continue
        low = p.lower()
        if any(
            k in low
            for k in (
                "dispute",
                "adjustment",
                "explain",
                "explanation",
                "refund",
                "appeal",
                "billing",
            )
        ):
            return f"I am calling to {p[0].lower() + p[1:] if len(p) > 1 else p.lower()}."
    if talking_points:
        p = talking_points[0].strip(" -.\t")
        if p:
            return f"I am calling about {p[0].lower() + p[1:] if len(p) > 1 else p.lower()}."
    return "I am calling to dispute a billing adjustment and request an explanation."


def _build_agent_prompt(purpose: str, talking_points: list[str]) -> str:
    """Single explicit prompt forwarded to call backend for easier debugging."""
    points = talking_points or []
    objective = _to_first_person(purpose)
    lines = [
        "You are Holdless AI making an outbound call on behalf of the user.",
        "Speak as ONE person in first-person singular (use 'I', never 'we').",
        "Critical role: You are the caller/consumer seeking help from the business, never the business representative.",
        "Goal:",
        f"- {objective}",
        "",
        "Behavior requirements:",
        "- Start directly with the dispute objective in one concise sentence.",
        "- If they ask 'How can I help?', answer with your concrete request; do not ask them what they are looking for.",
        "- Never offer service to the callee (do not say things like 'I'd be happy to go over details', 'I'd love to assist you', 'How can I help you', or 'What would you like to know?').",
        "- Ask specific consumer-side questions (e.g., whether the insurance adjustment is a charge or a discount).",
        "- Verify the account/invoice and relevant bill details if needed.",
        "- Ask for actions aligned with the user's desired outcome.",
        "- Do NOT volunteer extra facts (like due date/service date) unless asked or needed.",
        "- Do NOT imply there is a misunderstanding or wrong number unless the representative explicitly says so.",
        "- Never ask meta questions like 'what specific information are you looking for today'.",
        "- Stay concise, professional, and negotiation-oriented.",
        "",
        "When they ask how they can help, a good response pattern is:",
        f"- 'I'm calling to clarify {objective[objective.lower().find('insurance adjustment'):] if 'insurance adjustment' in objective.lower() else objective}. Could you tell me whether it is an extra charge or an insurance discount?'",
    ]
    if points:
        lines.append("")
        lines.append("Talking points:")
        for p in points:
            lines.append(f"- {p}")
    return "\n".join(lines)[:1500]


def build_call_backend_payload(
    phone_e164: str,
    purpose_raw: str,
    *,
    additional_instructions: str | None = None,
    caller_name: str | None = None,
) -> dict[str, Any]:
    """
    Full JSON body for POST /api/calls (same fields Python and Node should send).
    """
    stripped = _strip_phone_numbers((purpose_raw or "").strip())
    purpose = (stripped or "Customer inquiry")
    purpose = _to_first_person(purpose)
    purpose = purpose_to_english_for_call_api(purpose) or purpose

    caller = (caller_name or "").strip() or "Holdless"
    extra = (additional_instructions or "").strip()
    trimmed_extra = extra[:500] if extra else ""
    guidance_text = trimmed_extra or purpose
    talking_points = _build_talking_points(
        guidance_text,
        fallback_purpose=purpose,
    )
    talking_points = _prioritize_talking_points(talking_points)
    objective = _derive_objective(purpose, talking_points)
    objective = objective[:PURPOSE_MAX_LENGTH]
    return {
        "phone_number": phone_e164,
        "purpose": objective,
        "name": caller,
        "additional_instructions": guidance_text[:500],
        "opening_line": _build_opening_line(objective, caller),
        "talking_points": talking_points,
        "agent_prompt": _build_agent_prompt(objective, talking_points),
        "call_brief": {
            "objective": objective,
            "talking_points": talking_points,
        },
    }


def place_outbound_call(
    phone_e164: str,
    purpose_raw: str,
    *,
    bearer_token: str | None,
    additional_instructions: str | None = None,
    caller_name: str | None = None,
) -> dict[str, Any]:
    """
    POST { phone_number, purpose, name } to CALL_BACKEND_URL/api/calls.
    On success: { callId, callReason, domain }.
    On failure: { error: str }.
    """
    base = (os.environ.get("CALL_BACKEND_URL") or "").strip().rstrip("/")
    if not base:
        return {"error": "CALL_BACKEND_URL not set"}

    req_token = (bearer_token or "").strip()
    env_token = _fallback_api_token()
    # Prefer CALL_API_TOKEN: app Bearer is often Supabase, not the call service's JWT.
    token = env_token or req_token
    debug_bearer = (os.environ.get("CALL_DEBUG_HARDCODE_BEARER") or "").strip()
    bearer_for_auth = debug_bearer or token
    if debug_bearer:
        print(
            "[Chat] CALL_DEBUG_HARDCODE_BEARER is set — using it instead of request/CALL_API_TOKEN; remove after debugging",
            flush=True,
        )
    if not bearer_for_auth and not _allow_no_auth():
        return {
            "error": "Call backend requires authentication (Bearer token or CALL_API_TOKEN).",
        }

    payload = build_call_backend_payload(
        phone_e164,
        purpose_raw,
        additional_instructions=additional_instructions,
        caller_name=caller_name,
    )
    print(
        "[Call] outbound payload prompt bundle:",
        json.dumps(
            {
                "phone_number": phone_e164,
                "purpose": payload.get("purpose"),
                "opening_line": payload.get("opening_line"),
                "talking_points": payload.get("talking_points"),
                "agent_prompt": payload.get("agent_prompt"),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    body = json.dumps(payload).encode("utf-8")

    url = f"{base}/api/calls"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if bearer_for_auth:
        req.add_header("Authorization", f"Bearer {bearer_for_auth}")

    timeout_s = float(os.environ.get("CALL_BACKEND_TIMEOUT_MS") or "15000") / 1000.0

    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
        try:
            err_data = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            err_data = {}
        msg = err_data.get("error") or err_data.get("message") or raw or f"HTTP {e.code}"
        return {"error": str(msg)}
    except Exception as e:
        return {"error": str(e)}

    call = data.get("call") if isinstance(data, dict) else {}
    cid = call.get("id") if isinstance(call, dict) else None
    if not cid:
        msg = data.get("message") if isinstance(data, dict) else None
        return {"error": str(msg or "Call backend did not return a call id.")}

    return {
        "callId": cid,
        "callReason": call.get("purpose") or purpose,
        "domain": "unknown",
    }
