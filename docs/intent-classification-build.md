# Coding Agent Session – Building Holdless Intent Classification

**Project:** Holdless AI Phone Agent  
**Goal:** Implement intent classification to determine whether a user request requires making a phone call.

---

## Prompt

I am building an AI phone assistant called Holdless.  
Users send messages like:

- "Call this vet and ask how much a dog check-up costs"
- "Can you compare prices for neutering near 90007?"
- "Hello"

I need a Python function that classifies whether the user intent requires making a phone call or should be answered directly.

---

## Agent Response

Suggested approach:

1. **Rule-based filtering** for simple greetings (e.g. "hello", "hi") → no call.
2. **LLM classification** for ambiguous or actionable queries → structured output.
3. **Structured output:** `call_required`, `intent_type`, and optionally `extracted_purpose` (or richer fields like `execution_mode`, `capability`, `domain`).

Example minimal code:

```python
def classify_intent(message: str):
    greetings = ["hello", "hi", "how are you"]

    if message.lower() in greetings:
        return {"call_required": False, "intent_type": "chat"}

    # otherwise treat as call task
    return {"call_required": True, "intent_type": "service_request"}
```

---

## What We Built (Implementation Summary)

The codebase implements a **Layer 1 intent router** that goes beyond a simple `call_required` flag:

### 1. Layer 1 Router (`app/services/flow_router.py`)

- **Execution modes:** `chat` | `call` | `hybrid` | `clarify`
  - **chat** — User wants info, explanation, or conversation; no call.
  - **call** — User explicitly wants a call (e.g. "Call a vet…", "Compare prices for me").
  - **hybrid** — Research that can escalate to a call (e.g. "How much does neutering cost?" → answer + offer to call).
  - **clarify** — Intent ambiguous or incomplete (e.g. "I need help with DMV").

- **Structured output:** `execution_mode`, `capability` (e.g. `price_quote`, `booking`, `information_lookup`), `domain` (e.g. `pet`, `retail`, `general_business`), `confidence` (0.0–1.0), `reasoning`, `needs_clarification`, `multi_intent`.

- **Rule:** Default to `chat` or `clarify` when uncertain; **never** default to `call`. Call only when the user **explicitly** requests action to contact someone.

- **LLM:** Uses OpenAI `gpt-4o-mini` with a strict JSON prompt; retries once on malformed output.

### 2. Confidence Tiers (in `app/api/chat.py`)

- **≥ 0.85 (high):** Execute — start call flow or hybrid offer when appropriate.
- **0.6–0.85 (medium):** Clarify — ask the user before committing.
- **< 0.6 (low):** Never start a call; respond via chat (no-call intent).

### 3. No-Call Reply Generation (`app/services/chatgpt_fallback.py`)

When the router decides no call is needed, the system uses an **Intent** label (e.g. `ROUTER_NO_CALL`, `CLARIFY`, `HYBRID_OFFER`) and calls `reply_for_no_call_intent(user_message, intent)` to generate a short, helpful reply via the same LLM (with fallback static strings if the API is unavailable).

### 4. Flow Type Mapping

Layer 1’s `capability` + `domain` are mapped to legacy **flow_type** (e.g. `hospital_pet_quote`, `return_service`, `general_call`) so existing state machines and slot collection can run when the user does request a call.

---

## Key Files

| File | Purpose |
|------|--------|
| `app/services/flow_router.py` | Layer 1 LLM router: `route_flow()`, `Layer1Route`, prompt, parsing |
| `app/api/chat.py` | Uses router at entry; applies confidence tiers; starts call vs chat/clarify |
| `app/services/chatgpt_fallback.py` | `Intent` dataclass; `reply_for_no_call_intent()` for no-call replies |

---

## Minimal “Call Required” View

In practice, **call required** corresponds to:

- `route_flow()` returns a `Layer1Route` with `execution_mode == "call"` **and**
- `confidence >= 0.85` **and**
- `layer1_to_flow_type(route)` is not `None` (supported domain/capability) **and**
- Not `multi_intent` (multi-intent triggers clarification instead of starting a call).

Everything else is handled as chat, clarify, or hybrid (answer + offer to call).
