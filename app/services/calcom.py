"""Cal.com helpers for fetching available slots and building booking links."""
from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Any

logger = logging.getLogger(__name__)

# Required for Cal.com API v2 slots endpoint (see docs / OpenAPI).
_DEFAULT_CAL_API_VERSION = "2024-09-04"


def _api_key() -> str:
    return (os.environ.get("CAL_COM_API_KEY") or "").strip()


def _event_type_id() -> str:
    return (os.environ.get("CAL_COM_EVENT_TYPE_ID") or "").strip()


def _base_url() -> str:
    return (os.environ.get("CAL_COM_API_BASE_URL") or "https://api.cal.com/v2").strip().rstrip("/")


def _cal_api_version() -> str:
    return (os.environ.get("CAL_COM_API_VERSION") or _DEFAULT_CAL_API_VERSION).strip()


def _public_booking_url() -> str:
    return (os.environ.get("CAL_COM_BOOKING_URL") or "").strip()


def calcom_env_configured() -> bool:
    """True when both API key and event type id are non-empty."""
    return bool(_api_key() and _event_type_id())


def _fetch_json(url: str, headers: dict[str, str]) -> tuple[Any, str | None]:
    req = urllib.request.Request(url, method="GET")
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return (json.loads(raw) if raw else {}, None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
        try:
            err_body = json.loads(raw) if raw else {}
            msg = str(err_body.get("message") or err_body.get("error") or raw[:300])
        except json.JSONDecodeError:
            msg = raw[:300] or f"HTTP {e.code}"
        logger.warning("Cal.com slots HTTP %s: %s", e.code, msg)
        return ({}, msg)
    except Exception as ex:
        logger.warning("Cal.com slots request failed: %s", ex, exc_info=True)
        return ({}, str(ex))


def _format_slot_label(iso_time: str, timezone_name: str) -> str:
    dt = datetime.fromisoformat(iso_time.replace("Z", "+00:00"))
    return dt.astimezone(dt_timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + f" ({timezone_name})"


def _combine_date_and_clock(
    date_str: str,
    clock: str,
    tz_name: str,
) -> str | None:
    """Build ISO timestamp from YYYY-MM-DD + 'HH:MM' or 'HH:MM:SS' in tz_name."""
    date_str = (date_str or "").strip()
    clock = (clock or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return None
    try:
        from zoneinfo import ZoneInfo

        zi = ZoneInfo(tz_name)
    except Exception:
        try:
            from zoneinfo import ZoneInfo

            zi = ZoneInfo("UTC")
        except Exception:
            return None

    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            t = datetime.strptime(clock, fmt).time()
            break
        except ValueError:
            continue
    else:
        return None
    try:
        day = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return None
    dt = datetime.combine(day, t, tzinfo=zi)
    return dt.isoformat()


def _slot_start_from_item(date_key: str, item: Any, tz_name: str) -> str | None:
    """Normalize one slot entry from Cal.com `data[date]` array to ISO start string."""
    if isinstance(item, str):
        s = item.strip()
        if not s:
            return None
        if "T" in s or s.endswith("Z"):
            return s.replace("Z", "+00:00") if s.endswith("Z") else s
        return _combine_date_and_clock(date_key, s, tz_name)

    if isinstance(item, dict):
        raw = item.get("start") or item.get("startAt") or ""
        raw_s = str(raw).strip() if raw is not None else ""
        if not raw_s:
            return None
        if "T" in raw_s or raw_s.endswith("Z"):
            return raw_s.replace("Z", "+00:00") if raw_s.endswith("Z") else raw_s
        return _combine_date_and_clock(date_key, raw_s, tz_name)

    return None


def _parse_slots_payload(data: dict[str, Any], tz_name: str, limit: int) -> list[dict[str, str]]:
    slots: list[dict[str, str]] = []
    data_obj = data.get("data") if isinstance(data, dict) else None
    if not isinstance(data_obj, dict):
        return slots

    for date_key in sorted(data_obj.keys()):
        bucket = data_obj[date_key]
        if not isinstance(bucket, list):
            continue
        for item in bucket:
            start_at = _slot_start_from_item(str(date_key), item, tz_name)
            if not start_at:
                continue
            try:
                label = _format_slot_label(start_at, tz_name)
            except Exception:
                label = start_at
            slots.append({"start_at": start_at, "label": label})
            if len(slots) >= limit:
                return slots
    return slots


def list_slots_and_booking_url(
    *, timezone: str, limit: int = 6
) -> tuple[list[dict[str, str]], str | None, str | None]:
    """
    Returns:
    - slots: [{start_at, label}]
    - booking_url: direct Cal booking URL with timezone query (if configured)
    - error: short API error message when the HTTP request failed (env may still be set)
    """
    key = _api_key()
    event_type_id = _event_type_id()
    booking_url = _public_booking_url()
    if booking_url:
        q = urllib.parse.urlencode({"timezone": timezone})
        sep = "&" if "?" in booking_url else "?"
        booking_url = f"{booking_url}{sep}{q}"

    if not key or not event_type_id:
        return [], booking_url or None, None

    today = datetime.now(dt_timezone.utc).date()
    start_q = today.isoformat()
    end_q = (today + timedelta(days=14)).isoformat()

    query = urllib.parse.urlencode(
        {
            "eventTypeId": event_type_id,
            "start": start_q,
            "end": end_q,
            "timeZone": timezone,
        }
    )
    url = f"{_base_url()}/slots?{query}"
    headers = {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "cal-api-version": _cal_api_version(),
        # Cal.com's Cloudflare can block default Python urllib signatures.
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
    }
    payload, err = _fetch_json(url, headers=headers)
    if err:
        return [], booking_url or None, err

    slots = _parse_slots_payload(payload if isinstance(payload, dict) else {}, timezone, limit)
    return slots, booking_url or None, None
