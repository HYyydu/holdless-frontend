"""Outbound calls via the Realtime call backend (POST /api/calls), aligned with server/index.js placeCallViaBackend."""
from __future__ import annotations

import json
import os
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


def place_outbound_call(
    phone_e164: str,
    purpose_raw: str,
    *,
    bearer_token: str | None,
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

    stripped = _strip_phone_numbers((purpose_raw or "").strip())
    purpose = (stripped or "Customer inquiry")
    purpose = purpose_to_english_for_call_api(purpose) or purpose
    purpose = purpose[:PURPOSE_MAX_LENGTH]

    body = json.dumps(
        {
            "phone_number": phone_e164,
            "purpose": purpose,
            "name": "Holdless",
        }
    ).encode("utf-8")

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
