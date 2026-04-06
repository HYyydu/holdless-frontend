"""
ChatGPT fallback when the flow router (or caller) decides the user does not need a call.
Uses OpenAI API to generate a short, helpful reply instead of the state machine.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from app.services.openai_client import get_openai_client


@dataclass(frozen=True)
class Intent:
    """No-call intent label (e.g. ROUTER_NO_CALL) for choosing fallback reply text."""
    intent: str


logger = logging.getLogger(__name__)

# System prompt: model should answer the user's actual question. Holdless CAN place calls—never say we cannot.
_SYSTEM = """You are a helpful assistant for Holdless. Holdless CAN place phone calls for users: vet clinics for price quotes, businesses for returns/refunds, or any number with a purpose to gather information (e.g. ask when someone is available).
Answer what the user actually said. If they ask for a joke, tell a short joke. If they ask who built you, answer briefly. If they say hello, respond in a friendly way.
Never say you cannot make calls or that you are unable to call. If the user asked to place a call, say we can help (e.g. vet quotes, returns, or call a number to ask something) and briefly say what to do next. Keep it to one or two short sentences. Stay concise and helpful.
Always reply in the same language the user used (for example Simplified Chinese if they wrote in Chinese, English if they wrote in English)."""


def reply_for_no_call_intent(user_message: str, intent: Intent) -> str:
    """
    Call OpenAI to get a reply when the flow router (or caller) decided no-call.
    Returns a fallback string if the API is unavailable or fails (e.g. OPENAI_API_KEY not set).
    """
    client = get_openai_client()
    if not client:
        return _fallback_reply(intent)

    intent_desc = {
        "SIMPLE_CHAT": "Reply to what the user actually said. If they asked for a joke, tell a short joke. If they asked who built you / who made you, answer briefly (e.g. you're made by the Holdless team). If they said hello or how are you, respond in a friendly way. Answer their specific question or request; do not give a generic intro.",
        "GENERAL_HELP": "The user is asking for help with something that does not require placing a call (e.g. writing an email, drafting a letter). Help them with their request in a brief, friendly way. Do not ask for a ZIP code or phone number.",
        "AMBIGUOUS": "The user's request is ambiguous (e.g. 'I need help', 'what are my options'). Ask what they'd like to do: get information via chat, or place a phone call (e.g. for a return/refund or for a pet vet quote). Keep it brief and friendly.",
        "ROUTER_NO_CALL": "The user's message was classified as not requiring a phone call. They may want help writing (email, letter, homework, math), informational answers (e.g. pet care questions), or general assistance. Help them in a brief, friendly way. Do not offer to place a call or ask for a phone number or ZIP code.",
        "CALL_OFFER_VET_OR_RETURNS": "The user asked to place a call (e.g. call a number to ask something). Holdless CAN place calls. We support: (1) vet/pet clinics for price quotes, (2) businesses for returns/refunds, (3) any number with a purpose to gather information (e.g. ask when someone is available). Reply that you can help—e.g. call a vet for a quote, help with a return, or call a number to ask or find out something. Ask what they'd like (or if they already gave a number and purpose, say we can do that and they can confirm). One or two sentences. Never say we cannot make calls.",
        "CLARIFY": "The user's intent is unclear or incomplete (e.g. 'I need help with DMV', 'can you check something for me'). Ask a brief clarifying question: are they trying to check status, get pricing, schedule something, or something else? Do not start a call flow.",
        "HYBRID_OFFER": "The user asked an informational question that could lead to a call (e.g. pricing, how much something costs). Answer their question briefly, then offer: 'Would you like me to call [relevant businesses] to get exact quotes or details?' Keep it to one or two sentences for the answer plus one short offer.",
        "DO_NOT_CALL": "The user does not want to be called.",
        "ALREADY_CALLED": "The user says they were already called or the call already happened.",
        "SAVE_NUMBER": "The user wants to save a phone number (not place a call).",
        "TEXT_INSTEAD_OF_CALL": "The user prefers text/message instead of a phone call.",
        "PHONE_NUMBER_ONLY": "The user sent what looks like just a phone number with no request to call.",
    }.get(intent.intent, "The user's message does not require placing a call.")

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _SYSTEM},
                {
                    "role": "user",
                    "content": f"{intent_desc}\n\nUser said: {user_message}\n\nReply in one or two sentences in the user's language:",
                },
            ],
            max_tokens=150,
            temperature=0.3,
        )
        choice = (response.choices or [None])[0]
        if choice is None:
            content = None
        elif hasattr(choice, "message"):
            content = getattr(choice.message, "content", None)
        else:
            content = (choice.get("message") or {}).get("content") if isinstance(choice, dict) else None
        if isinstance(content, str) and content.strip():
            return content.strip()
        logger.warning("OpenAI returned empty content for no_call intent reply.")
    except Exception as e:
        logger.warning("OpenAI API call failed in reply_for_no_call_intent: %s", e, exc_info=True)
    return _fallback_reply(intent)


def _fallback_reply(intent: Intent) -> str:
    """Static fallback when OpenAI is not configured or fails (e.g. OPENAI_API_KEY not set)."""
    return {
        "SIMPLE_CHAT": "Sorry, I'm unable to answer that right now. (To get real answers from ChatGPT, set OPENAI_API_KEY in the backend environment.)",
        "GENERAL_HELP": "I'm here to help. For writing emails or other tasks that don't need a call, I can assist—tell me what you'd like to write or do.",
        "ROUTER_NO_CALL": "I'm here to help. Tell me what you'd like to do—I can help with writing, homework, or other tasks, or place a phone call for you when you're ready.",
        "CALL_OFFER_VET_OR_RETURNS": "I can place calls for you—vet clinics for price quotes, stores for returns, or any number to gather information (e.g. ask when someone is available). Tell me the number and what you'd like me to ask, or say if you want a vet quote or return help.",
        "CLARIFY": "I can help with status checks, pricing, scheduling, or other tasks. What would you like me to do?",
        "HYBRID_OFFER": "I can look that up and also call businesses for you if you'd like exact details. Would you like me to call?",
        "AMBIGUOUS": "I can help in a few ways: answer questions here in chat (e.g. about pet care, pricing), or place a phone call for you (e.g. for a return or to get a vet quote). What would you like to do?",
        "DO_NOT_CALL": "Understood, I won't call. Is there anything else I can help with?",
        "ALREADY_CALLED": "Got it — sounds like that's already taken care of. Anything else you need?",
        "SAVE_NUMBER": "I'm focused on helping with calls right now. You can save numbers in your phone's contacts.",
        "TEXT_INSTEAD_OF_CALL": "I'm set up to place calls for you; I can't send texts. Would you like help with a call instead?",
        "PHONE_NUMBER_ONLY": "I see a number — would you like me to call it for you, or were you sharing it for something else?",
    }.get(intent.intent, "I'm here to help with calls when you're ready. What would you like to do?")
