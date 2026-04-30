import { useEffect, useState, useCallback } from 'react'
import { getAnalytics } from '../api/client'
import MetricCard from '../components/MetricCard'
import HoldingCard from '../components/HoldingCard'
import Spinner from '../components/Spinner'
import {
  fmtCurrency,
  fmtPctSigned,
  fmtPnlCurrency,
  fmtVolatility,
  gainLossClass,
} from '../utils/format'

/**
 * SummaryPage.jsx
 * ---------------
 * Master view — top-level portfolio dashboard.
 *
 * Layout
 * ------
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  [Total Value]  [Unrealised P&L]  [Volatility]  [Holdings] │  ← MetricCards row
 *  ├─────────────────────────────────────────────────────────────┤
 *  │  Holdings grid (1→2→3→4 cols responsive)                    │
 *  ├─────────────────────────────────────────────────────────────┤
 *  │  Notices (warnings from the quant engine)                   │
 *  └─────────────────────────────────────────────────────────────┘
 *
 * @param {object} props
 * @param {string} props.portfolioId
 */
export default function SummaryPage({ portfolioId }) {
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  const load = useCallback(() => {
    if (!portfolioId) return
    setLoading(true)
    setError(null)
    getAnalytics(portfolioId)
      .then(setAnalytics)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [portfolioId])

  useEffect(() => { load() }, [load])

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) return <Spinner label="Loading portfolio analytics…" />

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="card p-8 flex flex-col items-center gap-4 text-center max-w-lg mx-auto mt-16">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <p className="font-semibold text-white">Failed to load analytics</p>
          <p className="text-sm text-gray-400 mt-1">{error}</p>
          <p className="text-xs text-gray-500 mt-2">
            Try running a price refresh from the navbar, then reload.
          </p>
        </div>
        <button
          onClick={load}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm text-white transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!analytics) return null

  // ── Derived display values ─────────────────────────────────────────────
  const pnlClass = gainLossClass(analytics.total_unrealized_pnl)
  const pnlDisplay = fmtPnlCurrency(analytics.total_unrealized_pnl)
  const pnlPctDisplay = fmtPctSigned(analytics.total_unrealized_pnl_pct)

  return (
    <div className="space-y-8">

      {/* ── Section: portfolio header ───────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{analytics.portfolio_id}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Valued as of {analytics.valuation_date}
          </p>
        </div>
      </div>

      {/* ── Section: summary metric cards ──────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Total Market Value"
          value={fmtCurrency(analytics.total_market_value)}
          icon="💰"
        />
        <MetricCard
          label="Unrealised P&L"
          value={pnlDisplay}
          sub={pnlPctDisplay}
          valueClass={pnlClass}
          subClass={pnlClass}
          icon={analytics.total_unrealized_pnl >= 0 ? '📈' : '📉'}
        />
        <MetricCard
          label="Annual Volatility"
          value={
            analytics.annualized_volatility != null
              ? fmtVolatility(analytics.annualized_volatility)
              : '—'
          }
          sub={
            analytics.annualized_volatility != null
              ? 'S&P 500 avg ≈ 15–17%'
              : 'Refresh prices to compute'
          }
          icon="⚡"
        />
        <MetricCard
          label="Positions"
          value={analytics.holdings.length}
          sub={
            analytics.optimisation
              ? `Sharpe ${analytics.optimisation.sharpe_ratio.toFixed(2)} (optimal)`
              : 'Run price refresh for Sharpe'
          }
          icon="🗂"
        />
      </div>

      {/* ── Section: holdings grid ─────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
          Holdings
        </h2>

        {analytics.holdings.length === 0 ? (
          <div className="card p-10 text-center text-gray-500">
            No holdings found in this portfolio.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {analytics.holdings.map((holding) => (
              <HoldingCard
                key={holding.ticker}
                holding={holding}
                portfolioId={portfolioId}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Section: notices / warnings ────────────────────────────────── */}
      {analytics.warnings.length > 0 && (
        <section>
          <div className="card border-amber-700/50 bg-amber-900/10 p-4 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-500 mb-2">
              Notices
            </p>
            {analytics.warnings.map((w, i) => (
              <p key={i} className="text-sm text-amber-300/80 flex items-start gap-2">
                <span className="mt-0.5 shrink-0">›</span>
                {w}
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
