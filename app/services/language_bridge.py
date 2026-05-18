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

# Short meta-messages ("speak Chinese", "用中文") should not reset an in-progress call flow.
_LANGUAGE_META_ZH_RE = re.compile(
    r"(说|讲|用|使用|請|请|改|切|换|換).{0,12}中文"
    r"|中文.{0,8}(吗|么|嘛|呀|呢|回|说|讲|写)"
    r"|(会|能|可以).{0,6}中文",
)
_LANGUAGE_META_EN_RE = re.compile(
    r"\b(speak|talk|write|reply|respond|answer|use|switch\s+to)\b.{0,18}\bchinese\b"
    r"|\bchinese\b.{0,10}\b(please|only|ok\??|thanks?)\b"
    r"|\bin\s+chinese\b"
    r"|\bmandarin\b.{0,8}\b(please|ok\??)?\b",
    re.IGNORECASE,
)
_LANGUAGE_META_MAX_LEN = 120
# Short yes/no/ok — keep session locale; do not treat as a full English prompt.
_SHORT_NEUTRAL_RE = re.compile(
    r"^(yes|no|yep|nope|ok|okay|sure|thanks?|thank\s+you|是|否|好|嗯|对|没问题)[.!?]*$",
    re.IGNORECASE,
)


def text_has_cjk(text: str) -> bool:
    return bool(text and _CJK_RE.search(text))


def text_has_latin(text: str) -> bool:
    return bool(text and _LATIN_RE.search(text))


def is_language_locale_meta_message(message: str) -> bool:
    """True when the turn is only asking to switch reply language (keep active call context)."""
    msg = (message or "").strip()
    if not msg or len(msg) > _LANGUAGE_META_MAX_LEN:
        return False
    if _LANGUAGE_META_ZH_RE.search(msg):
        return True
    if _LANGUAGE_META_EN_RE.search(msg):
        return True
    return False


def detect_message_locale(message: str, context: dict[str, Any] | None = None) -> str:
    """Locale for assistant replies: match the user's latest prompt when possible.

    - CJK in message -> zh
    - Latin letters only -> en
    - Neutral (yes/no, digits) -> prior reply_locale, else en
    """
    msg = (message or "").strip()
    if text_has_cjk(msg):
        return "zh"
    if text_has_latin(msg):
        if _SHORT_NEUTRAL_RE.match(msg):
            prior = (context or {}).get("reply_locale") or ""
            if prior in ("zh", "en"):
                return prior
        return "en"
    prior = (context or {}).get("reply_locale") or ""
    if prior in ("zh", "en"):
        return prior
    return "en"


def update_reply_locale_from_message(context: dict[str, Any], message: str) -> dict[str, Any]:
    """Persist preferred UI language from the latest user turn."""
    if not (message or "").strip():
        return context
    locale = detect_message_locale(message, context)
    if locale == (context.get("reply_locale") or ""):
        return context
    return {**context, "reply_locale": locale}


def should_localize_to_chinese(context: dict[str, Any], message: str) -> bool:
    return detect_message_locale(message, context) == "zh"


def should_localize_to_english(context: dict[str, Any], message: str) -> bool:
    return detect_message_locale(message, context) == "en"


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


def localize_assistant_reply_to_english(reply: str, *, user_message: str) -> str:
    """Translate an assistant reply to natural English when the user wrote in English."""
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
                        "Translate the assistant message to natural English. "
                        "Keep E.164 phone numbers, digits, and proper names unchanged. "
                        "Keep (Yes/No) or (yes/no) prompts understandable. "
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
        logger.warning("localize_assistant_reply_to_english failed: %s", e, exc_info=True)
    return reply


def ensure_reply_matches_user_language(
    reply: str,
    *,
    user_message: str,
    context: dict[str, Any] | None = None,
) -> str:
    """Rule 1: assistant text matches the user's prompt language (current turn)."""
    if not (reply or "").strip():
        return reply
    locale = detect_message_locale(user_message, context)
    if locale == "zh":
        if not text_has_cjk(reply) and text_has_latin(reply):
            return localize_assistant_reply(reply, user_message=user_message)
    elif locale == "en":
        if text_has_cjk(reply):
            return localize_assistant_reply_to_english(reply, user_message=user_message)
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
