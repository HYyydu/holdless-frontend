"""POST /chat: deterministic state machine chat endpoint."""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.services.conversation_persistence import (
    create_conversation,
    ensure_user,
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
    is_positive_confirmation,
    transition as hospital_transition,
)
from app.services.state_machine import _is_yes, _normalize_phone
from app.services.call_placement import (
    call_backend_configured,
    place_outbound_call,
    resolve_bearer_token,
)
from app.services.task_service import create_task, update_task

router = APIRouter()

_DIRECT_CALL_VERB_RE = re.compile(
    r"\b(call|dial|phone|ring)\b|给.*打电话|拨打",
    re.IGNORECASE,
)


class ChatRequest(BaseModel):
    user_id: str
    message: str = ""
    conversation_id: str | None = None


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
        "reply_locale": context.get("reply_locale"),
    }


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
    conversation_id = body.conversation_id if body.conversation_id else None

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
    # Deterministic direct-call entry: if user clearly provides "call + phone number", bypass Layer 1.
    if (
        at_entry_no_flow
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
    merged_context = update_reply_locale_from_message(dict(base_context), message)
    if reply_text and should_localize_to_chinese(merged_context, message):
        reply_text = localize_assistant_reply(reply_text, user_message=message)
    persisted_context = _context_for_redis(merged_context)
    save(conversation_id, user_id, new_state, persisted_context)

    new_state_value = new_state.value if hasattr(new_state, "value") else new_state
    try:
        update_conversation(conversation_id, new_state_value, persisted_context)
        append_messages(conversation_id, message, reply_text)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to persist chat: {e!s}",
        )

    task_id = None
    placed_call_id: str | None = None
    placed_call_reason: str | None = None
    placed_domain: str | None = None
    call_reason_effective: str | None = None
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
        payload = {
            "zip": persisted_context.get("zip"),
            "hospital_phone": persisted_context.get("hospital_phone"),
            "call_reason": persisted_context.get("call_reason"),
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

        phone = (persisted_context.get("hospital_phone") or "").strip()
        if task_id and phone and call_backend_configured():
            auth = resolve_bearer_token(request.headers.get("authorization"))
            placement = place_outbound_call(
                phone,
                call_reason_effective,
                bearer_token=auth,
            )
            if placement.get("callId"):
                placed_call_id = placement["callId"]
                placed_call_reason = placement.get("callReason") or call_reason_effective
                placed_domain = placement.get("domain") or "unknown"
                try:
                    update_task(
                        task_id,
                        user_id,
                        payload={
                            "type": "call",
                            "callId": placed_call_id,
                            "callReason": placed_call_reason,
                            "title": placed_domain,
                            "description": placed_call_reason,
                            "vendor": "Phone Call",
                        },
                    )
                except Exception as patch_err:
                    print(f"[Chat] Failed to update task with callId: {patch_err}")
            elif placement.get("error"):
                print(f"[Chat] placeCall failed: {placement.get('error')}")

    result = {
        "reply_text": reply_text,
        "conversation_id": conversation_id,
        "debug_state": new_state_value,
    }
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
