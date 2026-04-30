"""
main.py
-------
FastAPI application entry-point.

Wires together:
- Application lifespan (DB initialisation on startup).
- CORS middleware so the Vite dev server can reach the API.
- Routers for Holdings and Transactions CRUD operations.

Run with:
    uvicorn backend.main:app --reload --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncGenerator

import duckdb
from fastapi import Depends, FastAPI, HTTPException, Path, status
from fastapi.middleware.cors import CORSMiddleware

from .ai_advisor import generate_advice
from .data_ingestion import load_prices_from_db, refresh_portfolio_prices
from .database import get_db, init_db
from .models import (
    AdvisorResponse,
    Holding,
    HoldingCreate,
    HoldingUpdate,
    PortfolioAnalytics,
    PricePoint,
    PortfolioSummary,
    Transaction,
    TransactionCreate,
)
from .quant_engine import run_portfolio_analytics


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialise the database schema before accepting requests."""
    init_db()
    yield


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Portfolio Optimizer API",
    version="0.1.0",
    description=(
        "Local quantitative finance portfolio dashboard backend. "
        "Powered by DuckDB, PyPortfolioOpt, and a local Ollama LLM."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helper: row → Holding / Transaction
# ---------------------------------------------------------------------------


def _row_to_holding(row: tuple) -> Holding:
    """Map a DuckDB result row (ticker, quantity, avg_price, portfolio_id) → Holding."""
    return Holding(
        ticker=row[0],
        quantity=row[1],
        average_buy_price=row[2],
        portfolio_id=row[3],
    )


def _row_to_transaction(row: tuple) -> Transaction:
    """Map a DuckDB result row → Transaction."""
    return Transaction(
        id=row[0],
        ticker=row[1],
        action=row[2],
        price=row[3],
        quantity=row[4],
        transaction_date=row[5],
        portfolio_id=row[6],
    )


# ---------------------------------------------------------------------------
# Portfolio routes
# ---------------------------------------------------------------------------


@app.get(
    "/portfolios",
    response_model=list[str],
    summary="List all portfolio IDs",
    tags=["Portfolios"],
)
def list_portfolios(
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> list[str]:
    """Return a deduplicated list of all portfolio IDs present in the holdings table."""
    rows = db.execute(
        "SELECT DISTINCT portfolio_id FROM holdings ORDER BY portfolio_id"
    ).fetchall()
    return [r[0] for r in rows]


@app.get(
    "/portfolios/{portfolio_id}/summary",
    response_model=PortfolioSummary,
    summary="Get portfolio-level aggregates",
    tags=["Portfolios"],
)
def get_portfolio_summary(
    portfolio_id: str = Path(..., description="Target portfolio identifier."),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> PortfolioSummary:
    """Return high-level cost-basis metrics for a portfolio.

    Note: ``total_market_value`` and unrealised P&L here are computed from
    ``average_buy_price`` (cost basis) because live prices are fetched by the
    data-ingestion layer in a separate endpoint.  This endpoint provides a
    fast, DB-only response for the summary dashboard scaffold.
    """
    row = db.execute(
        """
        SELECT
            COUNT(*)                                              AS holding_count,
            SUM(quantity * average_buy_price)                    AS total_invested
        FROM holdings
        WHERE portfolio_id = ?
        """,
        [portfolio_id],
    ).fetchone()

    if row is None or row[0] == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Portfolio '{portfolio_id}' not found or has no holdings.",
        )

    holding_count: int = int(row[0])
    total_invested: float = float(row[1])

    return PortfolioSummary(
        portfolio_id=portfolio_id,
        total_invested=total_invested,
        total_market_value=total_invested,   # overwritten by quant_engine later
        total_unrealised_pnl=0.0,
        total_unrealised_pnl_pct=0.0,
        holding_count=holding_count,
    )


# ---------------------------------------------------------------------------
# Holdings routes
# ---------------------------------------------------------------------------


@app.get(
    "/portfolios/{portfolio_id}/holdings",
    response_model=list[Holding],
    summary="List all holdings in a portfolio",
    tags=["Holdings"],
)
def list_holdings(
    portfolio_id: str = Path(..., description="Target portfolio identifier."),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> list[Holding]:
    """Return every holding row for the given portfolio."""
    rows = db.execute(
        """
        SELECT ticker, quantity, average_buy_price, portfolio_id
        FROM   holdings
        WHERE  portfolio_id = ?
        ORDER  BY ticker
        """,
        [portfolio_id],
    ).fetchall()
    return [_row_to_holding(r) for r in rows]


@app.post(
    "/portfolios/{portfolio_id}/holdings",
    response_model=Holding,
    status_code=status.HTTP_201_CREATED,
    summary="Add or upsert a holding",
    tags=["Holdings"],
)
def create_or_upsert_holding(
    body: HoldingCreate,
    portfolio_id: str = Path(..., description="Target portfolio identifier."),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> Holding:
    """Insert a new holding or replace it if the (ticker, portfolio_id) key exists.

    Uses DuckDB's ``INSERT OR REPLACE`` semantics so this endpoint acts as
    an upsert — safe to call when manually overriding a position.
    """
    db.execute(
        """
        INSERT OR REPLACE INTO holdings (ticker, quantity, average_buy_price, portfolio_id)
        VALUES (?, ?, ?, ?)
        """,
        [body.ticker, body.quantity, body.average_buy_price, portfolio_id],
    )
    db.commit()
    return Holding(
        ticker=body.ticker,
        quantity=body.quantity,
        average_buy_price=body.average_buy_price,
        portfolio_id=portfolio_id,
    )


@app.patch(
    "/portfolios/{portfolio_id}/holdings/{ticker}",
    response_model=Holding,
    summary="Partially update a holding",
    tags=["Holdings"],
)
def update_holding(
    body: HoldingUpdate,
    portfolio_id: str = Path(..., description="Target portfolio identifier."),
    ticker: str = Path(..., description="Ticker symbol to update."),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> Holding:
    """Partially update ``quantity`` and / or ``average_buy_price`` for a holding.

    Returns 404 if the (ticker, portfolio_id) pair does not exist.
    """
    ticker = ticker.strip().upper()

    existing = db.execute(
        "SELECT ticker, quantity, average_buy_price, portfolio_id FROM holdings WHERE ticker = ? AND portfolio_id = ?",
        [ticker, portfolio_id],
    ).fetchone()

    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Holding '{ticker}' not found in portfolio '{portfolio_id}'.",
        )

    new_quantity = body.quantity if body.quantity is not None else existing[1]
    new_avg_price = body.average_buy_price if body.average_buy_price is not None else existing[2]

    db.execute(
        """
        UPDATE holdings
        SET    quantity = ?, average_buy_price = ?
        WHERE  ticker = ? AND portfolio_id = ?
        """,
        [new_quantity, new_avg_price, ticker, portfolio_id],
    )
    db.commit()

    return Holding(
        ticker=ticker,
        quantity=new_quantity,
        average_buy_price=new_avg_price,
        portfolio_id=portfolio_id,
    )


@app.delete(
    "/portfolios/{portfolio_id}/holdings/{ticker}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a holding from a portfolio",
    tags=["Holdings"],
)
def delete_holding(
    portfolio_id: str = Path(..., description="Target portfolio identifier."),
    ticker: str = Path(..., description="Ticker symbol to remove."),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> None:
    """Delete a single holding row. Returns 404 if it does not exist."""
    ticker = ticker.strip().upper()

    result = db.execute(
        "SELECT 1 FROM holdings WHERE ticker = ? AND portfolio_id = ?",
        [ticker, portfolio_id],
    ).fetchone()

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Holding '{ticker}' not found in portfolio '{portfolio_id}'.",
        )

    db.execute(
        "DELETE FROM holdings WHERE ticker = ? AND portfolio_id = ?",
        [ticker, portfolio_id],
    )
    db.commit()


# ---------------------------------------------------------------------------
# Transactions routes
# ---------------------------------------------------------------------------


@app.get(
    "/portfolios/{portfolio_id}/transactions",
    response_model=list[Transaction],
    summary="List all transactions for a portfolio",
    tags=["Transactions"],
)
def list_transactions(
    portfolio_id: str = Path(..., description="Target portfolio identifier."),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> list[Transaction]:
    """Return all transaction records for the given portfolio, newest first."""
    rows = db.execute(
        """
        SELECT id, ticker, action, price, quantity, transaction_date, portfolio_id
        FROM   transactions
        WHERE  portfolio_id = ?
        ORDER  BY transaction_date DESC
        """,
        [portfolio_id],
    ).fetchall()
    return [_row_to_transaction(r) for r in rows]


@app.post(
    "/portfolios/{portfolio_id}/transactions",
    response_model=Transaction,
    status_code=status.HTTP_201_CREATED,
    summary="Record a new trade and update the holding",
    tags=["Transactions"],
)
def create_transaction(
    body: TransactionCreate,
    portfolio_id: str = Path(..., description="Target portfolio identifier."),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> Transaction:
    """Persist a trade and automatically update the corresponding holding.

    Business logic
    --------------
    - **BUY**: Upsert the holding using a volume-weighted average price
      formula to blend the new purchase into the existing position.
    - **SELL**: Reduce ``quantity`` by the amount sold.  Raises 400 if the
      sell quantity exceeds the held quantity.  Removes the holding row if
      quantity reaches zero.

    Returns the persisted Transaction record.
    """
    ticker = body.ticker

    # ── Insert transaction record ──────────────────────────────────────────
    db.execute(
        """
        INSERT INTO transactions (ticker, action, price, quantity, transaction_date, portfolio_id)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [ticker, body.action.value, body.price, body.quantity, body.transaction_date, portfolio_id],
    )

    # ── Update holdings ────────────────────────────────────────────────────
    existing = db.execute(
        "SELECT quantity, average_buy_price FROM holdings WHERE ticker = ? AND portfolio_id = ?",
        [ticker, portfolio_id],
    ).fetchone()

    if body.action.value == "BUY":
        if existing is None:
            # First purchase of this ticker.
            db.execute(
                "INSERT INTO holdings (ticker, quantity, average_buy_price, portfolio_id) VALUES (?, ?, ?, ?)",
                [ticker, body.quantity, body.price, portfolio_id],
            )
        else:
            old_qty, old_avg = existing[0], existing[1]
            new_qty = old_qty + body.quantity
            # Volume-weighted average price.
            new_avg = (old_qty * old_avg + body.quantity * body.price) / new_qty
            db.execute(
                "UPDATE holdings SET quantity = ?, average_buy_price = ? WHERE ticker = ? AND portfolio_id = ?",
                [new_qty, new_avg, ticker, portfolio_id],
            )

    else:  # SELL
        if existing is None:
            db.conn.rollback() if hasattr(db, "conn") else None
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot sell '{ticker}': no holding found in portfolio '{portfolio_id}'.",
            )
        old_qty = existing[0]
        if body.quantity > old_qty:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Cannot sell {body.quantity} units of '{ticker}': "
                    f"only {old_qty} units held."
                ),
            )
        new_qty = old_qty - body.quantity
        if new_qty == 0:
            db.execute(
                "DELETE FROM holdings WHERE ticker = ? AND portfolio_id = ?",
                [ticker, portfolio_id],
            )
        else:
            db.execute(
                "UPDATE holdings SET quantity = ? WHERE ticker = ? AND portfolio_id = ?",
                [new_qty, ticker, portfolio_id],
            )

    db.commit()

    # ── Return persisted record ────────────────────────────────────────────
    row = db.execute(
        """
        SELECT id, ticker, action, price, quantity, transaction_date, portfolio_id
        FROM   transactions
        WHERE  ticker = ? AND portfolio_id = ? AND transaction_date = ?
        ORDER  BY id DESC LIMIT 1
        """,
        [ticker, portfolio_id, body.transaction_date],
    ).fetchone()

    return _row_to_transaction(row)


# ---------------------------------------------------------------------------
# Price data routes
# ---------------------------------------------------------------------------


@app.post(
    "/portfolios/{portfolio_id}/prices/refresh",
    summary="Refresh market prices for all holdings in a portfolio",
    tags=["Prices"],
)
def refresh_prices(
    portfolio_id: str = Path(..., description="Target portfolio identifier."),
    force: bool = False,
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> dict[str, object]:
    """Fetch the latest 1-year daily close prices for every ticker held in the
    portfolio via yfinance, persist them to ``daily_prices``, and return a
    summary of the operation.

    Query parameters
    ----------------
    force:
        Set to ``true`` to bypass the local parquet cache and always fetch
        fresh data from yfinance, even if the cache is still within TTL.
    """
    prices = refresh_portfolio_prices(portfolio_id, db, force_refresh=force)

    if prices.empty:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Could not refresh prices for portfolio '{portfolio_id}'. "
                "Verify the portfolio has holdings and network connectivity."
            ),
        )

    return {
        "portfolio_id": portfolio_id,
        "tickers_refreshed": prices.columns.tolist(),
        "date_range_start": str(prices.index.min().date()),
        "date_range_end": str(prices.index.max().date()),
        "rows_stored": int(prices.count().sum()),
        "force_refresh": force,
    }


@app.get(
    "/portfolios/{portfolio_id}/prices/{ticker}",
    response_model=list[PricePoint],
    summary="Get stored daily close prices for a ticker",
    tags=["Prices"],
)
def get_ticker_prices(
    portfolio_id: str = Path(..., description="Target portfolio identifier."),
    ticker: str = Path(..., description="Ticker symbol, e.g. 'AAPL' or 'RELIANCE.NS'."),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> list[PricePoint]:
    """Return the stored daily close-price history for a single ticker from
    the ``daily_prices`` table.

    The ``portfolio_id`` path segment is used to verify the ticker belongs to
    the portfolio.  Data must be seeded first via the ``/prices/refresh``
    endpoint.  The response is ordered by date ascending for direct consumption
    by a Recharts ``<LineChart>``.
    """
    ticker = ticker.strip().upper()

    # Verify the ticker belongs to this portfolio.
    holding = db.execute(
        "SELECT 1 FROM holdings WHERE ticker = ? AND portfolio_id = ?",
        [ticker, portfolio_id],
    ).fetchone()
    if holding is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Ticker '{ticker}' is not held in portfolio '{portfolio_id}'.",
        )

    rows = db.execute(
        """
        SELECT price_date, close_price
        FROM   daily_prices
        WHERE  ticker = ?
        ORDER  BY price_date ASC
        """,
        [ticker],
    ).fetchall()

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No price data found for '{ticker}'. "
                "Run POST /portfolios/{portfolio_id}/prices/refresh first."
            ),
        )

    return [PricePoint(date=row[0], close=row[1]) for row in rows]


# ---------------------------------------------------------------------------
# Analytics route
# ---------------------------------------------------------------------------


@app.get(
    "/portfolios/{portfolio_id}/analytics",
    response_model=PortfolioAnalytics,
    summary="Full quantitative analytics for a portfolio",
    tags=["Analytics"],
)
def get_portfolio_analytics(
    portfolio_id: str = Path(..., description="Target portfolio identifier."),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> PortfolioAnalytics:
    """Return the complete quantitative analytics payload for a portfolio.

    What is computed
    ----------------
    - Per-holding market value, cost basis, and unrealised P&L (using the
      most recent price stored in ``daily_prices``).
    - Portfolio-level totals and current weights.
    - Annualised portfolio volatility (σ_p × √252) from 1-year log-return
      covariance at current weights.
    - Max-Sharpe optimal weights via PyPortfolioOpt (Ledoit-Wolf covariance
      shrinkage + CAGR expected returns).
    - Rebalancing deltas (optimal − current weight) per ticker.

    Prerequisites
    -------------
    At least one price-refresh call (``POST .../prices/refresh``) must have
    been made so that ``daily_prices`` is populated.  If no price data is
    stored, market values fall back to cost basis and volatility /
    optimisation are omitted; non-fatal warnings are included in the response.

    Returns 404 if the portfolio has no holdings.
    """
    try:
        return run_portfolio_analytics(portfolio_id, db)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )


# ---------------------------------------------------------------------------
# AI Advisor route
# ---------------------------------------------------------------------------


@app.get(
    "/portfolios/{portfolio_id}/advisor",
    response_model=AdvisorResponse,
    summary="Generate AI-powered portfolio advice via local Ollama LLM",
    tags=["AI Advisor"],
)
async def get_ai_advice(
    portfolio_id: str = Path(..., description="Target portfolio identifier."),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> AdvisorResponse:
    """Compute full portfolio analytics and pass them to a locally running
    Llama 3 model via Ollama to generate plain-English rebalancing advice.

    Workflow
    --------
    1. Run :func:`~backend.quant_engine.run_portfolio_analytics` to assemble
       the full analytics payload (market values, P&L, volatility, optimal
       weights).
    2. Serialise the payload into a structured, token-efficient prompt and
       send it to ``llama3`` via the Ollama async client.
    3. Return the LLM's markdown-formatted advisory text.

    Fallback behaviour
    ------------------
    If the Ollama service is not running (``ollama serve`` not started) or the
    ``llama3`` model has not been pulled, the endpoint returns a static,
    data-driven summary with ``is_fallback=True`` and ``error_detail`` set.
    This ensures the frontend AI panel always has content to display.

    Prerequisites
    -------------
    - At least one price refresh must have been performed so that volatility
      and optimisation data are available for the prompt.
    - Ollama must be running locally: ``ollama serve``
    - The llama3 model must be pulled: ``ollama pull llama3``

    Returns 404 if the portfolio has no holdings.
    """
    # ── 1. Compute analytics (sync – fast DB + pandas work) ────────────────
    try:
        analytics = run_portfolio_analytics(portfolio_id, db)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )

    # ── 2. Generate LLM advice (async – slow, up to ~40s on 8B model) ─────
    return await generate_advice(analytics)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get("/health", tags=["Meta"], summary="Health check")
def health() -> dict[str, str]:
    """Return a simple liveness signal."""
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}
