from __future__ import annotations

from datetime import date, datetime
import datetime as dt
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class TradeAction(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class HoldingBase(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    quantity: float = Field(..., gt=0)
    average_buy_price: float = Field(..., gt=0)

    @field_validator("ticker")
    @classmethod
    def normalise_ticker(cls, v: str) -> str:
        return v.strip().upper()


class HoldingCreate(HoldingBase):
    """portfolio_id comes from the URL path, not the request body."""


class HoldingUpdate(BaseModel):
    quantity: float | None = Field(default=None, gt=0)
    average_buy_price: float | None = Field(default=None, gt=0)


class Holding(HoldingBase):
    portfolio_id: str
    model_config = {"from_attributes": True}


class TransactionBase(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    action: TradeAction
    price: float = Field(..., gt=0)
    quantity: float = Field(..., gt=0)
    transaction_date: datetime

    @field_validator("ticker")
    @classmethod
    def normalise_ticker(cls, v: str) -> str:
        return v.strip().upper()


class TransactionCreate(TransactionBase):
    """portfolio_id comes from the URL path, not the request body."""


class Transaction(TransactionBase):
    id: int
    portfolio_id: str
    model_config = {"from_attributes": True}


class PortfolioSummary(BaseModel):
    portfolio_id: str
    total_invested: float
    total_market_value: float
    total_unrealised_pnl: float
    total_unrealised_pnl_pct: float
    holding_count: int


class PricePoint(BaseModel):
    date: dt.date
    close: float


class NewsItem(BaseModel):
    title: str
    publisher: str
    link: str
    publish_time: int


class Fundamentals(BaseModel):
    sector: str | None = None
    industry: str | None = None
    market_cap: float | None = None
    trailing_pe: float | None = None
    forward_pe: float | None = None
    dividend_yield: float | None = None
    fifty_two_week_high: float | None = None
    fifty_two_week_low: float | None = None
    recent_split_date: str | None = None
    recent_split_factor: float | None = None


class HoldingMetrics(BaseModel):
    ticker: str
    quantity: float
    average_buy_price: float
    latest_price: float
    market_value: float
    cost_basis: float
    unrealized_pnl: float
    unrealized_pnl_pct: float
    current_weight: float
    # True when no market price was found and cost basis is used as a stand-in
    price_is_estimated: bool = False
    fundamentals: Fundamentals | None = None
    news: list[NewsItem] = Field(default_factory=list)


class RebalanceRecommendation(BaseModel):
    ticker: str
    current_weight: float
    optimal_weight: float
    weight_delta: float


class OptimisationResult(BaseModel):
    weights: list[RebalanceRecommendation]
    expected_annual_return: float
    expected_annual_volatility: float
    sharpe_ratio: float


class CorrelationPair(BaseModel):
    ticker_1: str
    ticker_2: str
    correlation: float


class SectorAllocation(BaseModel):
    sector: str
    weight: float
    market_value: float


class PerformancePoint(BaseModel):
    date: date
    portfolio_value: float
    benchmark_value: float


class PortfolioAnalytics(BaseModel):
    portfolio_id: str
    valuation_date: date
    total_market_value: float
    total_cost_basis: float
    total_unrealized_pnl: float
    total_unrealized_pnl_pct: float
    annualized_volatility: float | None = None
    value_at_risk_30d: float | None = None
    holdings: list[HoldingMetrics]
    optimisation: OptimisationResult | None = None
    correlation_matrix: list[CorrelationPair] = Field(default_factory=list)
    sector_allocation: list[SectorAllocation] = Field(default_factory=list)
    historical_performance: list[PerformancePoint] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class AdvisorResponse(BaseModel):
    """is_fallback=True when Ollama is offline; analysis contains a static summary instead."""
    portfolio_id: str
    model_used: str
    analysis: str
    generated_at: datetime
    is_fallback: bool = False
    error_detail: str | None = None


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    history: list[ChatMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    response: str
    model_used: str
    generated_at: datetime
    is_fallback: bool = False
    error_detail: str | None = None
