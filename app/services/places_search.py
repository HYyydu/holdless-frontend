"""
Real veterinary / pet clinic search via Google Places (same pattern as server/index.js).

Requires in Google Cloud (same key as Geocoding):
  - Places API (Text Search)
  - Places API (Place Details) — contact fields (phone) are a separate billing SKU

Env: GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY

If the key is missing, Places errors, or no results have a dialable phone, callers should fall back
to app.services.fake_clinics.get_fake_clinics().
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv

    _root = Path(__file__).resolve().parent.parent.parent
    load_dotenv(_root / ".env")
except ImportError:
    pass

_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
# Search radius around ZIP centroid (meters). ~25 km matches “near this area”.
_RADIUS_M = 25_000
_MAX_CANDIDATES = 8  # fetch details until we have enough with phones
_RESULTS_CAP = 5


def _zip5_from_context(zip_code: str | None) -> str | None:
    """US ZIP: accept 90024 or 90024-1234 or context strings that contain a ZIP."""
    s = (zip_code or "").strip()
    if not s:
        return None
    m = re.search(r"\b(\d{5})(?:-\d{4})?\b", s)
    if m:
        return m.group(1)
    digits = re.sub(r"\D", "", s)
    return digits[:5] if len(digits) >= 5 else None


def _api_key() -> str:
    return (
        os.environ.get("GOOGLE_PLACES_API_KEY") or os.environ.get("GOOGLE_MAPS_API_KEY") or ""
    ).strip()


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 3959.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def _normalize_e164(phone: str | None) -> str | None:
    if not phone or not isinstance(phone, str):
        return None
    digits = re.sub(r"\D", "", phone.strip())
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def _fetch_json(url: str, timeout_s: float = 12.0) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _text_search(
    query: str,
    *,
    lat: float | None,
    lng: float | None,
) -> list[dict[str, Any]]:
    key = _api_key()
    if not key:
        return []
    params: dict[str, str] = {"query": query, "key": key}
    if lat is not None and lng is not None:
        params["location"] = f"{lat},{lng}"
        params["radius"] = str(_RADIUS_M)
    url = _TEXT_SEARCH_URL + "?" + urllib.parse.urlencode(params)
    try:
        data = _fetch_json(url)
    except Exception as e:
        logger.warning("Places text search failed: %s", e)
        return []
    status = data.get("status")
    if status not in ("OK", "ZERO_RESULTS"):
        logger.warning("Places text search status=%s msg=%s", status, data.get("error_message"))
        return []
    return list(data.get("results") or [])


def _place_details(place_id: str) -> dict[str, Any]:
    key = _api_key()
    if not key or not place_id:
        return {}
    params = {
        "place_id": place_id.strip(),
        "fields": "name,formatted_address,formatted_phone_number,international_phone_number",
        "key": key,
    }
    url = _DETAILS_URL + "?" + urllib.parse.urlencode(params)
    try:
        data = _fetch_json(url, timeout_s=10.0)
    except Exception as e:
        logger.warning("Place details failed for %s: %s", place_id[:20], e)
        return {}
    if data.get("status") != "OK":
        return {}
    return data.get("result") or {}


def search_veterinary_clinics_near_zip(zip5: str, *, limit: int = _RESULTS_CAP) -> list[dict[str, Any]]:
    """
    Text search + details near a US ZIP. Returns clinic-shaped dicts:
    clinic_id (place_id), name, rating, distance (mi), phone (E.164), address (optional).
    """
    z = re.sub(r"\D", "", (zip5 or "").strip())
    if len(z) >= 5:
        z = z[:5]
    else:
        return []

    if not _api_key():
        return []

    from app.services.geocode import geocode_to_lat_lng

    lat_lng = geocode_to_lat_lng(f"{z}, USA")
    if not lat_lng:
        lat_lng = geocode_to_lat_lng(z)
    if not lat_lng:
        logger.warning("Could not geocode ZIP %s for Places search", z)
        return []

    lat0, lng0 = lat_lng
    # Biased search around ZIP; query matches vet / animal hospital intent.
    raw = _text_search(
        "veterinary clinic OR animal hospital OR pet hospital",
        lat=lat0,
        lng=lng0,
    )
    if not raw:
        raw = _text_search(f"veterinary near {z}", lat=None, lng=None)

    out: list[dict[str, Any]] = []
    for p in raw[:_MAX_CANDIDATES]:
        if len(out) >= limit:
            break
        pid = p.get("place_id")
        if not pid:
            continue
        det = _place_details(pid)
        intl = det.get("international_phone_number") or det.get("formatted_phone_number")
        phone = _normalize_e164(intl)
        if not phone:
            continue
        loc = (p.get("geometry") or {}).get("location") or {}
        plat = loc.get("lat")
        plng = loc.get("lng")
        if plat is not None and plng is not None:
            dist = round(_haversine_miles(lat0, lng0, float(plat), float(plng)), 1)
        else:
            dist = 0.0
        rating = p.get("rating")
        if rating is not None:
            try:
                rating = round(float(rating), 1)
            except (TypeError, ValueError):
                rating = None
        out.append(
            {
                "clinic_id": pid,
                "place_id": pid,
                "name": p.get("name") or det.get("name") or "Veterinary clinic",
                "rating": rating if rating is not None else 0.0,
                "distance": dist,
                "phone": phone,
                "address": det.get("formatted_address") or p.get("formatted_address"),
            }
        )
    return out


def resolve_clinics_near_zip(zip_code: str | None, *, limit: int = _RESULTS_CAP) -> list[dict[str, Any]]:
    """
    Prefer real Places results for a 5-digit US ZIP; otherwise demo clinics.
    """
    from app.services.fake_clinics import get_fake_clinics

    z = _zip5_from_context(zip_code)
    if not z:
        return get_fake_clinics()
    real = search_veterinary_clinics_near_zip(z, limit=limit)
    if len(real) >= 1:
        return real
    logger.info("Using demo clinic list (Places empty or unavailable) for ZIP %s", z)
    return get_fake_clinics()
