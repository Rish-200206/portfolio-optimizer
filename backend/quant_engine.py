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

from .data_ingestion import fetch_ticker_metadata, get_holdings_tickers, load_prices_from_db
from .models import (
    HoldingMetrics,
    OptimisationResult,
    PortfolioAnalytics,
    RebalanceRecommendation,
    CorrelationPair,
    SectorAllocation,
    PerformancePoint,
)

logger = logging.getLogger(__name__)

TRADING_DAYS: int = 252
RISK_FREE_RATE: float = 0.05
MIN_TICKERS_FOR_OPTIMISATION: int = 2
MIN_PRICE_ROWS: int = 60


@dataclass
class _LatestPrice:
    ticker: str
    price: float
    price_date: date
    is_estimated: bool  # True when falling back to average_buy_price


def get_latest_prices(
    tickers: list[str],
    holdings_by_ticker: dict[str, tuple[float, float]],
    db: duckdb.DuckDBPyConnection,
) -> dict[str, _LatestPrice]:
    if not tickers:
        return {}

    placeholders = ", ".join("?" * len(tickers))
    rows = db.execute(
        f"""
        SELECT ticker, close_price, price_date
        FROM (
            SELECT ticker, close_price, price_date,
                   ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY price_date DESC) AS rn
            FROM daily_prices WHERE ticker IN ({placeholders})
        ) ranked WHERE rn = 1
        """,
        tickers,
    ).fetchall()

    price_map: dict[str, _LatestPrice] = {
        row[0]: _LatestPrice(ticker=row[0], price=float(row[1]), price_date=row[2], is_estimated=False)
        for row in rows
    }

    # fall back to cost basis for tickers with no stored prices
    for ticker in tickers:
        if ticker not in price_map:
            _, avg_price = holdings_by_ticker.get(ticker, (0.0, 0.0))
            price_map[ticker] = _LatestPrice(
                ticker=ticker, price=avg_price, price_date=date.today(), is_estimated=True,
            )

    return price_map


def compute_holding_metrics(
    holdings_rows: list[tuple],
    price_map: dict[str, _LatestPrice],
    metadata_map: dict,
) -> tuple[list[HoldingMetrics], float, float, list[str]]:
    warnings: list[str] = []
    partial_metrics: list[dict] = []
    total_market_value: float = 0.0
    total_cost_basis: float = 0.0

    for row in holdings_rows:
        ticker, quantity, avg_price, _ = row[0], row[1], row[2], row[3]
        snap = price_map.get(ticker)

        if snap is None:
            warnings.append(f"No price data for '{ticker}'; excluded from market-value calculations.")
            continue
        if snap.is_estimated:
            warnings.append(f"'{ticker}' has no stored price. Using cost basis as market value proxy.")

        market_value = quantity * snap.price
        cost_basis = quantity * avg_price
        unrealized_pnl = market_value - cost_basis
        unrealized_pnl_pct = (unrealized_pnl / cost_basis * 100) if cost_basis != 0 else 0.0

        total_market_value += market_value
        total_cost_basis += cost_basis

        fund, news = metadata_map.get(ticker, (None, []))
        if fund and fund.recent_split_date:
            warnings.append(
                f"Corporate Action: '{ticker}' split on {fund.recent_split_date} "
                f"(factor: {fund.recent_split_factor}). Check your local quantity and avg price."
            )

        partial_metrics.append({
            "ticker": ticker, "quantity": quantity, "average_buy_price": avg_price,
            "latest_price": snap.price, "market_value": market_value, "cost_basis": cost_basis,
            "unrealized_pnl": unrealized_pnl, "unrealized_pnl_pct": unrealized_pnl_pct,
            "price_is_estimated": snap.is_estimated, "fundamentals": fund, "news": news,
        })

    # weights can only be assigned after total_market_value is known
    metrics: list[HoldingMetrics] = []
    for m in partial_metrics:
        weight = m["market_value"] / total_market_value if total_market_value > 0 else 0.0
        metrics.append(HoldingMetrics(
            ticker=m["ticker"], quantity=m["quantity"], average_buy_price=m["average_buy_price"],
            latest_price=m["latest_price"], market_value=m["market_value"],
            cost_basis=m["cost_basis"], unrealized_pnl=m["unrealized_pnl"],
            unrealized_pnl_pct=m["unrealized_pnl_pct"], current_weight=round(weight, 6),
            price_is_estimated=m["price_is_estimated"], fundamentals=m["fundamentals"],
            news=m["news"],
        ))

    metrics.sort(key=lambda h: h.market_value, reverse=True)
    return metrics, total_market_value, total_cost_basis, warnings


def compute_annualized_volatility(
    prices: pd.DataFrame,
    weights: dict[str, float],
) -> Optional[float]:
    common_tickers = [t for t in weights if t in prices.columns]
    if len(common_tickers) < MIN_TICKERS_FOR_OPTIMISATION:
        return None

    sub_prices = prices[common_tickers].dropna(how="all")
    if len(sub_prices) < MIN_PRICE_ROWS:
        return None

    log_returns: pd.DataFrame = np.log(sub_prices / sub_prices.shift(1)).dropna()
    cov_matrix: pd.DataFrame = log_returns.cov()

    w = np.array([weights.get(t, 0.0) for t in cov_matrix.columns])
    total_w = w.sum()
    if total_w > 0:
        w = w / total_w

    portfolio_variance = float(w @ cov_matrix.values @ w)
    return round(float(np.sqrt(portfolio_variance * TRADING_DAYS)), 6)


def compute_correlation_matrix(prices: pd.DataFrame) -> list[CorrelationPair]:
    valid_tickers = [c for c in prices.columns if prices[c].dropna().shape[0] >= MIN_PRICE_ROWS]
    if len(valid_tickers) < 2:
        return []

    log_returns = np.log(prices[valid_tickers].dropna(how="all") /
                         prices[valid_tickers].dropna(how="all").shift(1)).dropna()
    corr_matrix = log_returns.corr()
    tickers = corr_matrix.columns

    pairs = [
        CorrelationPair(
            ticker_1=tickers[i], ticker_2=tickers[j],
            correlation=round(float(corr_matrix.iloc[i, j]), 4),
        )
        for i in range(len(tickers))
        for j in range(i + 1, len(tickers))
    ]
    pairs.sort(key=lambda x: abs(x.correlation), reverse=True)
    return pairs


def compute_monte_carlo_var(
    prices: pd.DataFrame,
    weights: dict[str, float],
    portfolio_value: float,
    days: int = 30,
    simulations: int = 10000,
    confidence_level: float = 0.95,
) -> Optional[float]:
    """Monte Carlo VaR via Cholesky decomposition on the log-return covariance matrix."""
    common_tickers = [t for t in weights if t in prices.columns]
    if len(common_tickers) < MIN_TICKERS_FOR_OPTIMISATION:
        return None

    sub_prices = prices[common_tickers].dropna(how="all")
    if len(sub_prices) < MIN_PRICE_ROWS:
        return None

    log_returns = np.log(sub_prices / sub_prices.shift(1)).dropna()
    mu = log_returns.mean().values
    cov_matrix = log_returns.cov().values

    try:
        L = np.linalg.cholesky(cov_matrix)
    except np.linalg.LinAlgError:
        return None

    w = np.array([weights.get(t, 0.0) for t in common_tickers])
    total_w = w.sum()
    if total_w > 0:
        w = w / total_w

    Z = np.random.normal(scale=np.sqrt(days), size=(simulations, len(common_tickers)))
    R = days * mu + Z.dot(L.T)
    port_returns = R.dot(w)
    var_percentile = np.percentile(port_returns, (1 - confidence_level) * 100)
    return round(float(max(0, -var_percentile * portfolio_value)), 2)


def compute_historical_performance(
    prices: pd.DataFrame,
    weights: dict[str, float],
) -> list[PerformancePoint]:
    if "^GSPC" not in prices.columns:
        return []

    port_tickers = [t for t in weights if t in prices.columns and t != "^GSPC"]
    if not port_tickers:
        return []

    sub_prices = prices[port_tickers + ["^GSPC"]].dropna(how="any")
    if sub_prices.empty:
        return []

    normalized = sub_prices / sub_prices.iloc[0] * 100

    w = np.array([weights.get(t, 0.0) for t in port_tickers])
    total_w = w.sum()
    if total_w > 0:
        w = w / total_w

    port_vals = normalized[port_tickers].dot(w)
    bench_vals = normalized["^GSPC"]

    # resample to weekly to keep the JSON payload small
    port_weekly = port_vals.resample("W-FRI").last().dropna()
    bench_weekly = bench_vals.resample("W-FRI").last().dropna()

    points = []
    for dt, p_val in port_weekly.items():
        b_val = bench_weekly.get(dt)
        if pd.notna(b_val):
            points.append(PerformancePoint(
                date=dt.date(),
                portfolio_value=round(float(p_val), 2),
                benchmark_value=round(float(b_val), 2),
            ))
    return points


def optimise_max_sharpe(
    prices: pd.DataFrame,
    current_weights: dict[str, float],
) -> Optional[OptimisationResult]:
    """Max-Sharpe via PyPortfolioOpt with Ledoit-Wolf covariance shrinkage."""
    valid_tickers = [c for c in prices.columns if prices[c].dropna().shape[0] >= MIN_PRICE_ROWS]
    if len(valid_tickers) < MIN_TICKERS_FOR_OPTIMISATION:
        logger.warning("Optimisation skipped: only %d tickers have enough history.", len(valid_tickers))
        return None

    sub_prices = prices[valid_tickers].dropna(how="all")
    try:
        mu: pd.Series = expected_returns.mean_historical_return(
            sub_prices, returns_data=False, compounding=True, frequency=TRADING_DAYS,
        )
        # Ledoit-Wolf shrinkage is more stable than sample covariance for small portfolios
        S: pd.DataFrame = risk_models.CovarianceShrinkage(
            sub_prices, frequency=TRADING_DAYS,
        ).ledoit_wolf()

        ef = EfficientFrontier(mu, S)
        ef.max_sharpe(risk_free_rate=RISK_FREE_RATE)
        cleaned: dict[str, float] = ef.clean_weights()
        exp_return, exp_vol, sharpe = ef.portfolio_performance(risk_free_rate=RISK_FREE_RATE, verbose=False)

    except OptimizationError as exc:
        logger.warning("PyPortfolioOpt could not find a max-Sharpe solution: %s", exc)
        return None
    except Exception as exc:
        logger.error("Unexpected error during Sharpe optimisation: %s", exc)
        return None

    recommendations = [
        RebalanceRecommendation(
            ticker=ticker,
            current_weight=round(current_weights.get(ticker, 0.0), 6),
            optimal_weight=round(optimal_w, 6),
            weight_delta=round(optimal_w - current_weights.get(ticker, 0.0), 6),
        )
        for ticker, optimal_w in cleaned.items()
    ]
    recommendations.sort(key=lambda r: abs(r.weight_delta), reverse=True)

    return OptimisationResult(
        weights=recommendations,
        expected_annual_return=round(float(exp_return), 6),
        expected_annual_volatility=round(float(exp_vol), 6),
        sharpe_ratio=round(float(sharpe), 4),
    )


def run_portfolio_analytics(portfolio_id: str, db: duckdb.DuckDBPyConnection) -> PortfolioAnalytics:
    holdings_rows: list[tuple] = db.execute(
        "SELECT ticker, quantity, average_buy_price, portfolio_id FROM holdings "
        "WHERE portfolio_id = ? ORDER BY ticker",
        [portfolio_id],
    ).fetchall()

    if not holdings_rows:
        raise ValueError(f"Portfolio '{portfolio_id}' has no holdings.")

    tickers: list[str] = [row[0] for row in holdings_rows]
    holdings_by_ticker: dict[str, tuple[float, float]] = {row[0]: (row[1], row[2]) for row in holdings_rows}

    price_map = get_latest_prices(tickers, holdings_by_ticker, db)

    metadata_map = {}
    for t in tickers:
        try:
            metadata_map[t] = fetch_ticker_metadata(t)
        except Exception as e:
            logger.warning("Error fetching metadata for %s: %s", t, e)
            metadata_map[t] = (None, [])

    metrics, total_market_value, total_cost_basis, warnings = compute_holding_metrics(
        holdings_rows, price_map, metadata_map
    )

    total_unrealized_pnl = total_market_value - total_cost_basis
    total_unrealized_pnl_pct = (total_unrealized_pnl / total_cost_basis * 100) if total_cost_basis > 0 else 0.0
    valuation_date: date = max(
        (price_map[t].price_date for t in tickers if t in price_map), default=date.today()
    )

    price_tickers = list(tickers)
    if "^GSPC" not in price_tickers:
        price_tickers.append("^GSPC")
    prices: pd.DataFrame = load_prices_from_db(price_tickers, db)

    current_weights: dict[str, float] = {m.ticker: m.current_weight for m in metrics}
    annualized_vol: Optional[float] = None
    var_30d: Optional[float] = None

    if not prices.empty:
        annualized_vol = compute_annualized_volatility(prices, current_weights)
        var_30d = compute_monte_carlo_var(prices, current_weights, total_market_value)
    else:
        warnings.append(
            "No price history in daily_prices. Run POST .../prices/refresh to enable volatility calculations."
        )

    optimisation: Optional[OptimisationResult] = None
    if not prices.empty:
        optimisation = optimise_max_sharpe(prices, current_weights)
        if optimisation is None and len(tickers) >= MIN_TICKERS_FOR_OPTIMISATION:
            warnings.append(
                "Optimisation could not be performed — insufficient price history "
                "(< 60 trading days) or all assets have negative expected returns."
            )

    sector_alloc: dict[str, dict[str, float]] = {}
    for m in metrics:
        sector = m.fundamentals.sector if (m.fundamentals and m.fundamentals.sector) else "Unknown"
        if sector not in sector_alloc:
            sector_alloc[sector] = {"market_value": 0.0, "weight": 0.0}
        sector_alloc[sector]["market_value"] += m.market_value
        sector_alloc[sector]["weight"] += m.current_weight

    sector_allocation = sorted(
        [SectorAllocation(sector=k, weight=round(v["weight"], 6), market_value=round(v["market_value"], 2))
         for k, v in sector_alloc.items()],
        key=lambda x: x.market_value, reverse=True,
    )

    correlation_matrix = []
    historical_performance = []
    if not prices.empty:
        correlation_matrix = compute_correlation_matrix(prices)
        historical_performance = compute_historical_performance(prices, current_weights)

    return PortfolioAnalytics(
        portfolio_id=portfolio_id,
        valuation_date=valuation_date,
        total_market_value=round(total_market_value, 2),
        total_cost_basis=round(total_cost_basis, 2),
        total_unrealized_pnl=round(total_unrealized_pnl, 2),
        total_unrealized_pnl_pct=round(total_unrealized_pnl_pct, 4),
        annualized_volatility=annualized_vol,
        value_at_risk_30d=var_30d,
        holdings=metrics,
        optimisation=optimisation,
        correlation_matrix=correlation_matrix,
        sector_allocation=sector_allocation,
        historical_performance=historical_performance,
        warnings=warnings,
    )
