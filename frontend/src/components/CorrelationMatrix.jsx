import React from 'react'

/**
 * CorrelationMatrix.jsx
 * ---------------------
 * Displays the top highly correlated stock pairs. High correlation reduces
 * diversification benefits.
 *
 * @param {object} props
 * @param {Array<{ ticker_1: string, ticker_2: string, correlation: number }>} props.data
 */
export default function CorrelationMatrix({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="card p-6 flex flex-col items-center justify-center h-full text-center min-h-[250px]">
        <svg className="w-8 h-8 text-gray-700 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-gray-500">Not enough data to compute correlations.</p>
      </div>
    )
  }

  // Filter for meaningful correlations (|corr| > 0.5) and take top 5
  const topCorrelations = data
    .filter(pair => Math.abs(pair.correlation) >= 0.4)
    .slice(0, 6)

  return (
    <div className="card p-5 space-y-4 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Highest Correlations
        </h3>
        <span className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
          Risk Warning
        </span>
      </div>
      
      <p className="text-xs text-gray-400 leading-relaxed">
        Assets moving closely together (correlation near 1.0) reduce your diversification benefit. 
        A shock to one may negatively impact both.
      </p>

      {topCorrelations.length === 0 ? (
        <div className="py-8 text-center text-sm text-emerald-500/80">
          Your portfolio appears well-diversified. No highly correlated pairs found.
        </div>
      ) : (
        <div className="space-y-2.5 mt-2">
          {topCorrelations.map((pair, idx) => {
            const corr = pair.correlation
            // Color code based on strength
            let colorClass = "text-gray-400"
            if (corr > 0.8) colorClass = "text-rose-400"
            else if (corr > 0.6) colorClass = "text-amber-400"
            
            return (
              <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-[#21262d]/50 border border-surface-border">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-white">{pair.ticker_1}</span>
                  <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <span className="text-sm font-semibold text-white">{pair.ticker_2}</span>
                </div>
                <div className={`text-sm font-bold num ${colorClass}`}>
                  {corr.toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
