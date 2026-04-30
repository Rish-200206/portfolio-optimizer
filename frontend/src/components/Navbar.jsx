import { useState } from 'react'
import { Link } from 'react-router-dom'
import { refreshPrices } from '../api/client'

/**
 * @param {object}   props
 * @param {string}   props.selectedPortfolio
 * @param {() => void} props.onAddStock
 */
export default function Navbar({ selectedPortfolio, onAddStock, onRefreshComplete }) {
  const [refreshing, setRefreshing]       = useState(false)
  const [refreshResult, setRefreshResult] = useState(null) // 'ok' | 'error'

  const handleRefresh = async () => {
    if (!selectedPortfolio || refreshing) return
    setRefreshing(true)
    setRefreshResult(null)
    try {
      await refreshPrices(selectedPortfolio, false)
      setRefreshResult('ok')
      onRefreshComplete?.()   // tell SummaryPage to reload analytics
    } catch {
      setRefreshResult('error')
    } finally {
      setRefreshing(false)
      setTimeout(() => setRefreshResult(null), 3000)
    }
  }

  return (
    <header className="sticky top-0 z-30 bg-surface-card/80 backdrop-blur-md border-b border-surface-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center
                          group-hover:bg-indigo-500 transition-colors">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <span className="font-semibold text-white hidden sm:block">Portfolio Optimizer</span>
        </Link>

        {/* Right controls */}
        <div className="flex items-center gap-3">

          {/* Add Stock button */}
          <button
            onClick={onAddStock}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border
                       border-indigo-600/50 text-indigo-400 hover:bg-indigo-600/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Add Stock</span>
          </button>

          {/* Refresh Prices button */}
          {selectedPortfolio && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Fetch latest closing prices from yfinance"
              className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border transition-all
                ${refreshResult === 'ok'
                  ? 'border-emerald-600 text-emerald-400 bg-emerald-600/10'
                  : refreshResult === 'error'
                    ? 'border-red-600 text-red-400 bg-red-600/10'
                    : 'border-surface-border text-gray-400 hover:border-indigo-500 hover:text-indigo-400 bg-transparent'
                }
                disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <svg
                className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="hidden sm:inline">
                {refreshing
                  ? 'Refreshing…'
                  : refreshResult === 'ok'
                    ? 'Updated ✓'
                    : refreshResult === 'error'
                      ? 'Failed ✗'
                      : 'Refresh Prices'}
              </span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
