"""
Match assistant language to the user (e.g. Chinese in / Chinese out) while keeping
outbound call payloads in clear English for the voice API.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from app.services.openai_client import get_openai_client

logger = logging.getLogger(__name__)

_CJK_RE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]")
_LATIN_RE = re.compile(r"[A-Za-z]")


def text_has_cjk(text: str) -> bool:
    return bool(text and _CJK_RE.search(text))


def text_has_latin(text: str) -> bool:
    return bool(text and _LATIN_RE.search(text))


def update_reply_locale_from_message(context: dict[str, Any], message: str) -> dict[str, Any]:
    """Persist preferred UI language from the latest user turn.

    Rules:
    - Any CJK in the message -> zh
    - Any Latin letters (and no CJK) -> en
    - Digits/symbol-only text keeps previous locale
    """
    if not (message or "").strip():
        return context
    if text_has_cjk(message):
        return {**context, "reply_locale": "zh"}
    if text_has_latin(message):
        return {**context, "reply_locale": "en"}
    return context


def should_localize_to_chinese(context: dict[str, Any], message: str) -> bool:
    if text_has_cjk(message):
        return True
    return (context.get("reply_locale") or "") == "zh"


def localize_assistant_reply(reply: str, *, user_message: str) -> str:
    """Translate a deterministic English reply to natural Chinese when the session is zh."""
    if not (reply or "").strip():
        return reply
    client = get_openai_client()
    if not client:
        return reply
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Translate the assistant message to natural Simplified Chinese. "
                        "Keep E.164 phone numbers, digits, and Latin proper names unchanged. "
                        "Keep (Yes/No) or (yes/no) prompts understandable (you may use 是/否 or keep yes/no). "
                        "Preserve line breaks and bullet structure. Output only the translation, no preamble."
                    ),
                },
                {
                    "role": "user",
                    "content": f"User (tone reference):\n{user_message[:600]}\n\nAssistant reply:\n{reply}",
                },
            ],
            max_tokens=700,
            temperature=0.2,
        )
        choice = (response.choices or [None])[0]
        content = getattr(choice.message, "content", None) if choice else None
        if isinstance(content, str) and content.strip():
            return content.strip()
    except Exception as e:
        logger.warning("localize_assistant_reply failed: %s", e, exc_info=True)
    return reply


def purpose_to_english_for_call_api(purpose: str) -> str:
    """
    Ensure the string sent to POST /api/calls is English and suitable for a phone agent.
    Skips LLM when the text is already ASCII (typical English).
    """
    p = (purpose or "").strip()
    if not p:
        return p
    try:
        if p.isascii():
            return p
    except Exception:
        pass
    client = get_openai_client()
    if not client:
        return p
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Rewrite the user's call purpose as ONE concise English sentence (max 400 characters) "
                        "for a phone assistant who will conduct the call in English. "
                        "Include concrete details: service type, pet or product, questions to ask. "
                        "If the input is already clear English, return it trimmed; do not add filler. "
                        "Plain text only—no JSON, no quotes around the whole sentence."
                    ),
                },
                {"role": "user", "content": p[:800]},
            ],
            max_tokens=200,
            temperature=0.1,
        )
        choice = (response.choices or [None])[0]
        content = getattr(choice.message, "content", None) if choice else None
        if isinstance(content, str) and content.strip():
            return content.strip()[:500]
    except Exception as e:
        logger.warning("purpose_to_english_for_call_api failed: %s", e, exc_info=True)
    return p
