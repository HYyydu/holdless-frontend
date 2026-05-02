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


def _normalize_bill_fields(data: dict[str, Any]) -> dict[str, str]:
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
        val = _safe_str(data.get(src))
        if val:
            out[dst] = val
    # Legacy single blob: split into invoice vs account when specific keys were empty
    if not out.get("invoiceNumber") and not out.get("accountNumber"):
        legacy = _safe_str(data.get("account_or_invoice_number")) or out.get("accountOrInvoiceNumber")
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


def _extract_from_image_url(image_url: str) -> dict[str, str]:
    client = get_openai_client()
    if not client:
        return {}
    prompt = (
        "Extract bill facts from this image and return JSON only with these keys: "
        "company_provider_name, bill_amount, invoice_number, account_number, bill_due_date, charge_or_service_date, billing_phone_number. "
        "Put the value labeled Invoice / Invoice number / INV in invoice_number. "
        "Put the value labeled Account / Account number / Patient account in account_number. "
        "When both exist, they must differ—do not copy the account number into invoice_number. "
        "If a field is missing, use empty string."
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
            max_tokens=300,
            response_format={"type": "json_object"},
            temperature=0,
        )
        content = completion.choices[0].message.content if completion.choices else ""
    except Exception as e:
        logger.warning("Bill image extraction failed: %s", e)
        return {}
    return _normalize_bill_fields(_extract_json_object(content or ""))


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
        "Extract bill facts from this text and return JSON only with these keys: "
        "company_provider_name, bill_amount, invoice_number, account_number, bill_due_date, charge_or_service_date, billing_phone_number. "
        "Put the value labeled Invoice / Invoice number / INV in invoice_number. "
        "Put the value labeled Account / Account number in account_number. "
        "When both exist, they must differ—do not copy the account number into invoice_number. "
        "If a field is missing, use empty string.\n\n"
        f"Bill text:\n{pdf_text}"
    )
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            response_format={"type": "json_object"},
            temperature=0,
        )
        content = completion.choices[0].message.content if completion.choices else ""
    except Exception as e:
        logger.warning("Bill PDF extraction failed: %s", e)
        return {}
    return _normalize_bill_fields(_extract_json_object(content or ""))


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
