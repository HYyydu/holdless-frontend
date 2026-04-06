### Intent Routing & Slot Engine Walkthrough

This document shows, **step by step**, how a single user message moves through:

- **Layer 1 Router** (`flow_router.py`)
- **Chat API** (`/chat` → `app/api/chat.py`)
- **Slot Engine** (`slot_engine.py`)
- **State Machines** (`state_machine.py`, `return_service_machine.py`)
- **Task creation** (`task_service.py`)

It uses real code paths and example payloads so you can mentally trace requests end‑to‑end.

---

### 1. Entry: `/chat` HTTP request

Frontend calls:

- **Method**: `POST /chat`
- **Body**:

```json
{
  "user_id": "u_123",
  "message": "Call a vet near 90007 to compare neutering prices.",
  "conversation_id": null
}
```

In `post_chat` (`app/api/chat.py`):

1. `ensure_user(user_id)` ensures the user exists.
2. `conversation_id` is `null` → `create_new(user_id)` in `conversation_store.py`.
   - New state: `ConversationState.AWAITING_ZIP`
   - New context: see `_default_context()` (adds `flow_type`, `slot_state`, etc.).
3. We persist the conversation via `create_conversation(...)` (Supabase row).

Now we have:

```python
state   = ConversationState.AWAITING_ZIP
context = {
  "flow_type": None,
  "slot_state": None,
  "slot_domain": None,
  "slot_capability": None,
  # plus zip, phone, call_reason, pet fields, etc. all None/[].
}
```

`current_state_str == "AWAITING_ZIP"` and `flow_type is None` → **we are at entry** (`at_entry_no_flow = True`).

---

### 2. Layer 1: `route_flow(...)` (execution_mode + capability + domain)

Still in `post_chat`, we call:

```python
route = route_flow(
    message,
    conversation_history=None,
    in_flow=False,
    current_flow_type=None,
)
```

In `flow_router.py`:

1. It builds the prompt `_ROUTER_PROMPT` describing:
   - `execution_mode`: `chat | call | hybrid | clarify`
   - `capability`: e.g. `price_quote`
   - `domain`: e.g. `pet`
   - plus confidence, reasoning, `needs_clarification`, `multi_intent`.
2. Calls OpenAI (`gpt-4o-mini`) with that system prompt and the user message.
3. Parses the JSON into a `Layer1Route` dataclass:

```python
Layer1Route(
  execution_mode="call",
  capability="price_quote",
  domain="pet",
  confidence=0.93,
  reasoning="User explicitly asked to call a vet for price comparison.",
  needs_clarification=False,
  multi_intent=False,
)
```

If JSON is malformed, `_parse_router_response` returns `None` and we retry once. If it still fails we return `None` and `post_chat` falls back to a safe chat reply.

---

### 3. Layer 1 decision tiers in `post_chat`

In `app/api/chat.py`, we’re in the **entry branch**:

```python
if at_entry_no_flow:
    if route is None:
        # fallback chat
    elif route.is_low_confidence():
        # Tier C → chat
    elif route.is_medium_confidence():
        # Tier B → clarify
    else:
        # Tier A (high confidence) — execute
```

Our example has high confidence, so we go into the Tier A block.

We map Layer 1 to a legacy `flow_type`:

```python
flow_type = layer1_to_flow_type(route) if route.execution_mode == EXECUTION_CALL else None
```

For `domain="pet"` and `capability="price_quote"`, `layer1_to_flow_type` returns:

- `flow_type = "hospital_pet_quote"`

No `multi_intent`, so we skip the clarify branch and enter:

```python
elif flow_type is not None:
    # call + supported (pet/retail) → slot engine if schema exists, else legacy state machine
    context["flow_type"] = flow_type
    if SlotRegistry.has_schema(route.domain, route.capability):
        ...
```

---

### 4. Slot Registry lookup

`SlotRegistry.has_schema("pet", "price_quote")` → **True**, because in
`app/core/slot_registry/registry.py` we registered:

```python
_registry = {
    ("pet", "price_quote"): PET_PRICE_QUOTE,
    ("retail", "complaint"): RETURN_SERVICE,
}
```

So we:

```python
context["slot_domain"] = "pet"
context["slot_capability"] = "price_quote"
context["slot_state"] = {"slots": {}, "status": "collecting"}

updated_context, reply_text, slot_status, ui_options = slot_engine_process(
    "pet", "price_quote", message, context
)
new_state = ConversationState.SLOT_COLLECTING
```

At this point we've **not** yet entered the old hospital state machine; we’ve delegated to the **slot engine** for structured collection.

---

### 5. Slot Engine: first turn

`slot_engine_process` is `process(...)` in `app/services/slot_engine.py`.

Input:

```python
domain      = "pet"
capability  = "price_quote"
message     = "Call a vet near 90007 to compare neutering prices."
context     = {
  "flow_type": "hospital_pet_quote",
  "slot_domain": "pet",
  "slot_capability": "price_quote",
  "slot_state": {"slots": {}, "status": "collecting"},
  ...
}
```

Step 1 — schema:

```python
schema = SlotRegistry.get_schema("pet", "price_quote")  # PET_PRICE_QUOTE from pet.py
```

`PET_PRICE_QUOTE` slots:

- `zip_code` (required)
- `service_type` (required)
- `pet_type` (required, dog|cat)
- `name` (required)
- `breed` (optional)
- `age` (optional)
- `weight` (optional)

Step 2 — extraction:

```python
extracted = _extract_slots_from_message(message, domain, capability, schema)
```

Given our message:

- `_normalize_zip` finds `90007` → `zip_code = "90007"`.
- Service keywords find “neutering” → `service_type = "neutering"`.
- No explicit dog/cat/name/breed/age/weight yet.

So we get:

```python
extracted = {
  "zip_code": "90007",
  "service_type": "neutering",
  "call_reason": "the neutering cost for a cat"  # via _extract_call_reason (roughly)
}
```

Step 3 — validation + merge:

```python
merged_slots = _validate_and_merge(schema, extracted, current_slots={})
```

- `zip_code` validated by `validate_zip` → stored as valid.
- `service_type` has no custom validator → stored as valid.
- `call_reason` is not in this schema, so it’s ignored at this layer (it will still be inferred into context later via `_export_to_context`).

Result `slot_state.slots`:

```python
{
  "zip_code":   {"value": "90007", "valid": True, "attempts": 1},
  "service_type": {"value": "neutering", "valid": True, "attempts": 1},
}
```

Step 4 — missing required slots:

Required = `zip_code`, `service_type`, `pet_type`, `name`.

We already have `zip_code` + `service_type`, so missing:

- `pet_type`
- `name`

`_next_question` returns the **first missing** required slot (`pet_type`), and uses its prompt:

```python
prompt = "Is this for a dog or a cat?"
```

The slot engine returns:

```python
updated_context = {
  ...,
  "slot_state": {
    "slots": {
      "zip_code": {...},
      "service_type": {...},
    },
    "status": "collecting",
  },
}
reply_text   = "Is this for a dog or a cat?"
slot_status  = "collecting"
```

Back in `post_chat`, we keep:

- `new_state = ConversationState.SLOT_COLLECTING`
- `updated_context` from the slot engine

Response to the frontend:

```json
{
  "reply_text": "Is this for a dog or a cat?",
  "conversation_id": "...",
  "debug_state": "SLOT_COLLECTING"
}
```

---

### 6. Second message: fill more slots

User replies:

> “It’s for my 3‑year‑old dog named Max.”

Frontend calls `POST /chat` again, this time with the **same** `conversation_id`.

`post_chat`:

1. `load(conversation_id)` from Redis returns:
   - `state = ConversationState.SLOT_COLLECTING`
   - `context` containing `slot_state`, `slot_domain="pet"`, `slot_capability="price_quote"`, `flow_type="hospital_pet_quote"`.
2. Now:

```python
current_state_str == "SLOT_COLLECTING"
context["flow_type"] == "hospital_pet_quote"
⇒ at_entry_no_flow = False
⇒ in_flow = True
```

We call `route_flow` **again** with `in_flow=True`, but for this message Layer 1 will typically classify:

```python
Layer1Route(
  execution_mode="call",
  capability="price_quote",
  domain="pet",
  confidence≈0.9,
  ...
)
```

We are in the “already in a flow” branch; since there’s no high‑confidence `chat` escape and no domain/capability change, we **fall through** to:

```python
if new_state is None:
    if current_state_str == ConversationState.SLOT_COLLECTING.value:
        updated_context, reply_text, slot_status, ui_options = slot_engine_process(...)
        new_state = ConversationState.SLOT_COLLECTING
        if slot_status == STATUS_READY:
            ...
```

So we call the slot engine again.

Slot engine extraction on:

> “It’s for my 3‑year‑old dog named Max.”

Finds:

- `pet_type = "dog"`
- `age = "3"`
- `name = "Max"`

It merges these into `slot_state.slots` and re‑computes missing required slots:

- `zip_code` ✅
- `service_type` ✅
- `pet_type` ✅
- `name` ✅

All required are present → `_is_ready` returns **True**.

The engine:

1. Sets `slot_state.status = "ready"`.
2. Calls `_export_to_context("pet", "price_quote", merged_slots)`:

   ```python
   ctx["zip"]         = "90007"
   ctx["call_reason"] = "neutering"  # service_type
   ctx["name"]        = "Max"
   ctx["breed"]       = None
   ctx["age"]         = "3"
   ctx["weight"]      = None
   ```

   These keys merge back into `context`, so the **legacy hospital state machine** and **task payload** see exactly what they expect.

3. Builds a confirmation summary reply:

```text
I have everything I need.

• zip_code: 90007
• service_type: neutering
• pet_type: dog
• name: Max
• age: 3

Should I proceed with the call? (Yes/No)
```

It returns:

```python
updated_context = { ..., "zip": "90007", "call_reason": "neutering", "name": "Max", "age": "3", ... }
reply_text      = "...Should I proceed with the call? (Yes/No)"
slot_status     = "ready"
```

Back in `post_chat`, because `slot_status == STATUS_READY`, we jump to a **confirm** state:

```python
new_state = (
    ReturnFlowState.AWAITING_CALL_CONFIRM
    if flow_type == FLOW_RETURN_SERVICE
    else ConversationState.AWAITING_CALL_CONFIRM
)
```

So now:

- `state = AWAITING_CALL_CONFIRM`
- `context` has all call‑ready fields set.

---

### 7. Third message: confirmation and task creation

User replies:

> “Yes”

`POST /chat` again with the same `conversation_id`:

1. `load(...)` → state is now `AWAITING_CALL_CONFIRM`.
2. `at_entry_no_flow` is **False**; we are “already in a flow”.
3. Layer 1 is called again but we’ll likely stay in **call** mode; we fall through to the `if new_state is None` block:

```python
elif is_return_flow_state(current_state_str):
    ...
else:
    hospital_state = ConversationState(current_state_str)
    new_state, updated_context, reply_text, ui_options = hospital_transition(
        hospital_state, message, context, user_id
    )
```

`hospital_transition` (in `state_machine.py`) handles:

```python
if state == ConversationState.AWAITING_CALL_CONFIRM:
    if _is_yes(msg):
        ...
        return (
            ConversationState.CONFIRMED,
            context,
            "Confirmed. I'll reach out to ...",
            None,
        )
```

So we end up with:

- `new_state = ConversationState.CONFIRMED`
- `reply_text = "Confirmed. I'll reach out to ..."`

Back in `post_chat`, we detect confirmation:

```python
is_confirmed = new_state_value in (
    ConversationState.CONFIRMED.value,
    ReturnFlowState.CONFIRMED.value,
)
```

This is `True`, so we build the **task payload**:

```python
payload = {
  "zip":          persisted_context.get("zip"),
  "hospital_phone": persisted_context.get("hospital_phone"),
  "call_reason":  persisted_context.get("call_reason"),
  "pet_profile_id": persisted_context.get("pet_profile_id"),
  "name":         persisted_context.get("name"),
  "breed":        persisted_context.get("breed"),
  "age":          persisted_context.get("age"),
  "weight":       persisted_context.get("weight"),
  "availability": persisted_context.get("availability"),
  "selected_clinics": persisted_context.get("selected_clinics"),
}
task = create_task(user_id, payload)
```

This is the object the Node server later uses to actually place the call.

Final HTTP response to the frontend for this turn includes:

```json
{
  "reply_text": "Confirmed. I'll reach out to ...",
  "conversation_id": "...",
  "debug_state": "CONFIRMED",
  "task_id": "<new_task_id>",
  "hospital_phone": null,
  "call_reason": "neutering"
}
```

The UI can now show that the call is queued and track it via the task ID.

---

### 8. Escape & hybrid paths (high‑level)

The same pipeline also supports:

- **Hybrid** (Layer 1 sets `execution_mode="hybrid"`): at entry, we respond via ChatGPT fallback with a short answer + “Would you like me to call?” and set `context["pending_hybrid_offer"] = { "domain": route.domain, "capability": route.capability }`. On the **next** message, **before** calling Layer 1, we check: if `pending_hybrid_offer` is set and the user’s message is a positive confirmation (e.g. “yes”, “yes I would like you to call”), we **do not** call Layer 1; we start the slot engine with the stored domain/capability and clear the pending offer. This makes hybrid→call deterministic and fixes the failure where “yes, call” was re-classified by Layer 1 as chat and the assistant replied “I can’t make calls right now.”
- **Escape from call to chat**: while in any flow, if Layer 1 returns high‑confidence `execution_mode="chat"`, we:
  - Reset to `AWAITING_ZIP`
  - Clear `flow_type` and slot state (`clear_slot_state`)
  - Reply via ChatGPT fallback (`ROUTER_NO_CALL`)
- **Flow switches**: while in a flow, if Layer 1 returns a different `domain/capability` that maps to another `flow_type`, we:
  - Update `context["flow_type"]`
  - Start the appropriate machine (slot engine or legacy) for the new flow.

This means **every message** goes:

1. `/chat` → `post_chat`
2. `route_flow` (Layer 1)
3. Either:
   - ChatGPT fallback (no‑call / clarify / hybrid), or
   - Slot Engine (if schema exists), plus
   - Deterministic state machine (pet or return)
4. Optional: task creation when confirmed.

That’s the full end‑to‑end path for intent classification and execution for a real user message in the current codebase.

