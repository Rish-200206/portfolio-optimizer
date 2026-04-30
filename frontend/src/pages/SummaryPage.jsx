import { useEffect, useState, useCallback } from 'react'
import { getAnalytics } from '../api/client'
import MetricCard from '../components/MetricCard'
import HoldingCard from '../components/HoldingCard'
import AiAdvisorPanel from '../components/AiAdvisorPanel'
import Spinner from '../components/Spinner'
import SectorDonut from '../components/SectorDonut'
import CorrelationMatrix from '../components/CorrelationMatrix'
import SmartRebalancer from '../components/SmartRebalancer'
import EquityCurveChart from '../components/EquityCurveChart'
import {
  fmtCurrency,
  fmtPctSigned,
  fmtPnlCurrency,
  fmtVolatility,
  gainLossClass,
} from '../utils/format'
import { currencyFromTicker } from '../utils/currency'

export default function SummaryPage({ portfolioId, refreshKey, onAddStock, onHoldingDeleted }) {
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
  }, [portfolioId, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  if (loading) return <Spinner label="Loading portfolio analytics…" />

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

  const pnlClass = gainLossClass(analytics.total_unrealized_pnl)

  // detect whether all holdings share the same currency so we can pick the right symbol
  const uniqueCurrencies = [...new Set(analytics.holdings.map((h) => currencyFromTicker(h.ticker)))]
  const portfolioCurrency = uniqueCurrencies.length === 1 ? uniqueCurrencies[0] : null
  const mixedCurrencies   = uniqueCurrencies.length > 1

  const pnlDisplay    = fmtPnlCurrency(analytics.total_unrealized_pnl, portfolioCurrency ?? 'USD')
  const pnlPctDisplay = fmtPctSigned(analytics.total_unrealized_pnl_pct)

  return (
    <div className="space-y-8">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">My Portfolio</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Valued as of {analytics.valuation_date}
          </p>
        </div>
        <button
          onClick={onAddStock}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                     text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Stock
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <MetricCard
          label="Total Market Value"
          value={
            mixedCurrencies
              ? '~ Mixed currencies'
              : fmtCurrency(analytics.total_market_value, portfolioCurrency)
          }
          sub={mixedCurrencies ? 'Holdings span multiple currencies' : undefined}
          icon="💰"
        />
        <MetricCard
          label="Unrealised P&L"
          value={mixedCurrencies ? fmtPctSigned(analytics.total_unrealized_pnl_pct) : pnlDisplay}
          sub={mixedCurrencies ? 'Mixed currencies — see individual cards' : pnlPctDisplay}
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
          label="Value at Risk (30d)"
          value={
            analytics.value_at_risk_30d != null
              ? fmtCurrency(analytics.value_at_risk_30d, portfolioCurrency ?? 'USD')
              : '—'
          }
          sub="Max expected loss (95% conf)"
          valueClass="text-rose-400"
          icon="🛡️"
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
                onDeleted={onHoldingDeleted}
              />
            ))}
          </div>
        )}
      </section>

      {analytics.optimisation && (
        <section>
          <SmartRebalancer analytics={analytics} />
        </section>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectorDonut data={analytics.sector_allocation} />
        <CorrelationMatrix data={analytics.correlation_matrix} />
      </section>

      <section>
        <EquityCurveChart data={analytics.historical_performance} />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
          Portfolio AI Analysis
        </h2>
        <AiAdvisorPanel portfolioId={portfolioId} />
      </section>

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
