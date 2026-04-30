"""
ticker_search.py
----------------
Manages a local CSV of tradeable tickers used to power the search dropdown.

Sources
-------
- NSE India equities  : https://archives.nseindia.com/content/equities/EQUITY_L.csv
- BSE India equities  : https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w
- Yahoo Finance API   : fallback for any exchange not covered by local CSV

File layout
-----------
backend/tickers.csv   – persisted to disk, git-ignored, refreshed weekly.

CSV columns: symbol, name, exchange

Usage
-----
    from .ticker_search import init_tickers, search_tickers, refresh_tickers

    await init_tickers()              # call once on startup
    results = search_tickers("JSW")   # fast in-memory search
    await refresh_tickers()           # force-refresh from upstream sources
"""

from __future__ import annotations

import csv
import io
import logging
import time
from pathlib import Path
from typing import TypedDict

import httpx

logger = logging.getLogger(__name__)

TICKERS_CSV = Path(__file__).parent / "tickers.csv"
CACHE_TTL_SECONDS = 7 * 24 * 3600   # refresh once a week

NSE_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"
BSE_URL = "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Type=0&Grp=&Cat=&scripnm="

# In-memory list loaded once per process
_cache: list[dict] = []


class TickerRow(TypedDict):
    symbol: str
    name: str
    exchange: str




async def _fetch_nse() -> list[TickerRow]:
    """Download NSE equity list and return normalised rows."""
    rows: list[TickerRow] = []
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(NSE_URL, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
        reader = csv.DictReader(io.StringIO(resp.text))
        for row in reader:
            sym = row.get("SYMBOL", "").strip()
            name = row.get("NAME OF COMPANY", "").strip()
            if sym and name:
                rows.append({"symbol": f"{sym}.NS", "name": name, "exchange": "NSE"})
    except Exception as exc:
        logger.warning("NSE ticker fetch failed: %s", exc)
    return rows


async def _fetch_bse() -> list[TickerRow]:
    """Download BSE equity list and return normalised rows."""
    rows: list[TickerRow] = []
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(BSE_URL, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
        data = resp.json()
        for item in data.get("Table", []):
            scrip_cd = str(item.get("SCRIP_CD", "")).strip()
            name = item.get("Scrip_Name", "").strip()
            if scrip_cd and name:
                rows.append({"symbol": f"{scrip_cd}.BO", "name": name, "exchange": "BSE"})
    except Exception as exc:
        logger.warning("BSE ticker fetch failed: %s", exc)
    return rows




def _save_csv(rows: list[TickerRow]) -> None:
    with TICKERS_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["symbol", "name", "exchange"])
        writer.writeheader()
        writer.writerows(rows)


def _load_csv() -> list[dict]:
    if not TICKERS_CSV.exists():
        return []
    with TICKERS_CSV.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _is_stale() -> bool:
    if not TICKERS_CSV.exists():
        return True
    return (time.time() - TICKERS_CSV.stat().st_mtime) > CACHE_TTL_SECONDS




async def refresh_tickers() -> int:
    """Download fresh NSE + BSE ticker lists, persist to CSV, reload in-memory cache.

    Returns the total number of tickers stored.
    """
    global _cache
    logger.info("Refreshing ticker list from NSE + BSE…")

    nse_rows, bse_rows = await _fetch_nse(), await _fetch_bse()
    combined = nse_rows + bse_rows

    # Deduplicate by symbol, keeping first occurrence
    seen: set[str] = set()
    unique: list[TickerRow] = []
    for row in combined:
        if row["symbol"] not in seen:
            seen.add(row["symbol"])
            unique.append(row)

    if unique:
        _save_csv(unique)
        _cache = unique
        logger.info("Ticker list refreshed: %d tickers stored.", len(unique))
    else:
        logger.warning("Ticker refresh returned 0 rows — keeping existing CSV.")

    return len(_cache)


async def init_tickers() -> None:
    """Called once on startup.  Loads from disk if fresh; fetches if stale or absent."""
    global _cache
    if _is_stale():
        await refresh_tickers()
    else:
        _cache = _load_csv()
        logger.info("Ticker list loaded from cache: %d tickers.", len(_cache))


def search_local(query: str, limit: int = 15) -> list[dict]:
    """Fast in-memory search across symbol and company name.

    Ranking: exact-prefix symbol matches first, then name-contains matches.
    """
    q = query.upper().strip()
    if not q:
        return []

    sym_prefix: list[dict] = []
    name_contains: list[dict] = []

    for row in _cache:
        sym_bare = row["symbol"].upper().split(".")[0]   # "JSWSTEEL" from "JSWSTEEL.NS"
        sym_full = row["symbol"].upper()                 # "JSWSTEEL.NS"
        name_up  = row["name"].upper()

        if sym_bare.startswith(q) or sym_full.startswith(q):
            sym_prefix.append(row)
        elif q in name_up:
            name_contains.append(row)

        if len(sym_prefix) + len(name_contains) >= limit * 2:
            break   # early exit once we have enough candidates

    merged = sym_prefix + name_contains
    return [
        {
            "symbol":   r["symbol"],
            "name":     r["name"],
            "exchange": r["exchange"],
            "type":     "EQUITY",
        }
        for r in merged[:limit]
    ]


async def search_yahoo(query: str, limit: int = 8) -> list[dict]:
    """Call Yahoo Finance autocomplete as a fallback for non-Indian tickers."""
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                "https://query2.finance.yahoo.com/v1/finance/search",
                params={"q": query, "quotesCount": limit, "newsCount": 0},
            )
            resp.raise_for_status()
        quotes = resp.json().get("quotes", [])
    except Exception:
        return []

    allowed = {"EQUITY", "ETF", "MUTUALFUND"}
    return [
        {
            "symbol":   q["symbol"],
            "name":     q.get("shortname") or q.get("longname") or q["symbol"],
            "exchange": q.get("exchDisp") or q.get("exchange", ""),
            "type":     q.get("quoteType", ""),
        }
        for q in quotes
        if q.get("quoteType") in allowed
    ]
