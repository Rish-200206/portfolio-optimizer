import { useState, useMemo } from 'react'
import { fmtCurrency } from '../utils/format'
import { currencyFromTicker, currencySymbol } from '../utils/currency'

const CURRENCY_OPTIONS = [
  { code: 'INR', label: '₹ INR' },
  { code: 'USD', label: '$ USD' },
  { code: 'GBP', label: '£ GBP' },
  { code: 'EUR', label: '€ EUR' },
  { code: 'JPY', label: '¥ JPY' },
  { code: 'CAD', label: 'C$ CAD' },
  { code: 'AUD', label: 'A$ AUD' },
]

export default function SmartRebalancer({ analytics }) {
  const [cashInjection, setCashInjection] = useState(5000)

  // Auto-detect portfolio currency from holdings
  const detectedCurrency = useMemo(() => {
    if (!analytics?.holdings?.length) return 'USD'
    const currencies = [...new Set(analytics.holdings.map(h => currencyFromTicker(h.ticker)))]
    return currencies.length === 1 ? currencies[0] : 'USD'
  }, [analytics])

  const [selectedCurrency, setSelectedCurrency] = useState(null)
  const activeCurrency = selectedCurrency ?? detectedCurrency
  const activeSymbol = currencySymbol(activeCurrency)

  // Only calculate if we have optimisation data
  const optimisation = analytics?.optimisation
  const hasOptimisation = !!optimisation

  const rebalancePlan = useMemo(() => {
    if (!hasOptimisation) return []

    const currentTotalValue = analytics.total_market_value
    const targetTotalValue = currentTotalValue + Number(cashInjection || 0)

    // Build map of current data
    const holdingsMap = {}
    analytics.holdings.forEach(h => {
      holdingsMap[h.ticker] = h
    })

    const plan = []

    optimisation.weights.forEach(rec => {
      const ticker = rec.ticker
      const optimalWeight = rec.optimal_weight
      const holding = holdingsMap[ticker]
      
      // If we don't hold it, we can't easily buy it here without a price, 
      // but in this app all optimized assets are currently held.
      if (!holding) return

      const targetValue = targetTotalValue * optimalWeight
      const currentValue = holding.market_value
      const valueDelta = targetValue - currentValue
      
      // Calculate exact shares, then round to nearest integer for standard brokers
      const exactSharesDelta = valueDelta / holding.latest_price
      const sharesDelta = Math.round(exactSharesDelta)
      const actualValueDelta = sharesDelta * holding.latest_price
      
      plan.push({
        ticker,
        currentShares: holding.quantity,
        targetShares: holding.quantity + sharesDelta,
        sharesDelta,
        valueDelta: actualValueDelta,
        latestPrice: holding.latest_price,
        action: sharesDelta > 0 ? 'BUY' : sharesDelta < 0 ? 'SELL' : 'HOLD',
        currency: currencyFromTicker(ticker)
      })
    })

    // Sort by largest buy first
    return plan.sort((a, b) => b.valueDelta - a.valueDelta)

  }, [analytics, cashInjection, hasOptimisation])

  if (!hasOptimisation) return null

  return (
    <div className="card p-6 border border-indigo-500/30 bg-gradient-to-br from-indigo-900/10 to-transparent">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-indigo-400">
            Smart Rebalancer
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Calculate exact trades needed to reach your optimal Sharpe Ratio weights.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Cash Injection:</label>
          <select
            value={activeCurrency}
            onChange={(e) => setSelectedCurrency(e.target.value)}
            className="bg-surface-card border border-surface-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            {CURRENCY_OPTIONS.map(c => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300 font-semibold text-sm">{activeSymbol}</span>
            <input 
              type="number" 
              value={cashInjection}
              onChange={(e) => setCashInjection(Number(e.target.value))}
              className="bg-surface-card border border-indigo-500/40 rounded-lg pl-9 pr-3 py-1.5 text-sm font-semibold w-40 text-white focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/30"
              step="1000"
              min="0"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto mt-4">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-surface-border text-xs text-gray-500 uppercase tracking-wider">
              <th className="pb-2 font-medium">Asset</th>
              <th className="pb-2 font-medium text-right">Current</th>
              <th className="pb-2 font-medium text-right">Action</th>
              <th className="pb-2 font-medium text-right">Est. Cost</th>
              <th className="pb-2 font-medium text-right">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border/50">
            {rebalancePlan.map((p) => {
              const isBuy = p.action === 'BUY'
              const isSell = p.action === 'SELL'
              const actionColor = isBuy ? 'text-emerald-400' : isSell ? 'text-rose-400' : 'text-gray-500'
              
              return (
                <tr key={p.ticker} className="text-sm">
                  <td className="py-3 font-semibold text-white">{p.ticker}</td>
                  <td className="py-3 text-right num text-gray-400">
                    {p.currentShares}
                  </td>
                  <td className={`py-3 text-right font-bold ${actionColor}`}>
                    {isBuy ? '+' : ''}{p.sharesDelta}
                  </td>
                  <td className={`py-3 text-right num ${actionColor}`}>
                    {fmtCurrency(Math.abs(p.valueDelta), p.currency)}
                  </td>
                  <td className="py-3 text-right num text-gray-300">
                    {p.targetShares}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
