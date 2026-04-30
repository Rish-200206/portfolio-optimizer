import { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom'
import { getTickerPrices, getAnalytics, deleteHolding } from '../api/client'
import PriceChart from '../components/PriceChart'
import HoldingDetailCard from '../components/HoldingDetailCard'
import RebalancingPanel from '../components/RebalancingPanel'
import AiAdvisorPanel from '../components/AiAdvisorPanel'
import Spinner from '../components/Spinner'
import { fmtCurrency, fmtPctSigned, fmtWeight, gainLossClass } from '../utils/format'
import { currencyFromTicker } from '../utils/currency'

export default function DetailPage({ portfolioId: portfolioIdProp }) {
  const { ticker }       = useParams()
  const [searchParams]   = useSearchParams()
  const navigate         = useNavigate()
  const portfolioId      = searchParams.get('pid') || portfolioIdProp

  const [prices, setPrices]       = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [deleting, setDeleting]   = useState(false)

  useEffect(() => {
    if (!portfolioId || !ticker) return
    setLoading(true)
    setError(null)
    Promise.all([
      getTickerPrices(portfolioId, ticker).catch(() => []),
      getAnalytics(portfolioId),
    ])
      .then(([priceData, analyticsData]) => {
        setPrices(priceData ?? [])
        setAnalytics(analyticsData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [portfolioId, ticker])

  const handleDelete = async () => {
    if (!window.confirm(`Remove ${ticker} from your portfolio?`)) return
    setDeleting(true)
    try {
      await deleteHolding(portfolioId, ticker)
      navigate('/')
    } catch {
      setDeleting(false)
    }
  }

  if (!portfolioId) {
    return (
      <div className="card p-8 text-center max-w-md mx-auto mt-16 space-y-3">
        <p className="text-gray-300">Portfolio context lost.</p>
        <Link to="/" className="text-indigo-400 text-sm hover:text-indigo-300">← Return to Summary</Link>
      </div>
    )
  }

  if (loading) return <Spinner label={`Loading ${ticker} details…`} />

  if (error) {
    return (
      <div className="card p-8 text-center max-w-lg mx-auto mt-16 space-y-3">
        <p className="text-red-400 font-semibold">Failed to load detail data</p>
        <p className="text-sm text-gray-500">{error}</p>
        <Link to="/" className="text-indigo-400 text-sm hover:text-indigo-300">← Return to Summary</Link>
      </div>
    )
  }

  const holding = analytics?.holdings.find((h) => h.ticker === ticker)

  if (!holding) {
    return (
      <div className="card p-8 text-center max-w-lg mx-auto mt-16 space-y-3">
        <p className="text-gray-300"><strong>{ticker}</strong> was not found in this portfolio.</p>
        <Link to="/" className="text-indigo-400 text-sm hover:text-indigo-300">← Return to Summary</Link>
      </div>
    )
  }

  const currency      = currencyFromTicker(ticker)
  const pnlClass      = gainLossClass(holding.unrealized_pnl)
  const pnlPct        = fmtPctSigned(holding.unrealized_pnl_pct)
  const valuationDate = analytics?.valuation_date ?? '—'

  return (
    <div className="space-y-6">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">

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
              {fmtCurrency(holding.latest_price, currency)}
            </span>
            <span className={`text-base num font-medium ${pnlClass}`}>{pnlPct}</span>
            <span className="text-sm text-gray-600">
              {fmtWeight(holding.current_weight)} of portfolio
            </span>
            <span className="text-xs text-gray-700">as of {valuationDate}</span>
          </div>
        </div>

        {/* Remove button */}
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-700/40
                     text-red-400 hover:bg-red-400/10 text-sm transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {deleting
            ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
          }
          {deleting ? 'Removing…' : 'Remove holding'}
        </button>
      </div>

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
