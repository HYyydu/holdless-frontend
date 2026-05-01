"""
First-pass web search + retrieval for health insurance company phone discovery.

This service intentionally stays lightweight (stdlib only):
- uses DuckDuckGo HTML search endpoint
- fetches top result pages
- extracts US phone numbers
- ranks and deduplicates company candidates
"""
from __future__ import annotations

import html
import logging
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

_DDG_HTML_SEARCH = "https://duckduckgo.com/html/"
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)
_MAX_SEARCH_RESULTS = 10
_MAX_FETCHED_PAGES = 7
_FETCH_TIMEOUT_S = 8.0

_RESULT_LINK_RE = re.compile(
    r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
    re.IGNORECASE | re.DOTALL,
)
_TAG_RE = re.compile(r"<[^>]+>")
_PHONE_RE = re.compile(
    r"(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?)\d{3}[\s\-.]?\d{4}"
)
_INSURANCE_KEYWORD_RE = re.compile(
    r"\b(insurance|health\s+plan|member\s+services|customer\s+service|coverage|medicare)\b",
    re.IGNORECASE,
)
_MEDICAL_KEYWORD_RE = re.compile(
    r"\b(health|medical|medicare|medicaid|aca|obamacare)\b", re.IGNORECASE
)


@dataclass
class _RawResult:
    title: str
    url: str


def _fetch_text(url: str, timeout_s: float = _FETCH_TIMEOUT_S) -> str:
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"User-Agent": _USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read()
    return raw.decode("utf-8", errors="replace")


def _decode_ddg_redirect(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        q = urllib.parse.parse_qs(parsed.query)
        target = (q.get("uddg") or [""])[0].strip()
        if target:
            return urllib.parse.unquote(target)
    return url


def _search_web(query: str, *, limit: int = _MAX_SEARCH_RESULTS) -> list[_RawResult]:
    params = {"q": query}
    url = _DDG_HTML_SEARCH + "?" + urllib.parse.urlencode(params)
    try:
        body = _fetch_text(url)
    except Exception as e:
        logger.warning("Insurance web search failed: %s", e)
        return []

    out: list[_RawResult] = []
    for m in _RESULT_LINK_RE.finditer(body):
        href = html.unescape(m.group(1) or "").strip()
        title_html = m.group(2) or ""
        title = _TAG_RE.sub("", html.unescape(title_html)).strip()
        if not href or not title:
            continue
        decoded = _decode_ddg_redirect(href)
        parsed = urllib.parse.urlparse(decoded)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            continue
        out.append(_RawResult(title=title[:180], url=decoded))
        if len(out) >= max(1, int(limit)):
            break
    return out


def _normalize_e164(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def _extract_phones(text: str, *, max_count: int = 3) -> list[str]:
    seen: set[str] = set()
    phones: list[str] = []
    for m in _PHONE_RE.finditer(text or ""):
        p = _normalize_e164(m.group(0))
        if not p or p in seen:
            continue
        seen.add(p)
        phones.append(p)
        if len(phones) >= max_count:
            break
    return phones


def _clean_company_name(title: str, url: str) -> str:
    for separator in ("|", "-", ":", "—", "–"):
        if separator in title:
            left = title.split(separator)[0].strip()
            if len(left) >= 3:
                return left[:80]
    host = urllib.parse.urlparse(url).netloc.lower().replace("www.", "")
    host = host.split(":")[0]
    main = host.split(".")[0] if host else "Insurance company"
    main = main.replace("-", " ").strip()
    return " ".join(x.capitalize() for x in main.split())[:80] or "Insurance company"


def _score_result(title: str, url: str, page_text: str, has_phone: bool) -> int:
    score = 0
    merged = f"{title}\n{url}\n{page_text[:2000]}"
    if _INSURANCE_KEYWORD_RE.search(merged):
        score += 3
    if _MEDICAL_KEYWORD_RE.search(merged):
        score += 2
    if has_phone:
        score += 2
    host = urllib.parse.urlparse(url).netloc.lower()
    if host.endswith(".gov") or host.endswith(".org"):
        score += 1
    if any(k in host for k in ("health", "insurance", "aetna", "cigna", "uhc", "anthem", "kaiser")):
        score += 1
    return score


def search_health_insurance_companies(
    user_query: str,
    *,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """
    Search web and return insurance-company-like options with phones and source URLs.
    Output shape matches caller card rendering:
      name, phone, source_url, source_title, score
    """
    q = (user_query or "").strip()
    if not q:
        return []
    search_query = f"best health insurance company {q} customer service phone"
    raw = _search_web(search_query, limit=_MAX_SEARCH_RESULTS)
    if not raw:
        return []

    per_company: dict[str, dict[str, Any]] = {}
    for item in raw[:_MAX_FETCHED_PAGES]:
        try:
            page = _fetch_text(item.url)
        except Exception:
            page = ""
        phones = _extract_phones(page)
        if not phones:
            phones = _extract_phones(item.title)
        if not phones:
            continue
        company = _clean_company_name(item.title, item.url)
        score = _score_result(item.title, item.url, page, has_phone=True)
        existing = per_company.get(company.lower())
        candidate = {
            "name": company,
            "phone": phones[0],
            "source_url": item.url,
            "source_title": item.title,
            "score": score,
        }
        if existing is None or int(candidate["score"]) > int(existing.get("score") or 0):
            per_company[company.lower()] = candidate

    ranked = sorted(
        per_company.values(),
        key=lambda x: (int(x.get("score") or 0), x.get("name") or ""),
        reverse=True,
    )
    return ranked[: max(1, int(limit))]


def summarize_health_insurance_results(
    companies: list[dict[str, Any]],
    *,
    location_hint: str | None = None,
) -> str:
    """
    Lightweight deterministic summary for chat response.
    """
    if not companies:
        return "I couldn't find reliable insurance company phone results right now."
    loc = (location_hint or "").strip()
    intro = (
        f"I found health insurance companies and phone numbers{(' for ' + loc) if loc else ''}:"
    )
    lines = [intro, ""]
    for i, c in enumerate(companies, 1):
        name = str(c.get("name") or "Insurance company").strip()
        phone = str(c.get("phone") or "N/A").strip()
        title = str(c.get("source_title") or "source").strip()
        url = str(c.get("source_url") or "").strip()
        lines.append(f"{i}. {name}")
        lines.append(f"   Phone: {phone}")
        lines.append(f"   Source: {title}")
        if url:
            lines.append(f"   URL: {url}")
        lines.append("")
    lines.append("These are web-sourced and may vary by plan/state. Tap a card if you want me to call one.")
    return "\n".join(lines)

