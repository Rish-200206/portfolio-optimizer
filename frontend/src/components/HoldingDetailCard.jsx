import { fmtCurrency, fmtPctSigned, fmtPnlCurrency, fmtWeight, gainLossClass } from '../utils/format'
import { currencyFromTicker } from '../utils/currency'

/**
 * @param {object} props
 * @param {import('../api/types').HoldingMetrics} props.holding
 */
export default function HoldingDetailCard({ holding }) {
  const pnlClass = gainLossClass(holding.unrealized_pnl)
  const currency = currencyFromTicker(holding.ticker)

  return (
    <div className="card p-5 space-y-5 h-full">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Position Details
      </h3>

      {/* Prominent P&L display */}
      <div>
        <p className="text-xs text-gray-500 mb-1">Unrealised P&amp;L</p>
        <p className={`text-3xl font-bold num ${pnlClass}`}>
          {fmtPnlCurrency(holding.unrealized_pnl, currency)}
        </p>
        <p className={`text-sm num mt-0.5 ${pnlClass}`}>
          {fmtPctSigned(holding.unrealized_pnl_pct)}
        </p>
      </div>

      <hr className="border-surface-border" />

      {/* Metrics grid */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Metric label="Market Value"   value={fmtCurrency(holding.market_value, currency)} />
        <Metric label="Cost Basis"     value={fmtCurrency(holding.cost_basis, currency)} />
        <Metric label="Latest Price"   value={fmtCurrency(holding.latest_price, currency)}
          sub={holding.price_is_estimated ? '⚠ estimated' : undefined}
          subClass="text-amber-500/80"
        />
        <Metric label="Avg Buy Price"  value={fmtCurrency(holding.average_buy_price, currency)} />
        <Metric label="Quantity"       value={`${holding.quantity} units`} />
        <Metric label="Portfolio Wt."  value={fmtWeight(holding.current_weight)} />
      </dl>

      {holding.fundamentals && (
        <>
          <hr className="border-surface-border" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 pt-1">
            Fundamentals & Profile
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Metric label="Sector" value={holding.fundamentals.sector || 'N/A'} />
            <Metric label="Industry" value={holding.fundamentals.industry || 'N/A'} />
            <Metric label="P/E (Trailing)" value={holding.fundamentals.trailing_pe ? holding.fundamentals.trailing_pe.toFixed(2) : 'N/A'} />
            <Metric label="P/E (Forward)" value={holding.fundamentals.forward_pe ? holding.fundamentals.forward_pe.toFixed(2) : 'N/A'} />
            <Metric label="Dividend Yield" value={holding.fundamentals.dividend_yield ? `${(holding.fundamentals.dividend_yield * 100).toFixed(2)}%` : 'N/A'} />
            <Metric label="Market Cap" value={holding.fundamentals.market_cap ? `$${(holding.fundamentals.market_cap / 1e9).toFixed(2)}B` : 'N/A'} />
          </dl>
        </>
      )}

      {holding.price_is_estimated && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <p className="text-xs text-amber-300/80">
            No market price stored. Values above use cost basis.
            Use the <strong>Refresh Prices</strong> button to load live data.
          </p>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, sub, subClass = 'text-gray-600' }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 mb-0.5">{label}</dt>
      <dd className="text-sm font-semibold text-gray-100 num">{value}</dd>
      {sub && <dd className={`text-xs ${subClass}`}>{sub}</dd>}
    </div>
  )
}
