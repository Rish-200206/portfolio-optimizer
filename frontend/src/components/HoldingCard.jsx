import { Link } from 'react-router-dom'
import { fmtCurrency, fmtPctSigned, fmtWeight, gainLossClass } from '../utils/format'

/**
 * HoldingCard.jsx
 * ---------------
 * Clickable tile representing one portfolio position.
 * Navigates to the detail view on click.
 *
 * @param {object} props
 * @param {import('../api/types').HoldingMetrics} props.holding
 * @param {string} props.portfolioId
 */
export default function HoldingCard({ holding, portfolioId }) {
  const pnlClass = gainLossClass(holding.unrealized_pnl)
  const pnlPctClass = gainLossClass(holding.unrealized_pnl_pct)

  return (
    <Link
      to={`/holdings/${holding.ticker}?pid=${portfolioId}`}
      className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
    >
      <div className="card p-5 h-full flex flex-col gap-3 transition-all duration-150
                      group-hover:border-indigo-500/60 group-hover:bg-surface-hover
                      group-hover:shadow-lg group-hover:shadow-indigo-500/5">

        {/* Header row: ticker + portfolio weight */}
        <div className="flex items-start justify-between">
          <span className="text-lg font-bold tracking-tight text-white">
            {holding.ticker}
          </span>
          <span className="text-xs font-mono text-gray-500 bg-surface-border px-2 py-0.5 rounded-full">
            {fmtWeight(holding.current_weight)}
          </span>
        </div>

        {/* Market value */}
        <p className="text-xl font-semibold num text-gray-100">
          {fmtCurrency(holding.market_value)}
        </p>

        {/* P&L row */}
        <div className="flex items-center gap-2 mt-auto">
          <span className={`text-sm font-medium num ${pnlClass}`}>
            {fmtPctSigned(holding.unrealized_pnl_pct)}
          </span>
          <span className="text-gray-700">·</span>
          <span className={`text-xs num ${pnlClass}`}>
            {holding.unrealized_pnl >= 0 ? '+' : ''}{fmtCurrency(holding.unrealized_pnl)}
          </span>
        </div>

        {/* Qty + avg price sub-row */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{holding.quantity} units</span>
          <span className="text-gray-700">·</span>
          <span>avg {fmtCurrency(holding.average_buy_price)}</span>
        </div>

        {/* Warning badge for estimated prices */}
        {holding.price_is_estimated && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-amber-500/80">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            No live price — using cost basis
          </div>
        )}

        {/* Hover chevron */}
        <div className="absolute top-4 right-4 text-gray-700 opacity-0 group-hover:opacity-100 group-hover:text-indigo-400 transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  )
}
