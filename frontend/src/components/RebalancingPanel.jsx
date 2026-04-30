import { fmtWeight } from '../utils/format'

/**
 * RebalancingPanel.jsx
 * --------------------
 * Displays the PyPortfolioOpt max-Sharpe rebalancing recommendations.
 *
 * Layout
 * ------
 * 1. Three portfolio-level stats: expected return, expected vol, Sharpe ratio.
 * 2. Hero recommendation for the current ticker (prominent BUY / TRIM / HOLD badge).
 * 3. Full weight-change table for all tickers, each with a dual-bar weight visualiser.
 *
 * @param {object}  props
 * @param {import('../api/types').OptimisationResult | null} props.optimisation
 * @param {string}  props.activeTicker   – highlighted row in the table
 */
export default function RebalancingPanel({ optimisation, activeTicker }) {
  // ── No data state ──────────────────────────────────────────────────────
  if (!optimisation) {
    return (
      <div className="card p-5 h-full flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Portfolio Optimisation
        </h3>
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-6">
          <svg className="w-8 h-8 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-sm text-gray-500">Optimisation data unavailable</p>
          <p className="text-xs text-gray-600 max-w-xs">
            Requires ≥ 2 holdings with at least 60 days of stored price history.
            Refresh prices and try again.
          </p>
        </div>
      </div>
    )
  }

  // ── Active ticker's recommendation ─────────────────────────────────────
  const activeRec = optimisation.weights.find((r) => r.ticker === activeTicker)
  const action = activeRec
    ? activeRec.weight_delta > 0.005
      ? 'BUY MORE'
      : activeRec.weight_delta < -0.005
        ? 'TRIM'
        : 'HOLD'
    : null

  const actionStyle = {
    'BUY MORE': 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400',
    'TRIM':     'bg-red-500/15 border-red-500/40 text-red-400',
    'HOLD':     'bg-gray-500/15 border-gray-500/40 text-gray-400',
  }

  return (
    <div className="card p-5 flex flex-col gap-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Portfolio Optimisation
        <span className="ml-2 text-gray-600 normal-case font-normal">
          (Max Sharpe · risk-free 5%)
        </span>
      </h3>

      {/* ── Portfolio performance stats ────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Expected Return"
          value={`${(optimisation.expected_annual_return * 100).toFixed(1)}%`}
          valueClass="text-emerald-400"
        />
        <Stat
          label="Expected Vol"
          value={`${(optimisation.expected_annual_volatility * 100).toFixed(1)}%`}
        />
        <Stat
          label="Sharpe Ratio"
          value={optimisation.sharpe_ratio.toFixed(2)}
          valueClass="text-indigo-400"
        />
      </div>

      {/* ── Hero action badge for the active ticker ───────────────────── */}
      {activeRec && (
        <div className={`flex items-center justify-between rounded-lg border px-4 py-3 ${actionStyle[action]}`}>
          <div>
            <p className="text-xs opacity-70 mb-0.5">{activeTicker} recommendation</p>
            <p className="text-xl font-bold tracking-tight">{action}</p>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-70 mb-0.5">Weight delta</p>
            <p className="text-base font-semibold num">
              {activeRec.weight_delta >= 0 ? '+' : ''}
              {(activeRec.weight_delta * 100).toFixed(1)} pp
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-70 mb-0.5">Target weight</p>
            <p className="text-base font-semibold num">{fmtWeight(activeRec.optimal_weight)}</p>
          </div>
        </div>
      )}

      {/* ── Full weight-change table ───────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-xs text-gray-600">All positions</p>
        {optimisation.weights.map((rec) => {
          const recAction = rec.weight_delta > 0.005
            ? 'BUY MORE'
            : rec.weight_delta < -0.005
              ? 'TRIM'
              : 'HOLD'

          const badgeStyle = {
            'BUY MORE': 'bg-emerald-500/10 text-emerald-400',
            'TRIM':     'bg-red-500/10 text-red-400',
            'HOLD':     'bg-gray-700/50 text-gray-500',
          }[recAction]

          const isActive = rec.ticker === activeTicker

          return (
            <div
              key={rec.ticker}
              className={`rounded-lg px-3 py-2.5 transition-colors ${
                isActive ? 'bg-indigo-500/10 border border-indigo-500/20' : 'bg-surface-border/30'
              }`}
            >
              {/* Row header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${isActive ? 'text-indigo-300' : 'text-gray-200'}`}>
                    {rec.ticker}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badgeStyle}`}>
                    {recAction}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs num">
                  <span className="text-gray-500">{fmtWeight(rec.current_weight)}</span>
                  <span className="text-gray-700">→</span>
                  <span className="text-gray-300">{fmtWeight(rec.optimal_weight)}</span>
                  <span className={rec.weight_delta >= 0 ? 'gain' : 'loss'}>
                    {rec.weight_delta >= 0 ? '+' : ''}
                    {(rec.weight_delta * 100).toFixed(1)}pp
                  </span>
                </div>
              </div>

              {/* Dual-bar visualiser: current (solid) vs optimal (outline) */}
              <div className="relative h-1.5 bg-surface-border rounded-full overflow-visible">
                {/* Current weight bar */}
                <div
                  className="absolute left-0 top-0 h-full bg-indigo-500/50 rounded-full"
                  style={{ width: `${Math.min(rec.current_weight * 100, 100)}%` }}
                />
                {/* Optimal weight marker line */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-amber-400 rounded-full"
                  style={{ left: `${Math.min(rec.optimal_weight * 100, 100)}%` }}
                  title={`Optimal: ${fmtWeight(rec.optimal_weight)}`}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-600 pt-1">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-1.5 bg-indigo-500/50 rounded-full inline-block" />
          Current weight
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-0.5 h-3 bg-amber-400 rounded-full inline-block" />
          Optimal weight
        </span>
      </div>
    </div>
  )
}

// ── Internal helper ────────────────────────────────────────────────────────

function Stat({ label, value, valueClass = 'text-gray-100' }) {
  return (
    <div className="bg-surface-border/40 rounded-lg px-3 py-2.5 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-base font-bold num ${valueClass}`}>{value}</p>
    </div>
  )
}
