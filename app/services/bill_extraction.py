"""OCR + structured bill fact extraction from task attachments."""
from __future__ import annotations

import json
import logging
import re
from io import BytesIO
from typing import Any

from app.db.supabase_client import get_supabase
from app.services.openai_client import get_openai_client

logger = logging.getLogger(__name__)

_TASK_ATTACHMENT_BUCKET = "task-attachments"
_MAX_TEXT_CHARS = 20_000
_SUPPORTED_IMAGE_PREFIX = "image/"
_SUPPORTED_PDF = "application/pdf"


def _safe_str(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _extract_json_object(text: str) -> dict[str, Any]:
    """Parse first JSON object from model output."""
    raw = (text or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    m = re.search(r"\{.*\}", raw, flags=re.DOTALL)
    if not m:
        return {}
    try:
        data = json.loads(m.group(0))
        if isinstance(data, dict):
            return data
    except Exception:
        return {}
    return {}


_INSURANCE_DOCUMENT_TYPES = frozenset(
    {"insurance", "insurance_card", "certificate_of_coverage", "insurance_document"}
)


def _normalize_insurance_fields(data: dict[str, Any]) -> dict[str, str]:
    """Map model JSON to client insurance/member field names."""
    raw: dict[str, Any] = dict(data) if isinstance(data, dict) else {}
    for snake, camel in (
        ("document_type", "documentType"),
        ("member_name", "memberName"),
        ("member_id", "memberId"),
        ("date_of_birth", "dateOfBirth"),
        ("member_phone_number", "memberPhoneNumber"),
        ("member_email", "memberEmail"),
        ("member_address", "memberAddress"),
        ("insurance_company_name", "insuranceCompanyName"),
        ("insurance_phone_number", "insurancePhoneNumber"),
    ):
        if not _safe_str(raw.get(snake)) and _safe_str(raw.get(camel)):
            raw[snake] = raw[camel]

    out: dict[str, str] = {}
    doc_type = (_safe_str(raw.get("document_type")) or "").lower().replace("-", "_")
    if doc_type in _INSURANCE_DOCUMENT_TYPES:
        out["documentType"] = "insurance"
    elif doc_type in ("medical_bill", "bill"):
        out["documentType"] = "medical_bill"
    elif doc_type:
        out["documentType"] = doc_type

    mapping = {
        "member_name": "memberName",
        "member_id": "memberId",
        "date_of_birth": "dateOfBirth",
        "member_phone_number": "memberPhoneNumber",
        "member_email": "memberEmail",
        "member_address": "memberAddress",
        "insurance_company_name": "insuranceCompanyName",
        "insurance_phone_number": "insurancePhoneNumber",
    }
    for src, dst in mapping.items():
        val = _safe_str(raw.get(src))
        if val:
            out[dst] = val
    return out


def _normalize_bill_fields(data: dict[str, Any]) -> dict[str, str]:
    """Map model JSON to client field names. Accepts snake_case (prompt) or camelCase drift."""
    raw: dict[str, Any] = dict(data) if isinstance(data, dict) else {}
    for snake, camel in (
        ("company_provider_name", "companyProviderName"),
        ("bill_amount", "billAmount"),
        ("invoice_number", "invoiceNumber"),
        ("account_number", "accountNumber"),
        ("account_or_invoice_number", "accountOrInvoiceNumber"),
        ("bill_due_date", "billDueDate"),
        ("charge_or_service_date", "chargeOrServiceDate"),
        ("billing_phone_number", "billingPhoneNumber"),
    ):
        if not _safe_str(raw.get(snake)) and _safe_str(raw.get(camel)):
            raw[snake] = raw[camel]

    out: dict[str, str] = {}
    mapping = {
        "company_provider_name": "companyProviderName",
        "bill_amount": "billAmount",
        "invoice_number": "invoiceNumber",
        "account_number": "accountNumber",
        "account_or_invoice_number": "accountOrInvoiceNumber",
        "bill_due_date": "billDueDate",
        "charge_or_service_date": "chargeOrServiceDate",
        "billing_phone_number": "billingPhoneNumber",
    }
    for src, dst in mapping.items():
        val = _safe_str(raw.get(src))
        if val:
            out[dst] = val
    # Legacy single blob: split into invoice vs account when specific keys were empty
    if not out.get("invoiceNumber") and not out.get("accountNumber"):
        legacy = (
            _safe_str(raw.get("account_or_invoice_number"))
            or _safe_str(raw.get("accountOrInvoiceNumber"))
            or out.get("accountOrInvoiceNumber")
        )
        if legacy:
            if re.search(r"\binv(?:oice)?[\s_#:-]", legacy, re.IGNORECASE) or re.match(
                r"^INV[_\-]?\d", legacy, re.IGNORECASE
            ):
                out["invoiceNumber"] = legacy
            else:
                out["accountNumber"] = legacy
    inv = out.get("invoiceNumber") or ""
    acct = out.get("accountNumber") or ""
    if inv and acct:
        out.pop("accountOrInvoiceNumber", None)
    elif inv or acct:
        out["accountOrInvoiceNumber"] = inv or acct
    return out


def _signed_url_from_response(signed: Any) -> str | None:
    """Support both Supabase response key variants across SDK versions."""
    if not isinstance(signed, dict):
        return None
    return _safe_str(signed.get("signedURL")) or _safe_str(signed.get("signedUrl"))


def _merge_extraction_fields(*parts: dict[str, str]) -> dict[str, str]:
    merged: dict[str, str] = {}
    for part in parts:
        for key, value in part.items():
            if value and not merged.get(key):
                merged[key] = value
    return merged


def _extract_from_image_url(image_url: str) -> dict[str, str]:
    client = get_openai_client()
    if not client:
        return {}
    prompt = (
        "Classify this document and extract facts. Return JSON only with these keys:\n"
        "document_type: one of medical_bill, insurance_card, certificate_of_coverage, or unknown.\n"
        "For medical bills: company_provider_name, bill_amount, invoice_number, account_number, "
        "bill_due_date, charge_or_service_date, billing_phone_number.\n"
        "For insurance cards / certificates of coverage: member_name (policyholder/member name), "
        "member_id (member ID / subscriber ID), date_of_birth, member_phone_number (policyholder phone only), "
        "member_email (policyholder email only), member_address (policyholder home/mailing address only), "
        "insurance_company_name, insurance_phone_number (member services / eligibility / customer service).\n"
        "Rules:\n"
        "- Put Invoice / INV labels in invoice_number; Account / Patient account in account_number.\n"
        "- Do not copy account number into invoice_number when both exist.\n"
        "- For billing_phone_number prefer patient billing / customer service over hospital switchboard.\n"
        "- For insurance docs, only fill member_phone_number/member_email/member_address if clearly the policyholder's.\n"
        "- Use empty string for missing or unreadable fields."
    )
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                }
            ],
            max_tokens=400,
            response_format={"type": "json_object"},
            temperature=0,
        )
        content = completion.choices[0].message.content if completion.choices else ""
    except Exception as e:
        logger.warning("Bill image extraction failed: %s", e)
        return {}
    parsed = _extract_json_object(content or "")
    doc_type = (_safe_str(parsed.get("document_type")) or "").lower()
    insurance_types = {"insurance_card", "certificate_of_coverage", "insurance", "insurance_document"}
    if doc_type in insurance_types or doc_type.startswith("insurance"):
        return _merge_extraction_fields(
            _normalize_insurance_fields(parsed),
            _normalize_bill_fields(parsed),
        )
    return _merge_extraction_fields(
        _normalize_bill_fields(parsed),
        _normalize_insurance_fields(parsed),
    )


def _extract_from_pdf_bytes(blob: bytes) -> dict[str, str]:
    client = get_openai_client()
    if not client:
        return {}
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(blob))
        text_chunks: list[str] = []
        for page in reader.pages[:5]:
            extracted = (page.extract_text() or "").strip()
            if extracted:
                text_chunks.append(extracted)
        pdf_text = "\n\n".join(text_chunks).strip()[:_MAX_TEXT_CHARS]
    except Exception as e:
        logger.warning("PDF parse failed: %s", e)
        return {}
    if not pdf_text:
        return {}
    prompt = (
        "Classify this document and extract facts. Return JSON only with these keys:\n"
        "document_type: one of medical_bill, insurance_card, certificate_of_coverage, or unknown.\n"
        "For medical bills: company_provider_name, bill_amount, invoice_number, account_number, "
        "bill_due_date, charge_or_service_date, billing_phone_number.\n"
        "For insurance cards / certificates of coverage: member_name, member_id, date_of_birth, "
        "member_phone_number, member_email, member_address, insurance_company_name, insurance_phone_number.\n"
        "Use empty string for missing fields.\n\n"
        f"Document text:\n{pdf_text}"
    )
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
            response_format={"type": "json_object"},
            temperature=0,
        )
        content = completion.choices[0].message.content if completion.choices else ""
    except Exception as e:
        logger.warning("Bill PDF extraction failed: %s", e)
        return {}
    parsed = _extract_json_object(content or "")
    doc_type = (_safe_str(parsed.get("document_type")) or "").lower()
    insurance_types = {"insurance_card", "certificate_of_coverage", "insurance", "insurance_document"}
    if doc_type in insurance_types or doc_type.startswith("insurance"):
        return _merge_extraction_fields(
            _normalize_insurance_fields(parsed),
            _normalize_bill_fields(parsed),
        )
    return _merge_extraction_fields(
        _normalize_bill_fields(parsed),
        _normalize_insurance_fields(parsed),
    )


def extract_bill_fields_from_attachments(attachments: list[dict[str, Any]]) -> dict[str, str]:
    """Extract bill fields from uploaded image/PDF attachments."""
    supabase = get_supabase()
    merged: dict[str, str] = {}

    for attachment in attachments:
        path = _safe_str(attachment.get("path"))
        content_type = _safe_str(attachment.get("contentType")) or ""
        if not path:
            continue

        extracted: dict[str, str] = {}
        try:
            if content_type.startswith(_SUPPORTED_IMAGE_PREFIX):
                signed = supabase.storage.from_(_TASK_ATTACHMENT_BUCKET).create_signed_url(
                    path,
                    60,
                )
                signed_url = _signed_url_from_response(signed)
                if signed_url:
                    extracted = _extract_from_image_url(signed_url)
            elif content_type == _SUPPORTED_PDF:
                blob = supabase.storage.from_(_TASK_ATTACHMENT_BUCKET).download(path)
                if isinstance(blob, bytes):
                    extracted = _extract_from_pdf_bytes(blob)
        except Exception as e:
            logger.warning("Attachment extraction failed for %s: %s", path, e)
            continue

        for key, value in extracted.items():
            if value and not merged.get(key):
                merged[key] = value

    return merged
