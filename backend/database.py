"""
database.py
-----------
Manages the local DuckDB connection lifecycle and schema initialisation.

Responsibilities:
- Resolve the path to the on-disk `portfolio.duckdb` file.
- Expose `init_db()` to be called once at application startup.
- Expose `get_db()` as a FastAPI dependency that yields a fresh, auto-closing
  DuckDB connection for every request.
"""

from __future__ import annotations

from pathlib import Path
from typing import Generator

import duckdb

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

#: Absolute path to the DuckDB file that lives alongside this module.
DB_PATH: Path = Path(__file__).parent / "portfolio.duckdb"

# ---------------------------------------------------------------------------
# Schema DDL
# ---------------------------------------------------------------------------

_DDL_HOLDINGS: str = """
CREATE TABLE IF NOT EXISTS holdings (
    ticker          VARCHAR  NOT NULL,
    quantity        DOUBLE   NOT NULL,
    average_buy_price DOUBLE NOT NULL,
    portfolio_id    VARCHAR  NOT NULL,
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
    action           VARCHAR   NOT NULL,   -- 'BUY' | 'SELL'
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


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def get_connection() -> duckdb.DuckDBPyConnection:
    """Open and return a new DuckDB connection to the local portfolio database.

    Callers are responsible for closing the connection when finished.
    In FastAPI request handlers, use :func:`get_db` instead.

    Returns
    -------
    duckdb.DuckDBPyConnection
        A live connection to ``portfolio.duckdb``.
    """
    return duckdb.connect(str(DB_PATH))


def init_db() -> None:
    """Create all required tables and sequences if they do not already exist.

    This function is idempotent and safe to call on every application start.
    It should be invoked inside the FastAPI ``lifespan`` context before
    accepting any requests.
    """
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
    """FastAPI dependency: yield a per-request DuckDB connection.

    Opens a fresh connection at the start of each request and guarantees
    it is closed (and any transaction rolled back) when the request ends,
    regardless of success or failure.

    Yields
    ------
    duckdb.DuckDBPyConnection
        A live connection scoped to the current HTTP request.

    Example
    -------
    .. code-block:: python

        @app.get("/example")
        def example(db: duckdb.DuckDBPyConnection = Depends(get_db)):
            return db.execute("SELECT 1").fetchone()
    """
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()
