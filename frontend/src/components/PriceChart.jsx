import { useState, useMemo } from 'react'
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
import { currencyFromTicker, currencySymbol } from '../utils/currency'

const TIME_RANGES = [
  { label: '1M',  days: 30 },
  { label: '3M',  days: 90 },
  { label: '6M',  days: 180 },
  { label: '1Y',  days: 365 },
  { label: '5Y',  days: 1825 },
  { label: 'All', days: Infinity },
]

export default function PriceChart({ data, ticker, avgBuyPrice }) {
  const [selectedRange, setSelectedRange] = useState('1Y')

  // Filter data based on selected time range
  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return []
    const range = TIME_RANGES.find((r) => r.label === selectedRange)
    if (!range || range.days === Infinity) return data

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - range.days)
    const cutoffStr = cutoffDate.toISOString().slice(0, 10)

    return data.filter((d) => d.date >= cutoffStr)
  }, [data, selectedRange])

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
            to fetch price history from yfinance.
          </p>
        </div>
      </div>
    )
  }

  const chartData = filteredData.length > 0 ? filteredData : data
  const currency  = currencyFromTicker(ticker)
  const symb      = currencySymbol(currency)

  const closes      = chartData.map((d) => d.close)
  const minClose    = Math.min(...closes)
  const maxClose    = Math.max(...closes)
  const firstClose  = closes[0]
  const lastClose   = closes[closes.length - 1]
  const periodChange = ((lastClose - firstClose) / firstClose) * 100

  // Y-axis padding (5% either side so the line doesn't touch the edges)
  const yPad    = (maxClose - minClose) * 0.08 || 1
  const yDomain = [minClose - yPad, maxClose + yPad]

  const monthTicks = useMemo(() => {
    if (chartData.length === 0) return []

    // For ranges > 2 years, show yearly + mid-year ticks
    const dataSpanDays = (new Date(chartData[chartData.length - 1].date) - new Date(chartData[0].date)) / (1000 * 86400)

    if (dataSpanDays > 730) {
      // Multi-year: show ~Jan of each year
      return chartData
        .filter((d, i) => {
          if (i === 0) return true
          return d.date.slice(5, 7) === '01' && d.date.slice(8) <= '07'
            && chartData[i - 1].date.slice(5, 7) !== '01'
        })
        .map((d) => d.date)
    }

    // Under 2 years: show first trading day of each month
    return chartData
      .filter((d, i) => {
        if (i === 0) return true
        return d.date.slice(8) <= '07'
          && chartData[i - 1].date.slice(5, 7) !== d.date.slice(5, 7)
      })
      .map((d) => d.date)
  }, [chartData])

  const dataSpanDays = chartData.length > 1
    ? (new Date(chartData[chartData.length - 1].date) - new Date(chartData[0].date)) / (1000 * 86400)
    : 0

  const formatTick = (v) => {
    const [y, m] = v.split('-')
    const months = ['', 'Jan','Feb','Mar','Apr','May','Jun',
                    'Jul','Aug','Sep','Oct','Nov','Dec']
    if (dataSpanDays > 730) {
      // Multi-year: show "Jan '23"
      return m === '01' ? `'${y.slice(2)}` : months[parseInt(m, 10)]
    }
    return months[parseInt(m, 10)]
  }

  const rangeLabel = selectedRange === 'All'
    ? `${chartData[0]?.date?.slice(0, 4)} – ${chartData[chartData.length - 1]?.date?.slice(0, 4)}`
    : selectedRange

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const close = payload[0].value
    const change = ((close - firstClose) / firstClose) * 100
    return (
      <div className="card px-3 py-2 text-xs shadow-xl">
        <p className="text-gray-400 mb-1">{label}</p>
        <p className="text-white font-semibold num">{fmtCurrency(close, currency)}</p>
        <p className={change >= 0 ? 'gain' : 'loss'}>
          {change >= 0 ? '+' : ''}{change.toFixed(2)}% from start
        </p>
      </div>
    )
  }

  // unique gradient id per ticker to avoid SVG defs collision when multiple charts render
  const gradientId = `grad-${ticker.replace(/\W/g, '')}`

  return (
    <div className="card p-5 space-y-3">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {ticker} — Price History
          </h3>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>
            Low: <span className="text-gray-300 num">{fmtCurrency(minClose, currency)}</span>
          </span>
          <span>
            High: <span className="text-gray-300 num">{fmtCurrency(maxClose, currency)}</span>
          </span>
          <span className={periodChange >= 0 ? 'gain num' : 'loss num'}>
            {rangeLabel} {periodChange >= 0 ? '+' : ''}{periodChange.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Time range filter buttons */}
      <div className="flex gap-1">
        {TIME_RANGES.map((range) => {
          // Hide 5Y/All if we don't have enough data
          const totalDays = data.length > 1
            ? (new Date(data[data.length - 1].date) - new Date(data[0].date)) / (1000 * 86400)
            : 0
          if (range.days > totalDays * 1.1 && range.days !== Infinity && totalDays < range.days * 0.8) {
            return null
          }

          const isActive = selectedRange === range.label
          return (
            <button
              key={range.label}
              onClick={() => setSelectedRange(range.label)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all
                ${isActive
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
            >
              {range.label}
            </button>
          )
        })}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
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
            tickFormatter={formatTick}
          />

          <YAxis
            domain={yDomain}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${symb}${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)}`}
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
