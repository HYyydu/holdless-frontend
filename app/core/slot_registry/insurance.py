"""Insurance domain slot schemas (billing dispute complaint)."""
from __future__ import annotations

from app.core.slot_registry.base_models import SlotDefinition, SlotType
from app.core.slot_registry.validators import validate_phone


INSURANCE_BILL_DISPUTE: list[SlotDefinition] = [
    SlotDefinition(
        name="phone",
        description="Phone number to call for billing dispute",
        type=SlotType.PHONE,
        required=True,
        validator=validate_phone,
        prompt="What's the billing/customer service phone number to call? (10-digit US number)",
    ),
    SlotDefinition(
        name="company_provider_name",
        description="Insurance company or provider name shown on the bill",
        type=SlotType.STRING,
        required=True,
        prompt="What's the company/provider name on the bill? (Or upload the bill photo/PDF directly.)",
    ),
    SlotDefinition(
        name="bill_amount",
        description="Bill amount being disputed",
        type=SlotType.STRING,
        required=True,
        prompt="What's the bill amount you're disputing?",
    ),
    SlotDefinition(
        name="account_or_invoice_number",
        description="Account number or invoice number on the bill",
        type=SlotType.STRING,
        required=True,
        prompt="What's the account number or invoice number on the bill?",
    ),
    SlotDefinition(
        name="bill_due_date",
        description="Bill due date",
        type=SlotType.STRING,
        required=True,
        prompt="What's the bill due date?",
    ),
    SlotDefinition(
        name="charge_or_service_date",
        description="Date of charge or service",
        type=SlotType.STRING,
        required=True,
        prompt="What's the charge/service date?",
    ),
    SlotDefinition(
        name="desired_outcome",
        description="What outcome the user wants from this dispute call",
        type=SlotType.STRING,
        required=True,
        prompt="What is your desired outcome for this dispute? (e.g. remove incorrect ER charge, reprocess claim, waive late fee)",
    ),
    SlotDefinition(
        name="bill_upload",
        description="Bill attachment uploaded as photo or PDF",
        type=SlotType.BOOLEAN,
        required=False,
        prompt="You can also upload the bill directly (photo/PDF), and I can use that instead of typing each field.",
    ),
]
