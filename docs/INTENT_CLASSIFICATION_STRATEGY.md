# 🔥 Strategic Upgrade: Capability + Slot-Aware Intent Router

Instead of routing directly into a specific flow, change Layer 1 to classify:

```
{
  execution_mode: chat | call | hybrid
  capability: price_quote | booking | cancellation | info_lookup | complaint | unknown
  domain: pet | healthcare | dmv | retail | utilities | insurance | restaurant | general_business
  required_slots: [...]
  confidence: 0–1
}
```

This gives you:

- Much more coverage
- Extensible architecture
- Cleaner pre-call slot collection
- Less brittle logic

---

# 🚀 The New 4-Step Strategy

## STEP 1 — Separate “Execution Mode” from “Business Intent”

Right now, you mix:

- Should we call?
- What type of call?

Split these.

### First classify:

| Field          | Meaning                           |
| -------------- | --------------------------------- |
| execution_mode | chat / call / hybrid              |
| capability     | What the user wants to accomplish |
| domain         | What type of business             |

Example:

User:

> “How much does neutering cost near me?”

Old system → no_call

New system:

```
execution_mode: chat
capability: price_quote
domain: pet
```

Later:

> “Call them and compare prices.”

```
execution_mode: call
capability: price_quote
domain: pet
```

Same capability.
Different execution mode.

This prevents duplication between router and call intent.

---

## STEP 2 — Move from Flow-Based to Slot-Based

Instead of:

```
if flow == hospital_pet_quote:
   ask zip
   ask pet info
```

Do this:

1. Identify capability + domain
2. Load required slot schema dynamically

Example:

### For pet + price_quote

Required slots:

```
zip_code
pet_type
breed
age
weight
service_type
```

### For retail + return_service

```
store_name
order_number
item_name
purchase_date
reason
```

Now your router just decides:

```
capability = price_quote
domain = pet
```

And your system auto-loads:

```
slot_schema_registry[(pet, price_quote)]
```

That’s much more scalable.

---

## STEP 3 — Add a Third Category: “Research → Call Escalation”

Right now it's:

- chat
- call

But many real users behave like this:

> “How much does neutering cost?”
> (you answer)
> “Ok call 3 near me.”

That’s not binary. That’s staged.

Introduce:

```
execution_mode = hybrid
```

Meaning:

- Phase 1: Chat research
- Phase 2: Offer to call

Example behavior:

If:

```
capability == price_quote
domain == pet
execution_mode == chat
```

You respond:

> I can research typical pricing, or I can call clinics to get exact quotes. Would you like me to call?

This increases tool usage rate dramatically.

For YC metrics, this is huge.

---

## STEP 4 — Introduce Confidence Tiers Instead of Hard 0.85 Cutoff

Right now:

```
confidence >= 0.85 → call
else → chat
```

That’s too rigid.

Use 3 tiers:

| Confidence | Behavior      |
| ---------- | ------------- |
| ≥ 0.85     | Execute       |
| 0.6 – 0.85 | Clarify       |
| < 0.6      | Chat fallback |

Example:

If user says:

> “Can you help me with DMV stuff?”

You don’t know booking vs info lookup.

Instead of defaulting to no_call, ask:

> Are you trying to renew a license, schedule an appointment, or check status?

This reduces wrong flow triggers.

---

# 🧠 How This Changes Your Architecture

## Updated Layer 1 (Python)

Replace:

```
flow: no_call | return_service | hospital_pet_quote
```

With:

```
execution_mode
capability
domain
required_slots
confidence
```

Then:

```
if execution_mode == chat:
    respond via ChatGPT

if execution_mode == call:
    load slot schema
    collect missing slots
    confirm
    place call

if execution_mode == hybrid:
    offer escalation
```

---

# 🔁 What Happens to Layer 2 (Node)?

Layer 2 becomes simpler.

Instead of re-classifying domain + task from raw text,
you pass structured metadata:

```
intent: {
   domain,
   capability,
}
```

Node no longer needs heavy LLM intent classification.

This reduces:

- Latency
- Cost
- Error stacking

---

# 📈 Example of New Behavior

### Case 1 — Info Only

User:

> “How much does dog neutering cost?”

System:

```
chat
price_quote
pet
```

Response:

> Average is $200–$500. Would you like me to call nearby clinics for exact quotes?

---

### Case 2 — Direct Call

User:

> “Call a vet near 90007 and compare prices.”

System:

```
call
price_quote
pet
```

Now start slot filling.

---

### Case 3 — Complex Case

User:

> “Call DMV and check if I can renew my license.”

System:

```
call
status_check
dmv
```

Different slot schema loads automatically.

---

# 🧩 What This Enables for Holdless

This change allows you to support:

- Pet quotes
- Medical appointments
- DMV renewals
- Insurance claims
- Utilities cancellations
- Restaurant reservations
- Refund complaints
- Subscription cancellations

WITHOUT hardcoding new flows every time.

Just:

1. Add new capability
2. Add new slot schema

---

# 🏗 Recommended Upgrade Plan (1–2 weeks realistic)

### Week 1

- Refactor flow router output schema
- Introduce capability + domain classification
- Add hybrid mode
- Implement confidence tiering

### Week 2

- Convert existing pet + return flows into slot schema registry
- Remove Node intent LLM
- Pass structured intent to backend
- Add escalation logic

## Below is a **comprehensive Layer 1 design** — including:

- Execution model
- Classification schema
- Confidence tiers
- Low-confidence handling
- Escapes from flow
- Ambiguity resolution
- Multi-intent handling
- Failure modes
- State machine interaction
- Suggested prompt structure

This is written like a system design spec you could hand to a teammate.

---

# 🔥 LAYER 1 — Intelligent Execution Router (V2)

Layer 1 should answer **one core question**:

> “What should we do next with this user message?”

Not just:

> “Call or no call?”

---

# 1️⃣ Responsibilities of Layer 1

Layer 1 MUST decide:

1. Execution mode
   - chat
   - call
   - hybrid
   - clarify

2. Capability (what user wants to accomplish)

3. Domain (what type of business/system)

4. Whether we are:
   - entering a flow
   - continuing a flow
   - escaping a flow
   - switching flow

5. Confidence tier

---

# 2️⃣ Proposed Output Schema

```json
{
  "execution_mode": "chat | call | hybrid | clarify",
  "capability": "price_quote | booking | cancellation | status_check | complaint | information_lookup | unknown",
  "domain": "pet | healthcare | dmv | retail | utilities | insurance | restaurant | government | general_business | unknown",
  "confidence": 0.0,
  "reasoning": "short explanation",
  "needs_clarification": true | false,
  "multi_intent": false
}
```

Important:
Layer 1 NEVER loads slot schemas.
It only decides WHAT to do next.

---

# 3️⃣ Execution Mode Definitions

## chat

User wants information, explanation, advice, or conversation.

Example:

- “How much does neutering cost?”
- “What documents do I need for DMV?”

→ No call.

---

## call

User explicitly wants you to place a call.

Triggers:

- “Call…”
- “Can you call…”
- “Schedule an appointment”
- “Cancel my service”
- “Compare prices for me”

---

## hybrid

User intent is research that can escalate.

Example:

- “How much does a dental cleaning cost near me?”

Response:
You can answer average pricing AND offer to call.

Hybrid increases conversion rate.

---

## clarify

Confidence medium or intent incomplete.

Example:

- “I need help with DMV.”

Not enough info.

---

# 4️⃣ Confidence Tier Strategy

Replace hard cutoff (0.85) with 3-tier decision.

## Tier A — High Confidence (≥ 0.85)

Action:

- Immediately execute

If call → start slot collection
If chat → respond normally

---

## Tier B — Medium Confidence (0.6 – 0.85)

Action:

- Clarify before committing

Example:

User:

> “Can you check something for me?”

Instead of guessing:

> Are you trying to check a service status, pricing, or schedule something?

This prevents wrong flow activation.

---

## Tier C — Low Confidence (< 0.6)

Action:

- Fallback to safe chat
- Ask broad clarification
- Do NOT start call flow

Example:

User:

> “Uhh idk maybe something about my dog?”

Response:

> Can you tell me what you'd like help with regarding your dog?

Never default to call at low confidence.

---

# 5️⃣ Behavior While Already in a Flow

This is critical.

Layer 1 must check:

- Are we currently inside a slot collection flow?

If YES:

We allow 3 possibilities:

---

## A) Continue Flow

User gives slot value:

> 90007

Router should detect:

- Not new intent
- No call escape
- Continue current flow

Important: Router must consider conversation history.

---

## B) Escape to No-Call

User:

> Actually never mind, just tell me the average price.

Router:

```
execution_mode: chat
confidence: 0.92
```

System should:

- Stop flow
- Respond in chat

---

## C) Switch Flow

User:

> Actually I need to cancel my electricity instead.

Router:

```
execution_mode: call
capability: cancellation
domain: utilities
confidence: 0.91
```

System:

- Terminate previous flow
- Start new slot schema

---

# 6️⃣ Handling Ambiguous Cases

## Case: Research vs Call

User:

> How much does X cost near me?

We treat as:

```
execution_mode: hybrid
capability: price_quote
```

Response template:

> I can provide average pricing, or I can call businesses near you to get exact quotes. Would you like me to call?

This converts passive questions into call triggers.

---

## Case: Partial Call Intent

User:

> I need to return strawberries.

Not explicit call.

Router:

```
execution_mode: clarify
confidence: 0.75
```

Response:

> Do you want me to call the store for you to arrange a return?

---

# 7️⃣ Multi-Intent Handling

Example:

> Call the vet and then book an appointment if it's under $300.

Router:

```
multi_intent: true
capability: price_quote
execution_mode: call
```

But system must detect conditional logic.

For v1:

- Ask clarification
- Do not attempt automatic branching

Response:

> Just to confirm — you'd like me to call, get a quote, and only schedule if it's under $300?

Keep complexity manageable.

---

# 8️⃣ Failure Cases

Now the critical part.

---

## ❌ Case 1 — LLM API Failure

route_flow returns None.

System behavior:

- Log error
- Fallback to chat
- Ask safe clarification

Never crash.

---

## ❌ Case 2 — Malformed JSON

Try parse.
If fail:

- Retry once
- If still fail → fallback to clarify mode

---

## ❌ Case 3 — Low Confidence But Call-Like Message

User:

> Call someone for my dog.

Confidence: 0.55

Do NOT call.

Respond:

> Who would you like me to call and what would you like me to ask?

---

## ❌ Case 4 — Overconfident Wrong Classification

Mitigation:

Add guardrail rule in prompt:

> Only choose execution_mode=call if user explicitly requests action to contact someone on their behalf.

This reduces hallucinated call triggers.

---

# 9️⃣ Prompt Structure (Strong Version)

Your prompt should explicitly define:

1. Definitions of execution_mode
2. Definition of capability
3. Confidence rules
4. Default to clarify if unsure
5. Only call when explicit action requested

Critical rule:

> Default to "chat" or "clarify" if uncertain. Never default to "call".

---

# 🔟 Interaction with Slot Registry

Layer 1 does NOT:

- Ask for ZIP
- Ask for pet info
- Manage slot completeness

It only decides:

```
should we start slot filling?
```

Then your slot engine handles the rest.

This separation prevents complexity explosion.

---

# 🧠 Why This Design is Robust

This handles:

- Explicit call
- Implicit research
- Ambiguous help requests
- Flow escape
- Flow switching
- Multi-intent
- Low confidence
- API failure
- JSON failure
- Over-triggering

That’s production-grade behavior.

---

# 🚀 Big Architecture Shift Summary

Old model:

```
no_call | return_service | hospital_pet_quote
```

New model:

```
execution_mode
capability
domain
confidence tier
```

Much more extensible.

---

# 📌 What I Recommend You Do Next

Implement:

1. New structured router schema
2. 3-tier confidence handling
3. Hybrid execution mode
4. Clarify mode

Keep everything else same for now.

---

If you want, next I can:

- Write the exact production-ready router prompt
- Give you Python pseudocode for decision logic
- Design test cases to validate edge scenarios
- Or simulate 30 tricky user messages to stress test your router

Which direction do you want to go deeper on?

#Slot Design:
Yes.
This is the moment where Holdless goes from “LLM flow” → “real orchestration system.”

You don’t want:

> if pet_flow → ask zip → ask breed → ask weight

You want:

> A generic slot engine that works for ANY domain + capability.

Below is a **production-grade slot engine design** tailored to Holdless.

---

# 🔥 SLOT ENGINE V2 — Comprehensive Design

This system handles:

- Dynamic schema loading
- Slot extraction
- Slot validation
- Clarification
- Conditional slots
- Re-asking strategy
- Slot confidence
- Multi-slot filling
- Interruptions
- Flow switching
- Escapes
- Persistence
- Call-ready confirmation

---

# 1️⃣ Core Philosophy

The slot engine is NOT:

- A hardcoded sequence of questions.

It IS:

> A constraint solver that tries to reach a "call-ready state".

It continuously asks:

```python
are_all_required_slots_filled_and_valid() ?
```

If not → collect missing slots.

---

# 2️⃣ Architecture Overview

```
Layer 1 Router
     ↓
Slot Engine
     ↓
Slot Registry (schemas)
     ↓
State Manager (DB / Redis)
     ↓
Call Executor
```

---

# 3️⃣ Slot Schema Registry Design

File:

```
app/core/slot_schemas.py
```

Structure:

```python
from dataclasses import dataclass
from typing import Callable, Optional, Any

@dataclass
class Slot:
    name: str
    required: bool
    type: str
    description: str
    validator: Optional[Callable[[Any], bool]] = None
    depends_on: Optional[str] = None
    condition: Optional[Callable[[dict], bool]] = None
    retry_limit: int = 2
```

---

## Example: Pet Price Quote

```python
PET_PRICE_QUOTE = [
    Slot("zip_code", True, "string", "ZIP code of search area"),
    Slot("pet_type", True, "string", "dog or cat"),
    Slot("breed", False, "string", "breed of the pet"),
    Slot("age", True, "integer", "age in years"),
    Slot("weight", False, "number", "weight in lbs"),
    Slot("service_type", True, "string", "type of service"),
]
```

---

## Example: DMV Renewal

```python
DMV_RENEWAL = [
    Slot("state", True, "string", "state of license"),
    Slot("license_number", False, "string", "license number"),
    Slot("full_name", True, "string", "full name"),
    Slot("date_of_birth", True, "date", "DOB"),
]
```

---

# 4️⃣ Slot Engine State Model

Each conversation stores:

```python
{
  "flow_id": "uuid",
  "domain": "pet",
  "capability": "price_quote",
  "slots": {
      "zip_code": {
          "value": "90007",
          "confidence": 0.95,
          "valid": True,
          "attempts": 1
      },
      ...
  },
  "status": "collecting | ready | calling | cancelled"
}
```

Persist in:

- Redis (fast)
- Supabase (backup / history)

---

# 5️⃣ Slot Filling Loop

On each user message:

## Step 1 — Extract Slots

Use LLM or structured extraction:

```python
extract_slots(message, current_schema)
```

LLM returns:

```json
{
  "zip_code": "90007",
  "pet_type": "dog"
}
```

---

## Step 2 — Validate

For each extracted slot:

```python
if slot.validator:
    valid = slot.validator(value)
```

Examples:

ZIP validator:

```python
def validate_zip(z):
    return len(z) == 5 and z.isdigit()
```

Age validator:

```python
def validate_age(a):
    return 0 <= a <= 30
```

---

## Step 3 — Store with Confidence

You can also store LLM confidence.

If confidence < 0.7 → ask confirmation.

Example:

> Did you mean your dog is 15 years old?

---

## Step 4 — Determine Missing Required Slots

```python
missing = [
   slot for slot in schema
   if slot.required and not filled(slot)
]
```

If missing:
→ Ask next best question.

If none:
→ Status = ready

---

# 6️⃣ Question Selection Strategy

Do NOT just ask in fixed order.

Instead:

### Priority Rules:

1. Required slots first
2. Slots with dependency satisfied
3. Slots not asked recently
4. Slots with highest failure risk

Example:

If service_type missing:
Ask:

> What service are you looking for — neutering, vaccination, or check-up?

---

# 7️⃣ Conditional Slots

Some slots depend on others.

Example:

If:

```
service_type == "surgery"
```

Then require:

```
anesthesia_type
```

Use:

```python
condition=lambda state: state["service_type"] == "surgery"
```

---

# 8️⃣ Handling Low-Confidence Slot Extraction

If user says:

> I think my dog is around 3 or 4.

Extraction:

```
age: 3
confidence: 0.6
```

System:

> Just to confirm, is your dog 3 years old?

This prevents wrong calls.

---

# 9️⃣ Handling Interruptions

User mid-flow:

> Actually how much does this usually cost?

Slot engine should:

- Pause slot flow
- Answer question
- Resume slot collection

Do NOT reset flow.

---

# 🔟 Handling Slot Corrections

User:

> My ZIP is 90007
> Later:
> Actually it's 90017

Engine should overwrite:

```python
slots["zip_code"]["value"] = "90017"
```

And re-validate readiness.

---

# 1️⃣1️⃣ Retry Logic

Each slot has:

```python
retry_limit = 2
```

If invalid twice:

Fallback:

> I’m having trouble getting that information. Would you like to proceed without it?

Or abort.

---

# 1️⃣2️⃣ Ready State & Confirmation

When all required slots valid:

Before placing call:

> Here’s what I’ll ask:
> • Dog neutering
> • ZIP 90007
> • 3-year-old Labrador
>
> Shall I proceed?

This reduces call errors massively.

---

# 1️⃣3️⃣ Escaping Flow

If router says:

```python
execution_mode = chat
confidence > 0.85
```

Slot engine must:

```python
status = cancelled
```

Do NOT continue asking slot questions.

---

# 1️⃣4️⃣ Switching Flow

If router returns new domain/capability:

- Clear slot state
- Load new schema
- Start fresh

---

# 1️⃣5️⃣ Multi-Slot Extraction Optimization

User:

> I have a 3-year-old golden retriever, 60 pounds, in 90007.

LLM should extract:

```
age
breed
weight
zip_code
```

Ask next only missing.

This creates “smart agent feel.”

---

# 1️⃣6️⃣ Handling Complex Conditional Logic

User:

> Only book if under $300.

This is not a slot — it's a policy constraint.

Store separately:

```python
call_constraints = {
   "max_price": 300
}
```

Slot engine can pass this to call executor.

---

# 1️⃣7️⃣ State Machine

Slot Engine States:

```
INIT
COLLECTING
READY
CONFIRMING
CALLING
COMPLETED
CANCELLED
FAILED
```

---

# 1️⃣8️⃣ Failure Handling

### LLM extraction fails

→ Ask direct question.

### Validation fails repeatedly

→ Escalate.

### User silent

→ Timeout and reset.

### Call backend error

→ Offer retry.

---

# 1️⃣9️⃣ Performance Optimization

For Holdless scale:

- Use Redis for slot state
- Store minimal structured JSON
- Avoid re-calling LLM if user only answers one slot
- Use regex for ZIP, phone, numbers before LLM

---

# 2️⃣0️⃣ Production-Grade Flow Example

User:

> Call a vet near 90007 and compare neutering prices.

Router:

```
call
price_quote
pet
```

Slot engine loads PET_PRICE_QUOTE.

Extraction:

```
zip_code = 90007
service_type = neutering
```

Missing:

```
pet_type
age
```

Ask:

> Is this for a dog or a cat?

User:

> Dog, 3 years old.

Extract:

```
pet_type = dog
age = 3
```

All required filled.

Confirm:

> I'll call clinics near 90007 to compare neutering prices for your 3-year-old dog. Proceed?

Perfect. Now we’re building the **real backbone** of Holdless.

This is not just “define some slots.”
This is designing a **scalable domain-agnostic constraint system**.

I’ll give you a production-level Slot Schema Registry design that supports:

- Multi-domain
- Multi-capability
- Conditional slots
- Validation
- Dynamic dependencies
- Escalation
- Policy constraints
- Future extensibility

We’ll design it like something that can scale to 50+ domains.

---

# 🔥 SLOT SCHEMA REGISTRY — FULL DESIGN

---

# 1️⃣ Core Philosophy

The Slot Schema Registry is:

> A structured definition of what information must be collected before execution.

It is NOT:

- A question list
- A conversation flow
- A state machine

It is:

- A constraint definition layer.

---

# 2️⃣ High-Level Structure

```bash
app/core/
    slot_registry/
        __init__.py
        base_models.py
        registry.py
        pet.py
        retail.py
        dmv.py
        utilities.py
```

Each domain file registers schemas.

---

# 3️⃣ Core Data Models

File: `base_models.py`

```python
from dataclasses import dataclass, field
from typing import Callable, Optional, Any, List, Dict
from enum import Enum


class SlotType(str, Enum):
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    DATE = "date"
    BOOLEAN = "boolean"
    ENUM = "enum"
    PHONE = "phone"
    ZIP = "zip"
    EMAIL = "email"


@dataclass
class SlotValidationResult:
    valid: bool
    normalized_value: Any = None
    error_message: Optional[str] = None


@dataclass
class SlotDefinition:
    name: str
    description: str
    type: SlotType
    required: bool = True
    enum_values: Optional[List[str]] = None
    validator: Optional[Callable[[Any], SlotValidationResult]] = None
    depends_on: Optional[str] = None
    condition: Optional[Callable[[Dict[str, Any]], bool]] = None
    retry_limit: int = 2
    confirmation_required: bool = False
```

---

# 4️⃣ Why These Fields Matter

### name

Unique key for storage.

---

### type

Controls:

- Extraction strategy
- Validation logic
- UI hinting

---

### required

Determines call readiness.

---

### enum_values

Used for structured prompting:
Example:

```python
enum_values=["dog", "cat"]
```

LLM extraction becomes much more reliable.

---

### validator

Allows domain-specific constraints.

Example:

```python
def validate_zip(value):
    if len(value) == 5 and value.isdigit():
        return SlotValidationResult(True, value)
    return SlotValidationResult(False, error_message="Invalid ZIP code.")
```

---

### depends_on + condition

Used for conditional slots.

Example:
If service_type == surgery → require anesthesia_type.

---

### confirmation_required

For high-risk values:

- Price constraints
- Dates
- Personal info

---

# 5️⃣ Schema Definition Structure

Now define full schemas per (domain, capability).

File: `pet.py`

```python
from .base_models import SlotDefinition, SlotType


PET_PRICE_QUOTE = [
    SlotDefinition(
        name="zip_code",
        description="ZIP code of the search area",
        type=SlotType.ZIP,
        required=True,
    ),
    SlotDefinition(
        name="pet_type",
        description="Type of pet",
        type=SlotType.ENUM,
        enum_values=["dog", "cat"],
        required=True,
    ),
    SlotDefinition(
        name="breed",
        description="Breed of the pet",
        type=SlotType.STRING,
        required=False,
    ),
    SlotDefinition(
        name="age",
        description="Age of the pet in years",
        type=SlotType.INTEGER,
        required=True,
    ),
    SlotDefinition(
        name="weight",
        description="Weight of the pet in pounds",
        type=SlotType.FLOAT,
        required=False,
    ),
    SlotDefinition(
        name="service_type",
        description="Service requested",
        type=SlotType.ENUM,
        enum_values=["neutering", "vaccination", "checkup"],
        required=True,
    ),
]
```

---

# 6️⃣ Registry Loader

File: `registry.py`

```python
from typing import Dict, Tuple, List
from .base_models import SlotDefinition
from .pet import PET_PRICE_QUOTE
from .retail import RETURN_SERVICE
from .dmv import DMV_RENEWAL


class SlotRegistry:

    _registry: Dict[Tuple[str, str], List[SlotDefinition]] = {
        ("pet", "price_quote"): PET_PRICE_QUOTE,
        ("retail", "cancellation"): RETURN_SERVICE,
        ("dmv", "booking"): DMV_RENEWAL,
    }

    @classmethod
    def get_schema(cls, domain: str, capability: str):
        return cls._registry.get((domain, capability))
```

---

# 7️⃣ Advanced Feature — Slot Groups

Sometimes capabilities share slots.

Example:
Pet price_quote and booking share:

- zip_code
- pet_type
- age

You can define reusable groups:

```python
COMMON_PET_SLOTS = [
    ...
]
```

Then extend:

```python
PET_BOOKING = COMMON_PET_SLOTS + [...]
```

Avoid duplication.

---

# 8️⃣ Handling Policy Constraints (Not Slots)

Some inputs are not slots but constraints.

Example:

> Only if under $300

These should be stored separately:

```python
@dataclass
class CallPolicyConstraint:
    name: str
    value: Any
```

Registry can define allowed constraints per capability.

---

# 9️⃣ Readiness Logic

Call is READY when:

```python
all(
    slot.required
    and slot_filled
    and slot_valid
    and condition_met
)
```

Optional slots do not block readiness.

---

# 🔟 Conditional Slot Example

Inside DMV:

```python
SlotDefinition(
    name="vehicle_plate",
    description="Vehicle plate number",
    type=SlotType.STRING,
    required=True,
    depends_on="renewal_type",
    condition=lambda state: state.get("renewal_type") == "vehicle"
)
```

Engine checks:

If renewal_type == vehicle → require vehicle_plate.

---

# 1️⃣1️⃣ Validation Normalization Layer

Validators should normalize.

Example:

User says:

> three years old

Validator normalizes to:

```python
3
```

This reduces downstream errors.

---

# 1️⃣2️⃣ Versioning (Important for Scale)

Add optional schema versioning.

```python
_registry: Dict[(domain, capability, version), schema]
```

If later you change requirements,
old conversations won’t break.

---

# 1️⃣3️⃣ Future-Proofing for Multi-Turn Memory

Add metadata:

```python
priority: int
```

So engine can ask higher-priority slots first.

---

# 1️⃣4️⃣ Extraction Strategy Hints

Add:

```python
extraction_hint: Optional[str]
```

Example:

```python
"Extract a 5-digit US ZIP code."
```

This improves LLM slot extraction precision.

---

# 1️⃣5️⃣ Why This Design Is Powerful

This supports:

- 50+ domains
- 20+ capabilities
- Conditional logic
- Validation
- Constraint handling
- Schema versioning
- Group reuse
- Independent extensibility

Without rewriting engine.

---

# 🎯 Important: Keep It Declarative

The registry should NEVER:

- Ask questions
- Trigger logic
- Call APIs

It only describes requirements.

Engin
