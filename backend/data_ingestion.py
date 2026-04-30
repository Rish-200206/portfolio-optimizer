"""
data_ingestion.py
-----------------
Fetches historical daily close prices for portfolio tickers via yfinance and
manages a local parquet cache to minimise network calls.

Public API
----------
fetch_ticker_prices(ticker, force_refresh)  → pd.Series | None
fetch_portfolio_prices(tickers, force_refresh) → pd.DataFrame
get_holdings_tickers(portfolio_id, db)      → list[str]
upsert_prices_to_db(prices, db)             → int
refresh_portfolio_prices(portfolio_id, db)  → pd.DataFrame

Cache strategy
--------------
Each ticker's 1-year history is stored as ``price_cache/<TICKER>.parquet``
(dots in the ticker are replaced with underscores, e.g. RELIANCE_NS.parquet).
The cache is considered fresh for ``CACHE_TTL_HOURS``; stale or missing files
trigger a live yfinance fetch.  If the live fetch fails, the stale cache is
used as a fallback so the application degrades gracefully with no network.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import duckdb
import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

#: Directory where per-ticker parquet files are stored.
CACHE_DIR: Path = Path(__file__).parent / "price_cache"

#: Number of hours before a cached file is considered stale.
CACHE_TTL_HOURS: int = 12

#: yfinance period string for the historical window to fetch.
HISTORY_PERIOD: str = "1y"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _cache_path(ticker: str) -> Path:
    """Return the filesystem path for a ticker's parquet cache file.

    Dots in the ticker symbol are replaced with underscores so that
    international tickers like ``RELIANCE.NS`` produce valid filenames.

    Parameters
    ----------
    ticker:
        Normalised (uppercase) ticker symbol, e.g. ``"AAPL"`` or ``"RELIANCE.NS"``.

    Returns
    -------
    Path
        Absolute path to the ``.parquet`` cache file for this ticker.
    """
    safe_name = ticker.replace(".", "_")
    return CACHE_DIR / f"{safe_name}.parquet"


def _is_cache_fresh(path: Path) -> bool:
    """Return ``True`` if the file exists and was modified within ``CACHE_TTL_HOURS``.

    Parameters
    ----------
    path:
        Filesystem path to the cache file.
    """
    if not path.exists():
        return False
    age = datetime.now() - datetime.fromtimestamp(path.stat().st_mtime)
    return age < timedelta(hours=CACHE_TTL_HOURS)


def _read_cache(path: Path) -> Optional[pd.Series]:
    """Load a ticker's close-price Series from its parquet cache file.

    Parameters
    ----------
    path:
        Absolute path to the cached ``.parquet`` file.

    Returns
    -------
    pd.Series | None
        A Series indexed by ``pd.DatetimeIndex`` with ``float`` values,
        or ``None`` if the file is missing or corrupt.
    """
    try:
        df = pd.read_parquet(path)
        series = df["close_price"]
        series.index = pd.to_datetime(series.index)
        return series
    except Exception as exc:
        logger.warning("Failed to read cache file '%s': %s", path, exc)
        return None


def _write_cache(path: Path, series: pd.Series) -> None:
    """Persist a close-price Series to a parquet file.

    Parameters
    ----------
    path:
        Target file path (parent directory must exist).
    series:
        DatetimeIndex → float Series of daily close prices.
    """
    try:
        df = pd.DataFrame({"close_price": series})
        df.index.name = "price_date"
        df.to_parquet(path)
    except Exception as exc:
        logger.warning("Failed to write cache file '%s': %s", path, exc)


def _fetch_from_yfinance(ticker: str) -> Optional[pd.Series]:
    """Download ``HISTORY_PERIOD`` of daily close prices for one ticker.

    Uses ``yf.Ticker.history()`` which consistently returns a simple
    (non-MultiIndex) DataFrame regardless of yfinance version.  The ``Close``
    column is selected and the resulting Series is forward-filled to cover any
    non-trading-day gaps.

    Edge cases handled
    ------------------
    - Empty DataFrame (delisted / invalid ticker) → logs warning, returns None.
    - Exception during download → logs error, returns None.
    - International suffixes (.NS, .L, etc.) are transparently supported by
      yfinance and require no pre-processing on our side.

    Parameters
    ----------
    ticker:
        Normalised (uppercase) ticker symbol.

    Returns
    -------
    pd.Series | None
        DatetimeIndex → float Series of adjusted close prices with no NaNs,
        or ``None`` if the fetch failed.
    """
    try:
        ticker_obj = yf.Ticker(ticker)
        data: pd.DataFrame = ticker_obj.history(
            period=HISTORY_PERIOD,
            auto_adjust=True,
            raise_errors=False,
        )

        if data.empty:
            logger.warning("yfinance returned an empty DataFrame for ticker '%s'.", ticker)
            return None

        if "Close" not in data.columns:
            logger.warning(
                "No 'Close' column in yfinance response for ticker '%s'. "
                "Available columns: %s",
                ticker,
                data.columns.tolist(),
            )
            return None

        close: pd.Series = data["Close"].copy()

        # Normalise timezone: strip tz info so the index is tz-naive.
        if close.index.tz is not None:
            close.index = close.index.tz_localize(None)

        # Forward-fill any interior NaN values (e.g. public holidays in one
        # exchange that are trading days in another).
        close = close.ffill()

        if close.isna().all():
            logger.warning("All close prices are NaN for ticker '%s' after ffill.", ticker)
            return None

        # Drop any remaining NaN at the leading edge (before first trade).
        close = close.dropna()
        return close

    except Exception as exc:
        logger.error("Exception fetching data for ticker '%s': %s", ticker, exc)
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def fetch_ticker_prices(
    ticker: str,
    force_refresh: bool = False,
) -> Optional[pd.Series]:
    """Return 1-year daily close prices for a single ticker.

    The result is retrieved from the local parquet cache when the cached file
    is fresh (< ``CACHE_TTL_HOURS`` old).  On a cache miss, stale cache, or
    ``force_refresh=True``, a live fetch from yfinance is attempted.  If the
    live fetch fails and a stale cache exists, the stale data is returned as a
    fallback rather than raising an error.

    Parameters
    ----------
    ticker:
        Ticker symbol (case-insensitive; normalised to uppercase internally).
    force_refresh:
        When ``True``, skip the freshness check and always call yfinance.

    Returns
    -------
    pd.Series | None
        DatetimeIndex (tz-naive) → float close prices, or ``None`` if no data
        could be obtained from either the cache or yfinance.
    """
    ticker = ticker.strip().upper()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = _cache_path(ticker)

    # ── Cache hit ──────────────────────────────────────────────────────────
    if not force_refresh and _is_cache_fresh(cache_file):
        cached = _read_cache(cache_file)
        if cached is not None:
            logger.debug("Cache hit for '%s'.", ticker)
            return cached

    # ── Live fetch ─────────────────────────────────────────────────────────
    logger.info("Fetching live data for '%s' from yfinance.", ticker)
    fresh = _fetch_from_yfinance(ticker)

    if fresh is not None:
        _write_cache(cache_file, fresh)
        return fresh

    # ── Stale fallback ─────────────────────────────────────────────────────
    if cache_file.exists():
        logger.warning(
            "Live fetch failed for '%s'; falling back to stale cache.", ticker
        )
        return _read_cache(cache_file)

    logger.error("No price data available for ticker '%s'.", ticker)
    return None


def fetch_portfolio_prices(
    tickers: list[str],
    force_refresh: bool = False,
) -> pd.DataFrame:
    """Fetch 1-year daily close prices for a list of tickers.

    Calls :func:`fetch_ticker_prices` for each ticker sequentially and aligns
    the resulting Series into a single DataFrame indexed by date.  Tickers for
    which no data could be obtained are excluded with a warning.  Any residual
    NaN cells introduced by mismatched trading calendars are forward-filled
    on the combined DataFrame.

    Parameters
    ----------
    tickers:
        List of ticker symbols (may include international suffixes).
    force_refresh:
        Passed through to :func:`fetch_ticker_prices` for each ticker.

    Returns
    -------
    pd.DataFrame
        DatetimeIndex × ticker columns of adjusted close prices.
        Returns an empty DataFrame if no tickers yielded data.
    """
    series_map: dict[str, pd.Series] = {}

    for ticker in tickers:
        series = fetch_ticker_prices(ticker, force_refresh=force_refresh)
        if series is not None:
            series_map[ticker] = series
        else:
            logger.warning("Excluding ticker '%s' from portfolio prices (no data).", ticker)

    if not series_map:
        logger.warning("No price data fetched for any of the requested tickers: %s", tickers)
        return pd.DataFrame()

    prices = pd.DataFrame(series_map)

    # Forward-fill cross-ticker calendar gaps (e.g. US holiday vs IN holiday).
    prices = prices.ffill()

    return prices


def get_holdings_tickers(
    portfolio_id: str,
    db: duckdb.DuckDBPyConnection,
) -> list[str]:
    """Return all ticker symbols held in a portfolio, sorted alphabetically.

    Parameters
    ----------
    portfolio_id:
        Identifier of the target portfolio.
    db:
        Active DuckDB connection (injected via FastAPI dependency).

    Returns
    -------
    list[str]
        Sorted list of uppercase ticker symbols, e.g. ``["AAPL", "RELIANCE.NS"]``.
    """
    rows = db.execute(
        "SELECT ticker FROM holdings WHERE portfolio_id = ? ORDER BY ticker",
        [portfolio_id],
    ).fetchall()
    return [row[0] for row in rows]


def upsert_prices_to_db(
    prices: pd.DataFrame,
    db: duckdb.DuckDBPyConnection,
) -> int:
    """Bulk-upsert a prices DataFrame into the ``daily_prices`` DuckDB table.

    Each (ticker, date) pair is inserted or replaced, making this call
    idempotent — safe to run on every refresh without creating duplicates.

    Parameters
    ----------
    prices:
        DatetimeIndex × ticker-column DataFrame of close prices as returned
        by :func:`fetch_portfolio_prices`.
    db:
        Active DuckDB connection with write access.

    Returns
    -------
    int
        Total number of rows upserted across all tickers.
    """
    if prices.empty:
        return 0

    records: list[tuple[str, str, float]] = []

    for ticker in prices.columns:
        series = prices[ticker].dropna()
        for date_idx, close_val in series.items():
            # Normalise the index entry to a plain ``date`` string for DuckDB.
            price_date: str = (
                date_idx.date().isoformat()
                if hasattr(date_idx, "date")
                else str(date_idx)[:10]
            )
            records.append((ticker, price_date, float(close_val)))

    if not records:
        return 0

    # Batch upsert via executemany for performance.
    db.executemany(
        """
        INSERT OR REPLACE INTO daily_prices (ticker, price_date, close_price)
        VALUES (?, ?, ?)
        """,
        records,
    )
    db.commit()

    logger.info("Upserted %d price rows into daily_prices.", len(records))
    return len(records)


def refresh_portfolio_prices(
    portfolio_id: str,
    db: duckdb.DuckDBPyConnection,
    force_refresh: bool = False,
) -> pd.DataFrame:
    """Orchestrate a full price refresh for a portfolio.

    Steps
    -----
    1. Query ``holdings`` for all distinct tickers in the portfolio.
    2. Fetch prices for each ticker (cache-aware).
    3. Upsert the fetched prices into ``daily_prices``.
    4. Return the aligned prices DataFrame for immediate downstream use
       (e.g. the quant engine) without requiring an extra DB round-trip.

    Parameters
    ----------
    portfolio_id:
        Identifier of the target portfolio.
    db:
        Active DuckDB connection (read + write).
    force_refresh:
        When ``True``, bypass the parquet cache and re-fetch from yfinance.

    Returns
    -------
    pd.DataFrame
        DatetimeIndex × ticker-column DataFrame of adjusted close prices.
        Returns an empty DataFrame if the portfolio has no holdings or no
        price data could be fetched.
    """
    tickers = get_holdings_tickers(portfolio_id, db)

    if not tickers:
        logger.warning(
            "Portfolio '%s' has no holdings; skipping price refresh.", portfolio_id
        )
        return pd.DataFrame()

    logger.info(
        "Refreshing prices for portfolio '%s': %d tickers.", portfolio_id, len(tickers)
    )

    prices = fetch_portfolio_prices(tickers, force_refresh=force_refresh)

    if prices.empty:
        logger.warning(
            "No price data could be fetched for portfolio '%s'.", portfolio_id
        )
        return pd.DataFrame()

    upserted = upsert_prices_to_db(prices, db)
    logger.info(
        "Price refresh complete for portfolio '%s': %d rows upserted.",
        portfolio_id,
        upserted,
    )

    return prices


def load_prices_from_db(
    tickers: list[str],
    db: duckdb.DuckDBPyConnection,
) -> pd.DataFrame:
    """Load stored close prices from ``daily_prices`` for a set of tickers.

    Used by the quant engine to read prices without triggering a network call.
    Returns data already in DuckDB; call :func:`refresh_portfolio_prices` first
    if the prices may be stale.

    Parameters
    ----------
    tickers:
        List of ticker symbols to load.
    db:
        Active DuckDB connection (read-only access is sufficient).

    Returns
    -------
    pd.DataFrame
        DatetimeIndex × ticker-column DataFrame of close prices.
        Columns for tickers with no stored data are absent (not NaN-filled).
    """
    if not tickers:
        return pd.DataFrame()

    placeholders = ", ".join("?" * len(tickers))
    rows = db.execute(
        f"""
        SELECT ticker, price_date, close_price
        FROM   daily_prices
        WHERE  ticker IN ({placeholders})
        ORDER  BY price_date
        """,
        tickers,
    ).fetchall()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["ticker", "price_date", "close_price"])
    prices = df.pivot(index="price_date", columns="ticker", values="close_price")
    prices.index = pd.to_datetime(prices.index)
    prices.sort_index(inplace=True)
    return prices
