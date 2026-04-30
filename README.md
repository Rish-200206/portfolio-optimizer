# Portfolio Optimizer

A **100% local** quantitative finance portfolio dashboard. Tracks your holdings, fetches live market prices, computes risk/return analytics, optimises your portfolio weights for maximum Sharpe ratio, and generates plain-English rebalancing advice — all running on your own machine with no cloud services or API keys.

---

## What It Does

| Capability | Detail |
|---|---|
| **Portfolio tracking** | Record BUY / SELL transactions; holdings are updated automatically via VWAP blending |
| **Live market data** | Fetches 1-year daily close prices via yfinance with a 12-hour local parquet cache |
| **Unrealised P&L** | Per-holding and portfolio-level cost-basis vs market-value calculations |
| **Volatility** | Annualised portfolio volatility (σ_p × √252) from the log-return covariance matrix |
| **Sharpe optimisation** | PyPortfolioOpt max-Sharpe weights using Ledoit-Wolf covariance shrinkage |
| **AI advisor** | Llama 3 (local, via Ollama) explains rebalancing decisions in plain English |
| **Price history chart** | 1-year interactive area chart per stock with buy-price reference line |
| **International tickers** | Supports `.NS` (India NSE), `.L` (London), and any yfinance-compatible suffix |

---

## Tech Stack

### Backend
| Technology | Version | Role |
|---|---|---|
| **Python** | 3.11+ | Runtime |
| **FastAPI** | 0.115 | REST API framework |
| **DuckDB** | 1.1 | Local analytical database (portfolio.duckdb) |
| **Pydantic v2** | 2.10 | Request validation & response serialisation |
| **yfinance** | 0.2.50 | Market data fetching |
| **pandas** | 2.2 | Data wrangling & returns calculation |
| **numpy** | 2.0 | Linear algebra for volatility computation |
| **PyPortfolioOpt** | 1.5 | Efficient frontier & Sharpe optimisation |
| **ollama** | 0.4 | Local LLM inference client |
| **uvicorn** | 0.32 | ASGI server |

### Frontend
| Technology | Version | Role |
|---|---|---|
| **React** | 18.3 | UI library |
| **Vite** | 5.4 | Build tool & dev server |
| **Tailwind CSS** | 3.4 | Utility-first styling |
| **Recharts** | 2.13 | Price history area chart |
| **react-router-dom** | 6.28 | Client-side routing |
| **react-markdown** | 9.0 | Renders LLM markdown output |

### AI / Local LLM
| Technology | Role |
|---|---|
| **Ollama** | Local LLM runtime |
| **Llama 3 (8B)** | Default model for portfolio advisory |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Browser (localhost:5173)                   │
│                                                                  │
│  Navbar ── Portfolio Selector ── Refresh Prices                  │
│  │                                                               │
│  ├─ SummaryPage                                                  │
│  │    MetricCards (value, P&L, volatility, positions)            │
│  │    HoldingsGrid ── HoldingCard × N                           │
│  │                                                               │
│  └─ DetailPage (click any holding)                               │
│       PriceChart (Recharts AreaChart, 1yr)                       │
│       HoldingDetailCard (metrics panel)                          │
│       RebalancingPanel (weight visualiser)                       │
│       AiAdvisorPanel (Ollama markdown)                           │
└───────────────────────────┬──────────────────────────────────────┘
                            │  HTTP via Vite proxy (/api → :8000)
┌───────────────────────────▼──────────────────────────────────────┐
│                    FastAPI (localhost:8000)                       │
│                                                                  │
│  main.py ── routes                                               │
│  ├── database.py      DuckDB connection + schema init            │
│  ├── models.py        Pydantic v2 models                         │
│  ├── data_ingestion.py yfinance + parquet cache → daily_prices   │
│  ├── quant_engine.py  P&L · volatility · Sharpe optimisation     │
│  └── ai_advisor.py    Ollama AsyncClient → AdvisorResponse       │
│                                   │                              │
│  portfolio.duckdb ◄───────────────┘                              │
│  ├── holdings       (ticker, qty, avg_price, portfolio_id)       │
│  ├── transactions   (id, ticker, action, price, qty, date, pid)  │
│  └── daily_prices   (ticker, price_date, close_price)            │
└──────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│                   Ollama (localhost:11434)                        │
│                   llama3 (8B, local)                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

| Requirement | Min version | Install |
|---|---|---|
| Python | 3.11 | [python.org](https://python.org) |
| Node.js | 18 LTS | [nodejs.org](https://nodejs.org) |
| npm | 9 | bundled with Node |
| Ollama | latest | [ollama.com](https://ollama.com) |

> **Ollama is optional.** If it's not running, the AI Advisor panel shows a data-driven fallback summary instead of LLM output.

---

## Installation

### 1 — Clone the repository

```bash
git clone <your-repo-url>
cd Portfolio_optimizer
```

### 2 — Backend: create virtual environment & install dependencies

```bash
python3 -m venv .venv

# macOS / Linux
source .venv/bin/activate

# Windows (PowerShell)
.\.venv\Scripts\Activate.ps1

pip install -r backend/requirements.txt
```

### 3 — Frontend: install Node dependencies

```bash
cd frontend
npm install
cd ..
```

### 4 — Ollama: pull the LLM (optional but recommended)

```bash
# Install Ollama from https://ollama.com, then:
ollama pull llama3
```

---

## Running the Application

You need **two terminals** running simultaneously (three if using Ollama).

### Terminal 1 — Backend API

```bash
source .venv/bin/activate          # activate the virtual environment
uvicorn backend.main:app --reload --port 8000
```

API is live at **http://localhost:8000**
Interactive docs at **http://localhost:8000/docs**

### Terminal 2 — Frontend Dev Server

```bash
cd frontend
npm run dev
```

Dashboard is live at **http://localhost:5173**

### Terminal 3 — Ollama (optional, for AI Advisor)

```bash
ollama serve        # starts the local LLM runtime
```

> If Ollama is not running, the AI Advisor panel still works — it shows a static data-driven summary with a notice that LLM analysis is unavailable.

---

## First Steps: Adding Portfolio Data

The dashboard requires at least one holding in the database before it will display anything. Use the Swagger UI at **http://localhost:8000/docs** or `curl`/any HTTP client.

### Add a holding (direct position entry)

```bash
curl -X POST "http://localhost:8000/portfolios/my_portfolio/holdings" \
  -H "Content-Type: application/json" \
  -d '{"ticker": "AAPL", "quantity": 10, "average_buy_price": 175.00}'
```

### Record a BUY transaction (auto-updates the holding)

```bash
curl -X POST "http://localhost:8000/portfolios/my_portfolio/transactions" \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "MSFT",
    "action": "BUY",
    "price": 415.50,
    "quantity": 5,
    "transaction_date": "2024-03-15T10:30:00"
  }'
```

**Indian equities** — use the `.NS` suffix:
```bash
curl -X POST "http://localhost:8000/portfolios/my_portfolio/holdings" \
  -H "Content-Type: application/json" \
  -d '{"ticker": "RELIANCE.NS", "quantity": 50, "average_buy_price": 2450.00}'
```

### Refresh market prices

After adding holdings, fetch live price data (required for analytics):

```bash
curl -X POST "http://localhost:8000/portfolios/my_portfolio/prices/refresh"
```

Or click the **Refresh Prices** button in the top-right of the dashboard navbar.

---

## API Reference

All endpoints are prefixed with `http://localhost:8000`. Full interactive documentation available at `/docs`.

### Portfolios

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/portfolios` | List all portfolio IDs |
| `GET` | `/portfolios/{pid}/summary` | Cost-basis aggregate (fast, no prices needed) |
| `GET` | `/portfolios/{pid}/analytics` | Full analytics: P&L, volatility, Sharpe optimisation |
| `GET` | `/portfolios/{pid}/advisor` | AI advisory report (calls local Ollama) |

### Holdings

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/portfolios/{pid}/holdings` | List all holdings |
| `POST` | `/portfolios/{pid}/holdings` | Add or upsert a holding |
| `PATCH` | `/portfolios/{pid}/holdings/{ticker}` | Partial update (qty / avg price) |
| `DELETE` | `/portfolios/{pid}/holdings/{ticker}` | Remove a holding |

### Transactions

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/portfolios/{pid}/transactions` | Transaction history (newest first) |
| `POST` | `/portfolios/{pid}/transactions` | Record BUY or SELL, auto-updates holding |

### Prices

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/portfolios/{pid}/prices/refresh` | Fetch from yfinance & cache to DB |
| `GET` | `/portfolios/{pid}/prices/{ticker}` | Get stored daily close history |

### Meta

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |

---

## Frontend Routes

| Route | View |
|---|---|
| `/` | Summary dashboard — portfolio selector, MetricCards, HoldingsGrid |
| `/holdings/:ticker?pid=:portfolioId` | Detail view — price chart, holding metrics, rebalancing panel, AI advisor |

---

## How the Analytics Work

### Unrealised P&L
```
cost_basis      = quantity × average_buy_price
market_value    = quantity × latest_close_price
unrealised_pnl  = market_value − cost_basis
pnl_pct         = (unrealised_pnl / cost_basis) × 100
```

### Portfolio Volatility
Daily log-returns are computed from `daily_prices`, then:
```
σ_p = √(w ᵀ Σ w) × √252
```
where `Σ` is the covariance matrix of log-returns and `w` is the vector of current portfolio weights.

### Sharpe Optimisation
Uses [PyPortfolioOpt](https://github.com/robertmartin8/PyPortfolioOpt):
- **Expected returns**: CAGR-based mean historical return (`compounding=True`)
- **Covariance**: Ledoit-Wolf shrinkage estimator (more robust than sample covariance for small portfolios)
- **Objective**: Maximise Sharpe ratio with risk-free rate = 5%
- **Output**: Cleaned optimal weights + projected return, volatility, and Sharpe ratio

### Transaction VWAP Blending (BUY)
When a BUY transaction is recorded, the average buy price is updated as:
```
new_avg = (old_qty × old_avg + new_qty × trade_price) / (old_qty + new_qty)
```

---

## Project Structure

```
Portfolio_optimizer/
│
├── .venv/                      ← Python virtual environment (git-ignored)
├── .gitignore
├── README.md
│
├── backend/
│   ├── __init__.py
│   ├── main.py                 ← FastAPI app, lifespan, all HTTP routes
│   ├── models.py               ← Pydantic v2 models (request, response, DTOs)
│   ├── database.py             ← DuckDB connection, schema DDL, get_db()
│   ├── data_ingestion.py       ← yfinance fetch, parquet cache, DB upsert
│   ├── quant_engine.py         ← P&L, volatility, Sharpe optimisation
│   ├── ai_advisor.py           ← Ollama async client, prompt, fallback
│   ├── requirements.txt
│   ├── portfolio.duckdb        ← on-disk database (git-ignored)
│   └── price_cache/            ← per-ticker parquet files (git-ignored)
│       └── .gitkeep
│
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js          ← /api proxy → localhost:8000
    ├── tailwind.config.js      ← surface.* custom colour tokens
    ├── postcss.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx             ← BrowserRouter, portfolio state, routes
        ├── index.css           ← Tailwind + .card, .gain/.loss, .md-prose
        ├── api/
        │   └── client.js       ← fetch wrappers for all endpoints
        ├── utils/
        │   └── format.js       ← fmtCurrency, fmtPctSigned, gainLossClass…
        ├── components/
        │   ├── Navbar.jsx      ← sticky header, portfolio selector, refresh btn
        │   ├── MetricCard.jsx  ← reusable stat tile
        │   ├── HoldingCard.jsx ← master-view grid tile (links to detail)
        │   ├── Spinner.jsx     ← loading indicator
        │   ├── PriceChart.jsx  ← Recharts AreaChart + avg-price ReferenceLine
        │   ├── HoldingDetailCard.jsx ← position metrics panel
        │   ├── RebalancingPanel.jsx  ← weight visualiser + action badges
        │   └── AiAdvisorPanel.jsx    ← Ollama advisory + markdown renderer
        └── pages/
            ├── SummaryPage.jsx ← master view
            └── DetailPage.jsx  ← detail view (chart + metrics + AI)
```

---

## Configuration

The following constants can be changed directly in their source files (no `.env` required for local use):

| Constant | File | Default | Description |
|---|---|---|---|
| `DB_PATH` | `backend/database.py` | `backend/portfolio.duckdb` | DuckDB file location |
| `CACHE_DIR` | `backend/data_ingestion.py` | `backend/price_cache/` | Parquet cache directory |
| `CACHE_TTL_HOURS` | `backend/data_ingestion.py` | `12` | Hours before re-fetching from yfinance |
| `HISTORY_PERIOD` | `backend/data_ingestion.py` | `"1y"` | yfinance historical window |
| `RISK_FREE_RATE` | `backend/quant_engine.py` | `0.05` | Annualised risk-free rate for Sharpe |
| `TRADING_DAYS` | `backend/quant_engine.py` | `252` | Trading days per year |
| `MIN_PRICE_ROWS` | `backend/quant_engine.py` | `60` | Min rows for stable covariance estimate |
| `OLLAMA_MODEL` | `backend/ai_advisor.py` | `"llama3"` | Ollama model tag |
| `OLLAMA_HOST` | `backend/ai_advisor.py` | `"http://localhost:11434"` | Ollama service URL |
| `MAX_TOKENS` | `backend/ai_advisor.py` | `900` | LLM max output tokens |
| `TEMPERATURE` | `backend/ai_advisor.py` | `0.25` | LLM sampling temperature |

---

## Known Limitations

- **No authentication**: all portfolios are accessible to anyone who can reach `localhost:8000`. Do not expose the API to a network without adding auth.
- **Single-writer DuckDB**: DuckDB allows only one writer at a time. The app uses one connection per request, which is safe for single-user local use but will not scale to concurrent users.
- **yfinance rate limits**: fetching many tickers rapidly can trigger HTTP 429 responses. The 12-hour parquet cache mitigates this after the first load.
- **Optimiser requires 60+ days of data**: PyPortfolioOpt's covariance estimation is unstable below ~60 trading days. The engine silently returns `optimisation: null` below this threshold.
- **LLM latency**: Llama 3 8B on CPU can take 30–90 seconds per generation. On Apple Silicon MPS or NVIDIA CUDA, this drops to 5–15 seconds.
- **No real-time prices**: yfinance provides end-of-day data. The "Refresh Prices" action fetches the most recent closing prices, not live intraday quotes.

---

## License

MIT — see `LICENSE` for details.
