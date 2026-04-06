"""
Resolve a full address to a 5-digit ZIP (postal_code) using Google Geocoding API.
Uses GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY if set.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.parse
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

# Ensure .env is loaded when this module is used (e.g. GOOGLE_PLACES_API_KEY)
try:
    from dotenv import load_dotenv
    _root = Path(__file__).resolve().parent.parent.parent
    load_dotenv(_root / ".env")
except ImportError:
    pass


def geocode_to_zip(address: str) -> str | None:
    """
    Geocode an address string to a US 5-digit ZIP code.
    Returns the first result's postal_code, or None if not found / API unavailable.
    """
    if not address or not isinstance(address, str):
        return None
    trimmed = address.strip()
    if not trimmed:
        return None
    key = (
        os.environ.get("GOOGLE_PLACES_API_KEY") or
        os.environ.get("GOOGLE_MAPS_API_KEY") or
        ""
    ).strip()
    if not key:
        logger.warning(
            "geocode_to_zip: GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY) not set. "
            "Set it in .env and ensure Geocoding API is enabled in Google Cloud."
        )
        return None
    try:
        params = {"address": trimmed, "key": key, "region": "us"}
        url = "https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode(params)
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        logger.warning("geocode_to_zip: request failed for %r: %s", trimmed[:50], e)
        return None
    status = data.get("status")
    if status != "OK":
        logger.warning("geocode_to_zip: API status %s for %r", status, trimmed[:50])
        return None
    results = data.get("results")
    if not results:
        return None
    for comp in results[0].get("address_components", []):
        if "postal_code" in (comp.get("types") or []):
            code = (comp.get("long_name") or comp.get("short_name") or "").strip()
            digits = "".join(c for c in code if c.isdigit())
            if len(digits) >= 5:
                return digits[:5]
    logger.warning("geocode_to_zip: no postal_code in result for %r", trimmed[:50])
    return None
