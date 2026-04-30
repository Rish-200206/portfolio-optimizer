from __future__ import annotations

import logging
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import duckdb
import pandas as pd
import yfinance as yf

from .models import Fundamentals, NewsItem

logger = logging.getLogger(__name__)

CACHE_DIR: Path = Path(__file__).parent / "price_cache"
CACHE_TTL_HOURS: int = 12
METADATA_TTL_HOURS: int = 24
HISTORY_PERIOD: str = "max"


def _cache_path(ticker: str) -> Path:
    # dots → underscores so RELIANCE.NS becomes a valid filename
    return CACHE_DIR / f"{ticker.replace('.', '_')}.parquet"


def _is_cache_fresh(path: Path) -> bool:
    if not path.exists():
        return False
    age = datetime.now() - datetime.fromtimestamp(path.stat().st_mtime)
    return age < timedelta(hours=CACHE_TTL_HOURS)


def _read_cache(path: Path) -> Optional[pd.Series]:
    try:
        df = pd.read_parquet(path)
        series = df["close_price"]
        series.index = pd.to_datetime(series.index)
        return series
    except Exception as exc:
        logger.warning("Failed to read cache '%s': %s", path, exc)
        return None


def _write_cache(path: Path, series: pd.Series) -> None:
    try:
        df = pd.DataFrame({"close_price": series})
        df.index.name = "price_date"
        df.to_parquet(path)
    except Exception as exc:
        logger.warning("Failed to write cache '%s': %s", path, exc)


def _fetch_from_yfinance(ticker: str) -> Optional[pd.Series]:
    try:
        data: pd.DataFrame = yf.Ticker(ticker).history(
            period=HISTORY_PERIOD, auto_adjust=True, raise_errors=False,
        )
        if data.empty:
            logger.warning("yfinance returned empty DataFrame for '%s'.", ticker)
            return None
        if "Close" not in data.columns:
            logger.warning("No 'Close' column in yfinance response for '%s'.", ticker)
            return None

        close: pd.Series = data["Close"].copy()
        if close.index.tz is not None:
            close.index = close.index.tz_localize(None)
        close = close.ffill().dropna()

        if close.empty:
            logger.warning("All prices are NaN for '%s' after ffill.", ticker)
            return None
        return close

    except Exception as exc:
        logger.error("Exception fetching '%s': %s", ticker, exc)
        return None


def fetch_ticker_prices(ticker: str, force_refresh: bool = False) -> Optional[pd.Series]:
    ticker = ticker.strip().upper()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = _cache_path(ticker)

    if not force_refresh and _is_cache_fresh(cache_file):
        cached = _read_cache(cache_file)
        if cached is not None:
            return cached

    logger.info("Fetching live data for '%s'.", ticker)
    fresh = _fetch_from_yfinance(ticker)
    if fresh is not None:
        _write_cache(cache_file, fresh)
        return fresh

    # stale cache is better than nothing
    if cache_file.exists():
        logger.warning("Live fetch failed for '%s', falling back to stale cache.", ticker)
        return _read_cache(cache_file)

    logger.error("No price data available for '%s'.", ticker)
    return None


def _metadata_cache_path(ticker: str) -> Path:
    return CACHE_DIR / f"{ticker.replace('.', '_')}_metadata.json"


def fetch_ticker_metadata(
    ticker: str,
    force_refresh: bool = False,
) -> tuple[Fundamentals | None, list[NewsItem]]:
    """Fetch fundamentals and recent news for a ticker, with a 24h JSON cache."""
    ticker = ticker.strip().upper()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = _metadata_cache_path(ticker)

    if not force_refresh and cache_file.exists():
        age = datetime.now() - datetime.fromtimestamp(cache_file.stat().st_mtime)
        if age < timedelta(hours=METADATA_TTL_HOURS):
            try:
                with open(cache_file, "r") as f:
                    data = json.load(f)
                fund = Fundamentals(**data["fundamentals"]) if data.get("fundamentals") else None
                news = [NewsItem(**n) for n in data.get("news", [])]
                return fund, news
            except Exception as e:
                logger.warning("Failed to read metadata cache for '%s': %s", ticker, e)

    logger.info("Fetching live metadata for '%s'.", ticker)
    try:
        t_obj = yf.Ticker(ticker)
        info = t_obj.info or {}

        recent_split_date = None
        recent_split_factor = None
        last_split_ts = info.get("lastSplitDate")
        last_split_str = info.get("lastSplitFactor")
        if last_split_ts:
            try:
                split_dt = datetime.fromtimestamp(last_split_ts, tz=timezone.utc)
                if (datetime.now(timezone.utc) - split_dt).days < 365:
                    recent_split_date = str(split_dt.date())
                    if isinstance(last_split_str, str) and ":" in last_split_str:
                        n, d = last_split_str.split(":")
                        recent_split_factor = float(n) / float(d)
            except Exception:
                pass

        fund = Fundamentals(
            sector=info.get("sector"),
            industry=info.get("industry"),
            market_cap=info.get("marketCap"),
            trailing_pe=info.get("trailingPE"),
            forward_pe=info.get("forwardPE"),
            dividend_yield=info.get("trailingAnnualDividendYield"),
            fifty_two_week_high=info.get("fiftyTwoWeekHigh"),
            fifty_two_week_low=info.get("fiftyTwoWeekLow"),
            recent_split_date=recent_split_date,
            recent_split_factor=recent_split_factor,
        )

        # limit to 3 headlines to avoid bloating the LLM context window
        raw_news = getattr(t_obj, "news", []) or []
        news = []
        for n in raw_news[:3]:
            try:
                news.append(NewsItem(
                    title=n.get("title", ""),
                    publisher=n.get("publisher", ""),
                    link=n.get("link", ""),
                    publish_time=n.get("providerPublishTime", 0),
                ))
            except Exception:
                pass

        try:
            with open(cache_file, "w") as f:
                json.dump({
                    "fundamentals": fund.model_dump() if fund else None,
                    "news": [n.model_dump() for n in news],
                }, f)
        except Exception as e:
            logger.warning("Failed to write metadata cache for '%s': %s", ticker, e)

        return fund, news

    except Exception as exc:
        logger.error("Failed to fetch metadata for '%s': %s", ticker, exc)
        if cache_file.exists():
            try:
                with open(cache_file, "r") as f:
                    data = json.load(f)
                fund = Fundamentals(**data["fundamentals"]) if data.get("fundamentals") else None
                news = [NewsItem(**n) for n in data.get("news", [])]
                return fund, news
            except Exception:
                pass
        return None, []


def fetch_portfolio_prices(tickers: list[str], force_refresh: bool = False) -> pd.DataFrame:
    series_map: dict[str, pd.Series] = {}
    for ticker in tickers:
        series = fetch_ticker_prices(ticker, force_refresh=force_refresh)
        if series is not None:
            series_map[ticker] = series
        else:
            logger.warning("Excluding '%s' from portfolio prices (no data).", ticker)

    if not series_map:
        return pd.DataFrame()

    prices = pd.DataFrame(series_map)
    # forward-fill gaps caused by mismatched trading calendars (e.g. US vs IN holidays)
    prices = prices.ffill()
    return prices


def get_holdings_tickers(portfolio_id: str, db: duckdb.DuckDBPyConnection) -> list[str]:
    rows = db.execute(
        "SELECT ticker FROM holdings WHERE portfolio_id = ? ORDER BY ticker", [portfolio_id]
    ).fetchall()
    return [row[0] for row in rows]


def upsert_prices_to_db(prices: pd.DataFrame, db: duckdb.DuckDBPyConnection) -> int:
    if prices.empty:
        return 0

    records: list[tuple[str, str, float]] = []
    for ticker in prices.columns:
        for date_idx, close_val in prices[ticker].dropna().items():
            price_date = date_idx.date().isoformat() if hasattr(date_idx, "date") else str(date_idx)[:10]
            records.append((ticker, price_date, float(close_val)))

    if not records:
        return 0

    db.executemany(
        "INSERT OR REPLACE INTO daily_prices (ticker, price_date, close_price) VALUES (?, ?, ?)",
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
    tickers = get_holdings_tickers(portfolio_id, db)
    if not tickers:
        logger.warning("Portfolio '%s' has no holdings; skipping price refresh.", portfolio_id)
        return pd.DataFrame()

    # always include the S&P 500 so the equity curve can show a benchmark
    if "^GSPC" not in tickers:
        tickers.append("^GSPC")

    logger.info("Refreshing prices for '%s': %d tickers.", portfolio_id, len(tickers))
    prices = fetch_portfolio_prices(tickers, force_refresh=force_refresh)
    if prices.empty:
        return pd.DataFrame()

    upserted = upsert_prices_to_db(prices, db)
    logger.info("Price refresh done for '%s': %d rows upserted.", portfolio_id, upserted)
    return prices


def load_prices_from_db(tickers: list[str], db: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Read stored close prices from daily_prices without triggering a network call."""
    if not tickers:
        return pd.DataFrame()

    placeholders = ", ".join("?" * len(tickers))
    rows = db.execute(
        f"SELECT ticker, price_date, close_price FROM daily_prices "
        f"WHERE ticker IN ({placeholders}) ORDER BY price_date",
        tickers,
    ).fetchall()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["ticker", "price_date", "close_price"])
    prices = df.pivot(index="price_date", columns="ticker", values="close_price")
    prices.index = pd.to_datetime(prices.index)
    prices.sort_index(inplace=True)
    return prices
