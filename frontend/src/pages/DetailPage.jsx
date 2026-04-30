import { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { getTickerPrices, getAnalytics } from '../api/client'
import PriceChart from '../components/PriceChart'
import HoldingDetailCard from '../components/HoldingDetailCard'
import RebalancingPanel from '../components/RebalancingPanel'
import AiAdvisorPanel from '../components/AiAdvisorPanel'
import Spinner from '../components/Spinner'
import { fmtCurrency, fmtPctSigned, fmtWeight, gainLossClass } from '../utils/format'

/**
 * DetailPage.jsx
 * --------------
 * Master-Detail view for a single holding.
 *
 * Data sources
 * ------------
 * - `GET /portfolios/{pid}/prices/{ticker}` → price history for the chart
 * - `GET /portfolios/{pid}/analytics`       → full analytics (holding metrics,
 *                                             optimisation weights)
 *
 * Both are fetched in parallel via Promise.all.
 *
 * Layout (lg+)
 * ------------
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │  ← Back   TICKER   $price  (+P&L%)   weight   as of date    │  Hero
 *  ├────────────────────────────────────┬─────────────────────────┤
 *  │  PriceChart            (2/3)       │  HoldingDetailCard (1/3)│  Row 1
 *  ├────────────────────────────────────┼─────────────────────────┤
 *  │  RebalancingPanel      (1/2)       │  AiAdvisorPanel   (1/2) │  Row 2
 *  └────────────────────────────────────┴─────────────────────────┘
 *
 * @param {object}      props
 * @param {string|null} props.portfolioId  – from App state; fallback to ?pid= param
 */
export default function DetailPage({ portfolioId: portfolioIdProp }) {
  const { ticker }           = useParams()
  const [searchParams]       = useSearchParams()

  // Resolve portfolio ID: URL query param takes precedence (supports direct links)
  const portfolioId = searchParams.get('pid') || portfolioIdProp

  const [prices, setPrices]       = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  useEffect(() => {
    if (!portfolioId || !ticker) return

    setLoading(true)
    setError(null)

    Promise.all([
      getTickerPrices(portfolioId, ticker).catch(() => []),   // empty array on miss
      getAnalytics(portfolioId),
    ])
      .then(([priceData, analyticsData]) => {
        setPrices(priceData ?? [])
        setAnalytics(analyticsData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [portfolioId, ticker])

  // ── Missing portfolio ID (e.g. direct URL load without app state) ──────
  if (!portfolioId) {
    return (
      <div className="card p-8 text-center max-w-md mx-auto mt-16 space-y-3">
        <p className="text-gray-300">Portfolio context lost.</p>
        <Link to="/" className="text-indigo-400 text-sm hover:text-indigo-300">
          ← Return to Summary
        </Link>
      </div>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) return <Spinner label={`Loading ${ticker} details…`} />

  // ── Error ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="card p-8 text-center max-w-lg mx-auto mt-16 space-y-3">
        <p className="text-red-400 font-semibold">Failed to load detail data</p>
        <p className="text-sm text-gray-500">{error}</p>
        <Link to="/" className="text-indigo-400 text-sm hover:text-indigo-300">
          ← Return to Summary
        </Link>
      </div>
    )
  }

  // ── Resolve this ticker's metrics from the analytics payload ───────────
  const holding = analytics?.holdings.find((h) => h.ticker === ticker)

  if (!holding) {
    return (
      <div className="card p-8 text-center max-w-lg mx-auto mt-16 space-y-3">
        <p className="text-gray-300">
          <strong>{ticker}</strong> was not found in portfolio{' '}
          <strong>{portfolioId}</strong>.
        </p>
        <p className="text-sm text-gray-500">
          It may have been removed, or the analytics may be stale.
        </p>
        <Link to="/" className="text-indigo-400 text-sm hover:text-indigo-300">
          ← Return to Summary
        </Link>
      </div>
    )
  }

  const pnlClass   = gainLossClass(holding.unrealized_pnl)
  const pnlPct     = fmtPctSigned(holding.unrealized_pnl_pct)
  const valuationDate = analytics?.valuation_date ?? '—'

  return (
    <div className="space-y-6">

      {/* ── Hero header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">

        {/* Back link */}
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-indigo-400
                     transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Summary
        </Link>

        {/* Ticker identity + quick stats */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-3xl font-bold text-white tracking-tight">{ticker}</h1>

          <span className="text-xl font-semibold num text-gray-200">
            {fmtCurrency(holding.latest_price)}
          </span>

          <span className={`text-base num font-medium ${pnlClass}`}>{pnlPct}</span>

          <span className="text-sm text-gray-600">
            {fmtWeight(holding.current_weight)} of portfolio
          </span>

          <span className="text-xs text-gray-700">
            as of {valuationDate}
          </span>
        </div>
      </div>

      {/* ── Row 1: Price chart (2/3) + Holding detail card (1/3) ────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PriceChart
            data={prices}
            ticker={ticker}
            avgBuyPrice={holding.average_buy_price}
          />
        </div>
        <div>
          <HoldingDetailCard holding={holding} />
        </div>
      </div>

      {/* ── Row 2: Rebalancing (1/2) + AI Advisor (1/2) ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RebalancingPanel
          optimisation={analytics?.optimisation ?? null}
          activeTicker={ticker}
        />
        <AiAdvisorPanel portfolioId={portfolioId} />
      </div>
    </div>
  )
}
