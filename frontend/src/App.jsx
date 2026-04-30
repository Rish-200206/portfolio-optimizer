import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { getPortfolios } from './api/client'
import Navbar from './components/Navbar'
import Spinner from './components/Spinner'
import SummaryPage from './pages/SummaryPage'
import DetailPage from './pages/DetailPage'

// ---------------------------------------------------------------------------
// Empty state — shown when the database has no portfolios yet
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-6">
      <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/20
                      flex items-center justify-center text-3xl">
        📊
      </div>
      <div className="max-w-md">
        <h2 className="text-2xl font-bold text-white mb-2">No portfolios yet</h2>
        <p className="text-gray-400 text-sm">
          Add your first holding via the API (or Swagger UI at{' '}
          <code className="text-indigo-400 text-xs bg-indigo-400/10 px-1.5 py-0.5 rounded">
            /docs
          </code>
          ) to get started.
        </p>
      </div>
      <div className="w-full max-w-lg text-left">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-600 mb-2">
          Example — add a holding
        </p>
        <pre className="card p-4 text-xs font-mono text-emerald-400 overflow-x-auto">
{`POST http://localhost:8000/portfolios/my_portfolio/holdings
Content-Type: application/json

{
  "ticker": "AAPL",
  "quantity": 10,
  "average_buy_price": 175.00
}`}
        </pre>
        <p className="text-xs text-gray-600 mt-2">
          After adding holdings, click{' '}
          <span className="text-gray-400">Refresh Prices</span> in the navbar
          to fetch live market data and enable analytics.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root application component
// ---------------------------------------------------------------------------

export default function App() {
  const [portfolios, setPortfolios]               = useState([])
  const [selectedPortfolio, setSelectedPortfolio] = useState(null)
  const [loadingPortfolios, setLoadingPortfolios] = useState(true)
  const [portfolioError, setPortfolioError]       = useState(null)

  useEffect(() => {
    getPortfolios()
      .then((data) => {
        setPortfolios(data)
        if (data.length > 0) setSelectedPortfolio(data[0])
      })
      .catch((err) => setPortfolioError(err.message))
      .finally(() => setLoadingPortfolios(false))
  }, [])

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#0d1117] text-white">

        {/* ── Sticky navigation bar ─────────────────────────────────────── */}
        <Navbar
          portfolios={portfolios}
          selectedPortfolio={selectedPortfolio}
          onSelectPortfolio={setSelectedPortfolio}
        />

        {/* ── Page content ──────────────────────────────────────────────── */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Portfolio list loading */}
          {loadingPortfolios && <Spinner label="Connecting to backend…" />}

          {/* Backend unreachable */}
          {portfolioError && !loadingPortfolios && (
            <div className="card border-red-700/50 bg-red-900/10 p-6 text-center max-w-lg mx-auto mt-16">
              <p className="text-red-400 font-semibold">Cannot reach the backend</p>
              <p className="text-sm text-red-300/70 mt-1">{portfolioError}</p>
              <p className="text-xs text-gray-500 mt-3">
                Start the API server:{' '}
                <code className="text-gray-400">
                  uvicorn backend.main:app --reload --port 8000
                </code>
              </p>
            </div>
          )}

          {/* Normal routing — only rendered once portfolios have loaded */}
          {!loadingPortfolios && !portfolioError && (
            <Routes>
              <Route
                path="/"
                element={
                  portfolios.length === 0 ? (
                    <EmptyState />
                  ) : selectedPortfolio ? (
                    <SummaryPage portfolioId={selectedPortfolio} />
                  ) : null
                }
              />
              {/* Detail route — implemented in Step 6 */}
              <Route
                path="/holdings/:ticker"
                element={<DetailPage portfolioId={selectedPortfolio} />}
              />
            </Routes>
          )}
        </main>
      </div>
    </BrowserRouter>
  )
}
