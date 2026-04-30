"""
quant_engine.py
---------------
Quantitative analytics engine.

All heavy mathematics lives here.  The module is intentionally stateless:
every public function takes plain Python / pandas arguments and returns typed
dataclasses or Pydantic models.  FastAPI route handlers orchestrate the calls.

Public API
----------
get_latest_prices(tickers, db)            → dict[str, _LatestPrice]
compute_holding_metrics(holdings, prices) → tuple[list[HoldingMetrics], list[str]]
compute_annualized_volatility(prices, weights) → float | None
optimise_max_sharpe(prices)               → OptimisationResult | None
run_portfolio_analytics(portfolio_id, db) → PortfolioAnalytics
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Optional

import duckdb
import numpy as np
import pandas as pd
from pypfopt import EfficientFrontier, expected_returns, risk_models
from pypfopt.exceptions import OptimizationError

from .data_ingestion import get_holdings_tickers, load_prices_from_db
from .models import (
    HoldingMetrics,
    OptimisationResult,
    PortfolioAnalytics,
    RebalanceRecommendation,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

#: Number of trading days per year used to annualise statistics.
TRADING_DAYS: int = 252

#: Risk-free rate for Sharpe ratio calculations (US 3-month T-bill proxy).
RISK_FREE_RATE: float = 0.05

#: Minimum number of tickers required to run the portfolio optimiser.
MIN_TICKERS_FOR_OPTIMISATION: int = 2

#: Minimum number of trading-day rows required for a reliable covariance estimate.
MIN_PRICE_ROWS: int = 60


# ---------------------------------------------------------------------------
# Internal dataclass – not exposed via the API
# ---------------------------------------------------------------------------


@dataclass
class _LatestPrice:
    """Snapshot of the most recent stored price for a single ticker."""

    ticker: str
    price: float
    price_date: date
    is_estimated: bool  # True when falling back to average_buy_price


# ---------------------------------------------------------------------------
# Step 1 – Price resolution
# ---------------------------------------------------------------------------


def get_latest_prices(
    tickers: list[str],
    holdings_by_ticker: dict[str, tuple[float, float]],
    db: duckdb.DuckDBPyConnection,
) -> dict[str, _LatestPrice]:
    """Resolve the most recent stored close price for each ticker.

    For tickers that have no entry in ``daily_prices`` (e.g. price refresh
    has never been run), the holding's ``average_buy_price`` is used as a
    cost-basis stand-in and the ``is_estimated`` flag is set so the caller
    can surface a warning to the user.

    Parameters
    ----------
    tickers:
        List of ticker symbols to resolve.
    holdings_by_ticker:
        Mapping of ticker → (quantity, average_buy_price) from the holdings table.
    db:
        Active DuckDB connection.

    Returns
    -------
    dict[str, _LatestPrice]
        Mapping of ticker → latest price snapshot.
    """
    if not tickers:
        return {}

    placeholders = ", ".join("?" * len(tickers))
    rows = db.execute(
        f"""
        SELECT ticker, close_price, price_date
        FROM (
            SELECT
                ticker,
                close_price,
                price_date,
                ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY price_date DESC) AS rn
            FROM daily_prices
            WHERE ticker IN ({placeholders})
        ) ranked
        WHERE rn = 1
        """,
        tickers,
    ).fetchall()

    price_map: dict[str, _LatestPrice] = {
        row[0]: _LatestPrice(
            ticker=row[0],
            price=float(row[1]),
            price_date=row[2],
            is_estimated=False,
        )
        for row in rows
    }

    # Fallback for tickers with no stored prices.
    for ticker in tickers:
        if ticker not in price_map:
            _, avg_price = holdings_by_ticker.get(ticker, (0.0, 0.0))
            price_map[ticker] = _LatestPrice(
                ticker=ticker,
                price=avg_price,
                price_date=date.today(),
                is_estimated=True,
            )

    return price_map


# ---------------------------------------------------------------------------
# Step 2 – Per-holding metrics
# ---------------------------------------------------------------------------


def compute_holding_metrics(
    holdings_rows: list[tuple],
    price_map: dict[str, _LatestPrice],
) -> tuple[list[HoldingMetrics], float, float, list[str]]:
    """Compute per-holding valuation metrics and aggregate portfolio totals.

    Parameters
    ----------
    holdings_rows:
        Raw DuckDB result rows: (ticker, quantity, average_buy_price, portfolio_id).
    price_map:
        Latest price snapshot per ticker as returned by :func:`get_latest_prices`.

    Returns
    -------
    tuple of:
        - list[HoldingMetrics]: Per-holding metrics (weights not yet set; computed
          after total_market_value is known).
        - float: Total portfolio market value.
        - float: Total portfolio cost basis.
        - list[str]: Warning messages for tickers using estimated prices.
    """
    warnings: list[str] = []
    partial_metrics: list[dict] = []
    total_market_value: float = 0.0
    total_cost_basis: float = 0.0

    for row in holdings_rows:
        ticker, quantity, avg_price, _ = row[0], row[1], row[2], row[3]
        snap = price_map.get(ticker)

        if snap is None:
            warnings.append(
                f"No price data found for '{ticker}'; it will be excluded from "
                "market-value calculations."
            )
            continue

        if snap.is_estimated:
            warnings.append(
                f"'{ticker}' has no stored price data. "
                "Using cost basis as a proxy for market value."
            )

        market_value = quantity * snap.price
        cost_basis = quantity * avg_price
        unrealized_pnl = market_value - cost_basis
        unrealized_pnl_pct = (unrealized_pnl / cost_basis * 100) if cost_basis != 0 else 0.0

        total_market_value += market_value
        total_cost_basis += cost_basis

        partial_metrics.append(
            {
                "ticker": ticker,
                "quantity": quantity,
                "average_buy_price": avg_price,
                "latest_price": snap.price,
                "market_value": market_value,
                "cost_basis": cost_basis,
                "unrealized_pnl": unrealized_pnl,
                "unrealized_pnl_pct": unrealized_pnl_pct,
                "price_is_estimated": snap.is_estimated,
            }
        )

    # Assign portfolio weights now that total_market_value is known.
    metrics: list[HoldingMetrics] = []
    for m in partial_metrics:
        weight = m["market_value"] / total_market_value if total_market_value > 0 else 0.0
        metrics.append(
            HoldingMetrics(
                ticker=m["ticker"],
                quantity=m["quantity"],
                average_buy_price=m["average_buy_price"],
                latest_price=m["latest_price"],
                market_value=m["market_value"],
                cost_basis=m["cost_basis"],
                unrealized_pnl=m["unrealized_pnl"],
                unrealized_pnl_pct=m["unrealized_pnl_pct"],
                current_weight=round(weight, 6),
                price_is_estimated=m["price_is_estimated"],
            )
        )

    # Sort by market value descending.
    metrics.sort(key=lambda h: h.market_value, reverse=True)
    return metrics, total_market_value, total_cost_basis, warnings


# ---------------------------------------------------------------------------
# Step 3 – Portfolio volatility
# ---------------------------------------------------------------------------


def compute_annualized_volatility(
    prices: pd.DataFrame,
    weights: dict[str, float],
) -> Optional[float]:
    """Compute the annualised portfolio volatility σ_p × √252.

    Uses the covariance matrix of daily log-returns.  Returns ``None`` when
    there are fewer than :data:`MIN_TICKERS_FOR_OPTIMISATION` tickers with
    sufficient price history.

    Parameters
    ----------
    prices:
        DatetimeIndex × ticker-column DataFrame of close prices.
    weights:
        Mapping of ticker → portfolio weight (should sum to ~1.0).
        Only tickers present in ``prices.columns`` are used.

    Returns
    -------
    float | None
        Annualised volatility as a decimal (e.g. 0.18 = 18%), or ``None``
        if the calculation cannot be performed.
    """
    # Filter to tickers present in both weights and prices.
    common_tickers = [t for t in weights if t in prices.columns]

    if len(common_tickers) < MIN_TICKERS_FOR_OPTIMISATION:
        logger.warning(
            "Volatility calculation requires ≥ %d tickers with price data; "
            "found %d. Skipping.",
            MIN_TICKERS_FOR_OPTIMISATION,
            len(common_tickers),
        )
        return None

    sub_prices = prices[common_tickers].dropna(how="all")

    if len(sub_prices) < MIN_PRICE_ROWS:
        logger.warning(
            "Only %d rows of price data available; need ≥ %d for stable estimates.",
            len(sub_prices),
            MIN_PRICE_ROWS,
        )
        return None

    # Daily log-returns are more appropriate than simple returns for
    # multi-period compounding.
    log_returns: pd.DataFrame = np.log(sub_prices / sub_prices.shift(1)).dropna()
    cov_matrix: pd.DataFrame = log_returns.cov()

    # Align the weight vector with the column order of the covariance matrix.
    w = np.array([weights.get(t, 0.0) for t in cov_matrix.columns])

    # Normalise to sum to 1 in case of rounding or missing tickers.
    total_w = w.sum()
    if total_w > 0:
        w = w / total_w

    portfolio_variance: float = float(w @ cov_matrix.values @ w)
    annualized_vol: float = float(np.sqrt(portfolio_variance * TRADING_DAYS))

    return round(annualized_vol, 6)


# ---------------------------------------------------------------------------
# Step 4 – Max-Sharpe optimisation
# ---------------------------------------------------------------------------


def optimise_max_sharpe(
    prices: pd.DataFrame,
    current_weights: dict[str, float],
) -> Optional[OptimisationResult]:
    """Find the portfolio weights that maximise the Sharpe ratio.

    Uses PyPortfolioOpt with:
    - ``expected_returns.mean_historical_return`` (geometric / CAGR-based).
    - ``risk_models.CovarianceShrinkage(...).ledoit_wolf()`` for a more stable
      covariance estimate than the plain sample covariance (especially important
      with fewer than ~100 observations per asset).

    Returns ``None`` and logs a warning when:
    - Fewer than :data:`MIN_TICKERS_FOR_OPTIMISATION` tickers have price data.
    - Fewer than :data:`MIN_PRICE_ROWS` trading days of history are available.
    - The PyPortfolioOpt optimiser raises :class:`pypfopt.exceptions.OptimizationError`.

    Parameters
    ----------
    prices:
        DatetimeIndex × ticker-column DataFrame of close prices.
    current_weights:
        Mapping of ticker → current portfolio weight (0–1), used to compute
        the ``weight_delta`` in the rebalancing recommendations.

    Returns
    -------
    OptimisationResult | None
        Optimal weights plus projected performance metrics, or ``None`` if
        optimisation could not be performed.
    """
    # Only use tickers with enough price history.
    valid_tickers = [
        col
        for col in prices.columns
        if prices[col].dropna().shape[0] >= MIN_PRICE_ROWS
    ]

    if len(valid_tickers) < MIN_TICKERS_FOR_OPTIMISATION:
        logger.warning(
            "Optimisation requires ≥ %d tickers with ≥ %d price rows; "
            "only %d qualify. Skipping.",
            MIN_TICKERS_FOR_OPTIMISATION,
            MIN_PRICE_ROWS,
            len(valid_tickers),
        )
        return None

    sub_prices = prices[valid_tickers].dropna(how="all")

    try:
        # ── Expected returns (geometric mean / CAGR) ────────────────────────
        mu: pd.Series = expected_returns.mean_historical_return(
            sub_prices,
            returns_data=False,
            compounding=True,
            frequency=TRADING_DAYS,
        )

        # ── Covariance (Ledoit-Wolf shrinkage) ─────────────────────────────
        # More robust than sample_cov for portfolios with ~5–30 assets.
        S: pd.DataFrame = risk_models.CovarianceShrinkage(
            sub_prices,
            frequency=TRADING_DAYS,
        ).ledoit_wolf()

        # ── Efficient Frontier → max Sharpe ────────────────────────────────
        ef = EfficientFrontier(mu, S)
        ef.max_sharpe(risk_free_rate=RISK_FREE_RATE)
        cleaned: dict[str, float] = ef.clean_weights()

        # ── Portfolio performance at optimal weights ────────────────────────
        exp_return, exp_vol, sharpe = ef.portfolio_performance(
            risk_free_rate=RISK_FREE_RATE,
            verbose=False,
        )

    except OptimizationError as exc:
        logger.warning(
            "PyPortfolioOpt could not find a max-Sharpe solution: %s. "
            "This can happen when all assets have negative expected returns.",
            exc,
        )
        return None
    except Exception as exc:  # pragma: no cover
        logger.error("Unexpected error during Sharpe optimisation: %s", exc)
        return None

    # ── Build rebalancing recommendations ──────────────────────────────────
    recommendations: list[RebalanceRecommendation] = []
    for ticker, optimal_w in cleaned.items():
        cur_w = current_weights.get(ticker, 0.0)
        recommendations.append(
            RebalanceRecommendation(
                ticker=ticker,
                current_weight=round(cur_w, 6),
                optimal_weight=round(optimal_w, 6),
                weight_delta=round(optimal_w - cur_w, 6),
            )
        )

    # Sort by absolute weight delta descending (most actionable first).
    recommendations.sort(key=lambda r: abs(r.weight_delta), reverse=True)

    return OptimisationResult(
        weights=recommendations,
        expected_annual_return=round(float(exp_return), 6),
        expected_annual_volatility=round(float(exp_vol), 6),
        sharpe_ratio=round(float(sharpe), 4),
    )


# ---------------------------------------------------------------------------
# Public orchestrator
# ---------------------------------------------------------------------------


def run_portfolio_analytics(
    portfolio_id: str,
    db: duckdb.DuckDBPyConnection,
) -> PortfolioAnalytics:
    """Compute the full quantitative analytics package for a portfolio.

    Orchestration
    -------------
    1. Load holdings from the ``holdings`` table.
    2. Resolve the latest stored close price for each ticker.
    3. Compute per-holding market value, cost basis, and P&L.
    4. Load the full 1-year price history from ``daily_prices`` for volatility
       and optimisation calculations.
    5. Compute portfolio annualised volatility using current weights.
    6. Run the max-Sharpe optimisation via PyPortfolioOpt.
    7. Return the assembled :class:`~backend.models.PortfolioAnalytics` object.

    Parameters
    ----------
    portfolio_id:
        Identifier of the target portfolio.
    db:
        Active DuckDB connection (read + write access).

    Returns
    -------
    PortfolioAnalytics
        The complete analytics payload, including warnings for any edge cases
        encountered (missing prices, optimisation failures, etc.).

    Raises
    ------
    ValueError
        If the portfolio has no holdings.
    """
    # ── 1. Load holdings ───────────────────────────────────────────────────
    holdings_rows: list[tuple] = db.execute(
        """
        SELECT ticker, quantity, average_buy_price, portfolio_id
        FROM   holdings
        WHERE  portfolio_id = ?
        ORDER  BY ticker
        """,
        [portfolio_id],
    ).fetchall()

    if not holdings_rows:
        raise ValueError(f"Portfolio '{portfolio_id}' has no holdings.")

    tickers: list[str] = [row[0] for row in holdings_rows]
    holdings_by_ticker: dict[str, tuple[float, float]] = {
        row[0]: (row[1], row[2]) for row in holdings_rows
    }

    # ── 2. Resolve latest prices ───────────────────────────────────────────
    price_map = get_latest_prices(tickers, holdings_by_ticker, db)

    # ── 3. Per-holding metrics ─────────────────────────────────────────────
    metrics, total_market_value, total_cost_basis, warnings = compute_holding_metrics(
        holdings_rows, price_map
    )

    total_unrealized_pnl = total_market_value - total_cost_basis
    total_unrealized_pnl_pct = (
        (total_unrealized_pnl / total_cost_basis * 100) if total_cost_basis > 0 else 0.0
    )

    # The valuation date is the most recent price date across all holdings.
    valuation_date: date = max(
        (price_map[t].price_date for t in tickers if t in price_map),
        default=date.today(),
    )

    # ── 4. Load full price history ─────────────────────────────────────────
    prices: pd.DataFrame = load_prices_from_db(tickers, db)

    # ── 5. Portfolio volatility ────────────────────────────────────────────
    current_weights: dict[str, float] = {m.ticker: m.current_weight for m in metrics}
    annualized_vol: Optional[float] = None

    if not prices.empty:
        annualized_vol = compute_annualized_volatility(prices, current_weights)
    else:
        warnings.append(
            "No price history found in daily_prices. "
            "Run POST /portfolios/{portfolio_id}/prices/refresh to enable "
            "volatility and optimisation calculations."
        )

    # ── 6. Max-Sharpe optimisation ─────────────────────────────────────────
    optimisation: Optional[OptimisationResult] = None

    if not prices.empty:
        optimisation = optimise_max_sharpe(prices, current_weights)
        if optimisation is None and len(tickers) >= MIN_TICKERS_FOR_OPTIMISATION:
            warnings.append(
                "Portfolio optimisation could not be performed. This may be due to "
                "insufficient price history (< 60 trading days) or all assets "
                "having negative expected returns over the trailing 1-year window."
            )

    # ── 7. Assemble response ───────────────────────────────────────────────
    return PortfolioAnalytics(
        portfolio_id=portfolio_id,
        valuation_date=valuation_date,
        total_market_value=round(total_market_value, 2),
        total_cost_basis=round(total_cost_basis, 2),
        total_unrealized_pnl=round(total_unrealized_pnl, 2),
        total_unrealized_pnl_pct=round(total_unrealized_pnl_pct, 4),
        annualized_volatility=annualized_vol,
        holdings=metrics,
        optimisation=optimisation,
        warnings=warnings,
    )
