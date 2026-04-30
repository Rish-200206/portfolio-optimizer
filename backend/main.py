from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncGenerator

logger = logging.getLogger(__name__)

import duckdb
from fastapi import Depends, FastAPI, HTTPException, Path, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .ai_advisor import generate_advice, generate_chat_response
from .data_ingestion import load_prices_from_db, refresh_portfolio_prices
from .database import get_db, init_db
from .ticker_search import init_tickers, refresh_tickers, search_local, search_yahoo
from .models import (
    AdvisorResponse,
    ChatRequest,
    ChatResponse,
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


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    init_db()
    await init_tickers()
    yield


app = FastAPI(
    title="Portfolio Optimizer API",
    version="0.1.0",
    description="Local quantitative finance dashboard. Powered by DuckDB, PyPortfolioOpt, and Ollama.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _row_to_holding(row: tuple) -> Holding:
    return Holding(ticker=row[0], quantity=row[1], average_buy_price=row[2], portfolio_id=row[3])


def _row_to_transaction(row: tuple) -> Transaction:
    return Transaction(
        id=row[0], ticker=row[1], action=row[2], price=row[3],
        quantity=row[4], transaction_date=row[5], portfolio_id=row[6],
    )


@app.get("/portfolios", response_model=list[str], tags=["Portfolios"])
def list_portfolios(db: duckdb.DuckDBPyConnection = Depends(get_db)) -> list[str]:
    rows = db.execute("SELECT DISTINCT portfolio_id FROM holdings ORDER BY portfolio_id").fetchall()
    return [r[0] for r in rows]


@app.get("/portfolios/{portfolio_id}/summary", response_model=PortfolioSummary, tags=["Portfolios"])
def get_portfolio_summary(
    portfolio_id: str = Path(...),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> PortfolioSummary:
    row = db.execute(
        """
        SELECT COUNT(*), SUM(quantity * average_buy_price)
        FROM holdings WHERE portfolio_id = ?
        """,
        [portfolio_id],
    ).fetchone()

    if row is None or row[0] == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Portfolio '{portfolio_id}' not found or has no holdings.")

    return PortfolioSummary(
        portfolio_id=portfolio_id,
        total_invested=float(row[1]),
        total_market_value=float(row[1]),  # overwritten by quant_engine
        total_unrealised_pnl=0.0,
        total_unrealised_pnl_pct=0.0,
        holding_count=int(row[0]),
    )


@app.get("/portfolios/{portfolio_id}/holdings", response_model=list[Holding], tags=["Holdings"])
def list_holdings(
    portfolio_id: str = Path(...),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> list[Holding]:
    rows = db.execute(
        "SELECT ticker, quantity, average_buy_price, portfolio_id FROM holdings "
        "WHERE portfolio_id = ? ORDER BY ticker",
        [portfolio_id],
    ).fetchall()
    return [_row_to_holding(r) for r in rows]


@app.post("/portfolios/{portfolio_id}/holdings", response_model=Holding,
          status_code=status.HTTP_201_CREATED, tags=["Holdings"])
def create_or_upsert_holding(
    body: HoldingCreate,
    portfolio_id: str = Path(...),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> Holding:
    db.execute(
        "INSERT OR REPLACE INTO holdings (ticker, quantity, average_buy_price, portfolio_id) VALUES (?, ?, ?, ?)",
        [body.ticker, body.quantity, body.average_buy_price, portfolio_id],
    )
    db.commit()
    return Holding(ticker=body.ticker, quantity=body.quantity,
                   average_buy_price=body.average_buy_price, portfolio_id=portfolio_id)


@app.patch("/portfolios/{portfolio_id}/holdings/{ticker}", response_model=Holding, tags=["Holdings"])
def update_holding(
    body: HoldingUpdate,
    portfolio_id: str = Path(...),
    ticker: str = Path(...),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> Holding:
    ticker = ticker.strip().upper()
    existing = db.execute(
        "SELECT ticker, quantity, average_buy_price, portfolio_id FROM holdings "
        "WHERE ticker = ? AND portfolio_id = ?",
        [ticker, portfolio_id],
    ).fetchone()
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Holding '{ticker}' not found in portfolio '{portfolio_id}'.")

    new_quantity = body.quantity if body.quantity is not None else existing[1]
    new_avg_price = body.average_buy_price if body.average_buy_price is not None else existing[2]
    db.execute(
        "UPDATE holdings SET quantity = ?, average_buy_price = ? WHERE ticker = ? AND portfolio_id = ?",
        [new_quantity, new_avg_price, ticker, portfolio_id],
    )
    db.commit()
    return Holding(ticker=ticker, quantity=new_quantity,
                   average_buy_price=new_avg_price, portfolio_id=portfolio_id)


@app.delete("/portfolios/{portfolio_id}/holdings/{ticker}",
            status_code=status.HTTP_204_NO_CONTENT, response_class=Response,
            response_model=None, tags=["Holdings"])
def delete_holding(
    portfolio_id: str = Path(...),
    ticker: str = Path(...),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
):
    ticker = ticker.strip().upper()
    if db.execute("SELECT 1 FROM holdings WHERE ticker = ? AND portfolio_id = ?",
                  [ticker, portfolio_id]).fetchone() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Holding '{ticker}' not found in portfolio '{portfolio_id}'.")
    db.execute("DELETE FROM holdings WHERE ticker = ? AND portfolio_id = ?", [ticker, portfolio_id])
    db.commit()


@app.get("/portfolios/{portfolio_id}/transactions", response_model=list[Transaction], tags=["Transactions"])
def list_transactions(
    portfolio_id: str = Path(...),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> list[Transaction]:
    rows = db.execute(
        "SELECT id, ticker, action, price, quantity, transaction_date, portfolio_id "
        "FROM transactions WHERE portfolio_id = ? ORDER BY transaction_date DESC",
        [portfolio_id],
    ).fetchall()
    return [_row_to_transaction(r) for r in rows]


@app.post("/portfolios/{portfolio_id}/transactions", response_model=Transaction,
          status_code=status.HTTP_201_CREATED, tags=["Transactions"])
def create_transaction(
    body: TransactionCreate,
    portfolio_id: str = Path(...),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> Transaction:
    """BUY blends avg price via VWAP; SELL reduces qty or removes the holding at zero."""
    ticker = body.ticker

    db.execute(
        "INSERT INTO transactions (ticker, action, price, quantity, transaction_date, portfolio_id) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        [ticker, body.action.value, body.price, body.quantity, body.transaction_date, portfolio_id],
    )

    existing = db.execute(
        "SELECT quantity, average_buy_price FROM holdings WHERE ticker = ? AND portfolio_id = ?",
        [ticker, portfolio_id],
    ).fetchone()

    if body.action.value == "BUY":
        if existing is None:
            db.execute(
                "INSERT INTO holdings (ticker, quantity, average_buy_price, portfolio_id) VALUES (?, ?, ?, ?)",
                [ticker, body.quantity, body.price, portfolio_id],
            )
        else:
            old_qty, old_avg = existing[0], existing[1]
            new_qty = old_qty + body.quantity
            new_avg = (old_qty * old_avg + body.quantity * body.price) / new_qty
            db.execute(
                "UPDATE holdings SET quantity = ?, average_buy_price = ? WHERE ticker = ? AND portfolio_id = ?",
                [new_qty, new_avg, ticker, portfolio_id],
            )
    else:  # SELL
        if existing is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"Cannot sell '{ticker}': no holding in portfolio '{portfolio_id}'.")
        old_qty = existing[0]
        if body.quantity > old_qty:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"Cannot sell {body.quantity} of '{ticker}': only {old_qty} held.")
        new_qty = old_qty - body.quantity
        if new_qty == 0:
            db.execute("DELETE FROM holdings WHERE ticker = ? AND portfolio_id = ?", [ticker, portfolio_id])
        else:
            db.execute("UPDATE holdings SET quantity = ? WHERE ticker = ? AND portfolio_id = ?",
                       [new_qty, ticker, portfolio_id])

    db.commit()

    row = db.execute(
        "SELECT id, ticker, action, price, quantity, transaction_date, portfolio_id "
        "FROM transactions WHERE ticker = ? AND portfolio_id = ? AND transaction_date = ? "
        "ORDER BY id DESC LIMIT 1",
        [ticker, portfolio_id, body.transaction_date],
    ).fetchone()
    return _row_to_transaction(row)


@app.post("/portfolios/{portfolio_id}/prices/refresh", tags=["Prices"])
def refresh_prices(
    portfolio_id: str = Path(...),
    force: bool = False,
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> dict[str, object]:
    prices = refresh_portfolio_prices(portfolio_id, db, force_refresh=force)
    if prices.empty:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Could not refresh prices for '{portfolio_id}'. Check holdings and connectivity.")
    return {
        "portfolio_id": portfolio_id,
        "tickers_refreshed": prices.columns.tolist(),
        "date_range_start": str(prices.index.min().date()),
        "date_range_end": str(prices.index.max().date()),
        "rows_stored": int(prices.count().sum()),
        "force_refresh": force,
    }


@app.get("/portfolios/{portfolio_id}/prices/{ticker}", response_model=list[PricePoint], tags=["Prices"])
def get_ticker_prices(
    portfolio_id: str = Path(...),
    ticker: str = Path(...),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> list[PricePoint]:
    ticker = ticker.strip().upper()
    if db.execute("SELECT 1 FROM holdings WHERE ticker = ? AND portfolio_id = ?",
                  [ticker, portfolio_id]).fetchone() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"'{ticker}' is not held in portfolio '{portfolio_id}'.")
    rows = db.execute(
        "SELECT price_date, close_price FROM daily_prices WHERE ticker = ? ORDER BY price_date ASC",
        [ticker],
    ).fetchall()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"No price data for '{ticker}'. Run prices/refresh first.")
    return [PricePoint(date=row[0], close=row[1]) for row in rows]


@app.get("/portfolios/{portfolio_id}/analytics", response_model=PortfolioAnalytics, tags=["Analytics"])
def get_portfolio_analytics(
    portfolio_id: str = Path(...),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> PortfolioAnalytics:
    try:
        return run_portfolio_analytics(portfolio_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@app.get("/portfolios/{portfolio_id}/advisor", response_model=AdvisorResponse, tags=["AI Advisor"])
async def get_ai_advice(
    portfolio_id: str = Path(...),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> AdvisorResponse:
    try:
        analytics = run_portfolio_analytics(portfolio_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return await generate_advice(analytics)


@app.post("/portfolios/{portfolio_id}/chat", response_model=ChatResponse, tags=["AI Advisor"])
async def chat_with_advisor(
    body: ChatRequest,
    portfolio_id: str = Path(...),
    db: duckdb.DuckDBPyConnection = Depends(get_db),
) -> ChatResponse:
    analytics = None
    try:
        analytics = run_portfolio_analytics(portfolio_id, db)
    except Exception as exc:
        logger.warning("Could not load analytics for chat context ('%s'): %s", portfolio_id, exc)
    return await generate_chat_response(message=body.message, history=body.history, analytics=analytics)


@app.get("/search/tickers", tags=["Meta"])
async def search_tickers_endpoint(
    q: str = Query(..., min_length=1),
) -> list[dict]:
    """Search NSE/BSE local list first, fall back to Yahoo Finance for other exchanges."""
    local = search_local(q, limit=12)
    if len(local) < 4:
        yahoo = await search_yahoo(q, limit=8)
        local_syms = {r["symbol"] for r in local}
        local += [r for r in yahoo if r["symbol"] not in local_syms]
    return local[:15]


@app.post("/search/tickers/refresh", tags=["Meta"])
async def refresh_tickers_endpoint() -> dict:
    """Re-download the NSE/BSE equity lists. Also happens automatically on startup if CSV is >7 days old."""
    count = await refresh_tickers()
    return {"status": "ok", "tickers_stored": count}


@app.get("/health", tags=["Meta"])
def health() -> dict[str, str]:
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}
