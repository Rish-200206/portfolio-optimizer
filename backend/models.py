"""
models.py
---------
Pydantic v2 models for request validation, response serialisation, and
internal data transfer objects used throughout the portfolio backend.

Model hierarchy
---------------
Holdings
  HoldingBase          – shared field definitions
  HoldingCreate        – POST body (all required fields)
  HoldingUpdate        – PATCH body (all fields optional)
  Holding              – full DB row returned in responses

Transactions
  TransactionBase      – shared field definitions
  TransactionCreate    – POST body
  Transaction          – full DB row returned in responses

Aggregates
  PortfolioSummary     – high-level rollup for the summary dashboard
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class TradeAction(str, Enum):
    """Valid values for ``Transaction.action``."""

    BUY = "BUY"
    SELL = "SELL"


# ---------------------------------------------------------------------------
# Holdings
# ---------------------------------------------------------------------------


class HoldingBase(BaseModel):
    """Shared field definitions for a portfolio holding."""

    ticker: str = Field(
        ...,
        min_length=1,
        max_length=20,
        description="Exchange ticker symbol, e.g. 'AAPL' or 'RELIANCE.NS'.",
    )
    quantity: float = Field(
        ...,
        gt=0,
        description="Number of shares / units held (must be positive).",
    )
    average_buy_price: float = Field(
        ...,
        gt=0,
        description="Volume-weighted average purchase price per unit (must be positive).",
    )

    @field_validator("ticker")
    @classmethod
    def normalise_ticker(cls, v: str) -> str:
        """Uppercase and strip whitespace from the ticker symbol."""
        return v.strip().upper()


class HoldingCreate(HoldingBase):
    """Request body for creating or upserting a holding position.

    ``portfolio_id`` is supplied in the URL path and injected by the route
    handler before persistence; it is therefore *not* required in the body.
    """


class HoldingUpdate(BaseModel):
    """Request body for a partial update to an existing holding.

    All fields are optional so that callers may patch only what changed.
    """

    quantity: float | None = Field(
        default=None,
        gt=0,
        description="Updated share count.",
    )
    average_buy_price: float | None = Field(
        default=None,
        gt=0,
        description="Updated average purchase price.",
    )


class Holding(HoldingBase):
    """Full holding record as stored in DuckDB and returned in API responses."""

    portfolio_id: str = Field(
        ...,
        description="Logical portfolio this holding belongs to.",
    )

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------


class TransactionBase(BaseModel):
    """Shared field definitions for a trade transaction."""

    ticker: str = Field(
        ...,
        min_length=1,
        max_length=20,
        description="Exchange ticker symbol.",
    )
    action: TradeAction = Field(
        ...,
        description="Trade direction: 'BUY' or 'SELL'.",
    )
    price: float = Field(
        ...,
        gt=0,
        description="Execution price per unit.",
    )
    quantity: float = Field(
        ...,
        gt=0,
        description="Number of units traded.",
    )
    transaction_date: datetime = Field(
        ...,
        description="UTC timestamp of the trade execution.",
    )

    @field_validator("ticker")
    @classmethod
    def normalise_ticker(cls, v: str) -> str:
        """Uppercase and strip whitespace from the ticker symbol."""
        return v.strip().upper()


class TransactionCreate(TransactionBase):
    """Request body for recording a new transaction.

    ``portfolio_id`` is taken from the URL path parameter.
    """


class Transaction(TransactionBase):
    """Full transaction record as stored in DuckDB and returned in API responses."""

    id: int = Field(..., description="Auto-incrementing surrogate key.")
    portfolio_id: str = Field(
        ...,
        description="Logical portfolio this transaction belongs to.",
    )

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Aggregate / response DTOs
# ---------------------------------------------------------------------------


class PortfolioSummary(BaseModel):
    """High-level rollup metrics returned by the portfolio summary endpoint.

    Values are computed at request time by joining Holdings with the latest
    market prices fetched by the data-ingestion layer.
    """

    portfolio_id: str = Field(..., description="Identifier for the portfolio.")
    total_invested: float = Field(
        ...,
        description="Sum of (quantity × average_buy_price) across all holdings.",
    )
    total_market_value: float = Field(
        ...,
        description="Sum of (quantity × latest_price) across all holdings.",
    )
    total_unrealised_pnl: float = Field(
        ...,
        description="total_market_value − total_invested.",
    )
    total_unrealised_pnl_pct: float = Field(
        ...,
        description="Unrealised P&L as a percentage of total_invested.",
    )
    holding_count: int = Field(
        ...,
        description="Number of distinct tickers in the portfolio.",
    )


# ---------------------------------------------------------------------------
# Price history DTO
# ---------------------------------------------------------------------------


class PricePoint(BaseModel):
    """A single daily close price data point for charting.

    Returned as an array by the price-history endpoint and consumed directly
    by the Recharts ``<LineChart>`` component on the frontend.
    """

    date: date = Field(..., description="Trading date (ISO 8601).")
    close: float = Field(..., description="Adjusted close price for the day.")


# ---------------------------------------------------------------------------
# Quant-engine analytics DTOs
# ---------------------------------------------------------------------------


class HoldingMetrics(BaseModel):
    """Per-holding analytics computed by the quant engine.

    Combines static data from the ``holdings`` table with live market prices
    from ``daily_prices`` to produce real-time valuation metrics.
    """

    ticker: str = Field(..., description="Ticker symbol.")
    quantity: float = Field(..., description="Units held.")
    average_buy_price: float = Field(..., description="Volume-weighted average purchase price.")
    latest_price: float = Field(
        ...,
        description=(
            "Most recent adjusted close price. Falls back to average_buy_price "
            "if no price data is stored in daily_prices."
        ),
    )
    market_value: float = Field(..., description="quantity × latest_price.")
    cost_basis: float = Field(..., description="quantity × average_buy_price.")
    unrealized_pnl: float = Field(..., description="market_value − cost_basis.")
    unrealized_pnl_pct: float = Field(
        ...,
        description="Unrealised P&L as a percentage of cost_basis.",
    )
    current_weight: float = Field(
        ...,
        description="Fraction of total portfolio market value (0–1).",
    )
    price_is_estimated: bool = Field(
        default=False,
        description="True when no market price was available and cost basis was used.",
    )


class RebalanceRecommendation(BaseModel):
    """Per-ticker rebalancing suggestion from the Sharpe-ratio optimiser."""

    ticker: str = Field(..., description="Ticker symbol.")
    current_weight: float = Field(..., description="Current portfolio weight (0–1).")
    optimal_weight: float = Field(
        ...,
        description="PyPortfolioOpt max-Sharpe optimal weight (0–1).",
    )
    weight_delta: float = Field(
        ...,
        description="optimal_weight − current_weight (positive = buy more, negative = trim).",
    )


class OptimisationResult(BaseModel):
    """Output of the PyPortfolioOpt max-Sharpe optimisation."""

    weights: list[RebalanceRecommendation] = Field(
        ...,
        description="Per-ticker current vs. optimal weights sorted by |weight_delta| desc.",
    )
    expected_annual_return: float = Field(
        ...,
        description="Projected annualised portfolio return at optimal weights.",
    )
    expected_annual_volatility: float = Field(
        ...,
        description="Projected annualised portfolio volatility at optimal weights.",
    )
    sharpe_ratio: float = Field(
        ...,
        description="Sharpe ratio at optimal weights (risk_free_rate = 5%).",
    )


class PortfolioAnalytics(BaseModel):
    """Full quantitative analytics response for a portfolio.

    Returned by ``GET /portfolios/{portfolio_id}/analytics``.  The frontend
    uses this to populate the detail view, AI advisor payload, and
    rebalancing panel.
    """

    portfolio_id: str = Field(..., description="Identifier for the portfolio.")
    valuation_date: date = Field(
        ...,
        description="The most recent price date used for market-value calculations.",
    )
    total_market_value: float = Field(
        ...,
        description="Sum of (quantity × latest_price) across all holdings.",
    )
    total_cost_basis: float = Field(
        ...,
        description="Sum of (quantity × average_buy_price) across all holdings.",
    )
    total_unrealized_pnl: float = Field(..., description="total_market_value − total_cost_basis.")
    total_unrealized_pnl_pct: float = Field(
        ...,
        description="Unrealised P&L as a percentage of total_cost_basis.",
    )
    annualized_volatility: float | None = Field(
        default=None,
        description=(
            "Portfolio annualised volatility (σ_p × √252). "
            "None when fewer than 2 tickers have price data."
        ),
    )
    holdings: list[HoldingMetrics] = Field(
        ...,
        description="Per-holding metrics sorted by market_value descending.",
    )
    optimisation: OptimisationResult | None = Field(
        default=None,
        description=(
            "Max-Sharpe optimisation output. None when fewer than 2 tickers "
            "have sufficient price history or if the optimiser fails."
        ),
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-fatal issues encountered during calculation (shown in UI).",
    )


# ---------------------------------------------------------------------------
# AI Advisor DTO
# ---------------------------------------------------------------------------


class AdvisorResponse(BaseModel):
    """Response from the local Ollama LLM advisor.

    Returned by ``GET /portfolios/{portfolio_id}/advisor``.  The ``analysis``
    field contains markdown-formatted text ready to be rendered in the frontend
    AI Advisor panel.  When the Ollama service is unavailable, ``is_fallback``
    is set to ``True`` and ``analysis`` contains a user-friendly error message
    instead of LLM output.
    """

    portfolio_id: str = Field(..., description="Portfolio the advice was generated for.")
    model_used: str = Field(
        ...,
        description="Ollama model tag that produced the analysis, e.g. 'llama3'.",
    )
    analysis: str = Field(
        ...,
        description=(
            "Markdown-formatted advice from the LLM. "
            "Contains a fallback message when Ollama is unavailable."
        ),
    )
    generated_at: datetime = Field(
        ...,
        description="UTC timestamp of when the LLM response was received.",
    )
    is_fallback: bool = Field(
        default=False,
        description="True when Ollama is offline and the analysis is a static fallback.",
    )
    error_detail: str | None = Field(
        default=None,
        description="Raw error string from Ollama, present only when is_fallback=True.",
    )
