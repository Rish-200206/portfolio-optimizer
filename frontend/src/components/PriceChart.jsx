import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { fmtCurrency } from '../utils/format'

/**
 * PriceChart.jsx
 * --------------
 * Recharts AreaChart displaying 1-year daily close prices for a single ticker.
 *
 * Design decisions
 * ----------------
 * - Uses AreaChart with a translucent gradient fill to give depth without clutter.
 * - Line / fill colour is indigo (neutral) — the P&L colour is shown in HoldingDetailCard.
 * - Only ~12 X-axis labels are shown (one per month) using a date-filter approach.
 * - A dashed ReferenceLine marks the ticker's average buy price so the user can
 *   immediately see whether they're in-the-money.
 * - Dots are disabled for performance on 250+ data points; the activeDot appears
 *   only on hover.
 *
 * @param {object}   props
 * @param {Array<{ date: string, close: number }>} props.data
 * @param {string}   props.ticker
 * @param {number}   [props.avgBuyPrice]  – shows a reference line when provided
 */
export default function PriceChart({ data, ticker, avgBuyPrice }) {
  if (!data || data.length === 0) {
    return (
      <div className="card p-6 flex flex-col items-center justify-center h-64 gap-3 text-center">
        <svg className="w-8 h-8 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
        </svg>
        <div>
          <p className="text-sm text-gray-500 font-medium">No price data available</p>
          <p className="text-xs text-gray-600 mt-1">
            Click <span className="text-gray-400">Refresh Prices</span> in the navbar
            to fetch 1-year history from yfinance.
          </p>
        </div>
      </div>
    )
  }

  // ── Compute stats ────────────────────────────────────────────────────────
  const closes      = data.map((d) => d.close)
  const minClose    = Math.min(...closes)
  const maxClose    = Math.max(...closes)
  const firstClose  = closes[0]
  const lastClose   = closes[closes.length - 1]
  const ytdChange   = ((lastClose - firstClose) / firstClose) * 100

  // Y-axis padding (5% either side so the line doesn't touch the edges)
  const yPad    = (maxClose - minClose) * 0.08
  const yDomain = [minClose - yPad, maxClose + yPad]

  // ── Reduce X-axis ticks: show only first trading day of each month ───────
  const monthTicks = data
    .filter((d, i) => {
      if (i === 0) return true
      return d.date.slice(8) <= '07' // first 7 days of the month
        && data[i - 1].date.slice(5, 7) !== d.date.slice(5, 7)
    })
    .map((d) => d.date)

  // ── Custom tooltip ───────────────────────────────────────────────────────
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const close = payload[0].value
    const change = ((close - firstClose) / firstClose) * 100
    return (
      <div className="card px-3 py-2 text-xs shadow-xl">
        <p className="text-gray-400 mb-1">{label}</p>
        <p className="text-white font-semibold num">{fmtCurrency(close)}</p>
        <p className={change >= 0 ? 'gain' : 'loss'}>
          {change >= 0 ? '+' : ''}{change.toFixed(2)}% from start
        </p>
      </div>
    )
  }

  // ── Gradient id (unique per ticker to avoid SVG id collision) ────────────
  const gradientId = `grad-${ticker.replace(/\W/g, '')}`

  return (
    <div className="card p-5 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {ticker} — 1-Year Price History
          </h3>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>
            52w Low: <span className="text-gray-300 num">{fmtCurrency(minClose)}</span>
          </span>
          <span>
            52w High: <span className="text-gray-300 num">{fmtCurrency(maxClose)}</span>
          </span>
          <span className={ytdChange >= 0 ? 'gain num' : 'loss num'}>
            YTD {ytdChange >= 0 ? '+' : ''}{ytdChange.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="2 4"
            stroke="#21262d"
            vertical={false}
          />

          <XAxis
            dataKey="date"
            ticks={monthTicks}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => {
              const [, m, ] = v.split('-')
              const months = ['', 'Jan','Feb','Mar','Apr','May','Jun',
                              'Jul','Aug','Sep','Oct','Nov','Dec']
              return months[parseInt(m, 10)]
            }}
          />

          <YAxis
            domain={yDomain}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)}`}
            width={52}
          />

          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#374151', strokeWidth: 1 }} />

          {/* Average buy price reference line */}
          {avgBuyPrice && (
            <ReferenceLine
              y={avgBuyPrice}
              stroke="#f59e0b"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{
                value: `Avg ${fmtCurrency(avgBuyPrice)}`,
                position: 'insideTopRight',
                fill: '#f59e0b',
                fontSize: 10,
              }}
            />
          )}

          <Area
            type="monotone"
            dataKey="close"
            stroke="#6366f1"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, fill: '#6366f1', stroke: '#0d1117', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
