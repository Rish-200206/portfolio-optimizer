from __future__ import annotations

from pathlib import Path
from typing import Generator

import duckdb

DB_PATH: Path = Path(__file__).parent / "portfolio.duckdb"

_DDL_HOLDINGS: str = """
CREATE TABLE IF NOT EXISTS holdings (
    ticker            VARCHAR  NOT NULL,
    quantity          DOUBLE   NOT NULL,
    average_buy_price DOUBLE   NOT NULL,
    portfolio_id      VARCHAR  NOT NULL,
    PRIMARY KEY (ticker, portfolio_id)
);
"""

_DDL_TRANSACTIONS_SEQ: str = """
CREATE SEQUENCE IF NOT EXISTS seq_transactions START 1;
"""

_DDL_TRANSACTIONS: str = """
CREATE TABLE IF NOT EXISTS transactions (
    id               BIGINT    DEFAULT nextval('seq_transactions'),
    ticker           VARCHAR   NOT NULL,
    action           VARCHAR   NOT NULL,
    price            DOUBLE    NOT NULL,
    quantity         DOUBLE    NOT NULL,
    transaction_date TIMESTAMP NOT NULL,
    portfolio_id     VARCHAR   NOT NULL,
    PRIMARY KEY (id)
);
"""

_DDL_DAILY_PRICES: str = """
CREATE TABLE IF NOT EXISTS daily_prices (
    ticker      VARCHAR NOT NULL,
    price_date  DATE    NOT NULL,
    close_price DOUBLE  NOT NULL,
    PRIMARY KEY (ticker, price_date)
);
"""


def get_connection() -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(DB_PATH))


def init_db() -> None:
    """Create tables and sequences on startup. Safe to call multiple times."""
    conn = get_connection()
    try:
        conn.execute(_DDL_TRANSACTIONS_SEQ)
        conn.execute(_DDL_HOLDINGS)
        conn.execute(_DDL_TRANSACTIONS)
        conn.execute(_DDL_DAILY_PRICES)
        conn.commit()
    finally:
        conn.close()


def get_db() -> Generator[duckdb.DuckDBPyConnection, None, None]:
    """FastAPI dependency — yields one connection per request, closed on exit."""
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()
