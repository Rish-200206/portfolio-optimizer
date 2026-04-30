import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { refreshPrices } from '../api/client'

/**
 * Navbar.jsx
 * ----------
 * Top navigation bar.
 * - Left:  app logo / title (links to home)
 * - Right: portfolio selector + "Refresh Prices" action button
 *
 * @param {object}   props
 * @param {string[]} props.portfolios          – list of portfolio IDs from the API
 * @param {string|null} props.selectedPortfolio
 * @param {(id: string) => void} props.onSelectPortfolio
 */
export default function Navbar({ portfolios, selectedPortfolio, onSelectPortfolio }) {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState(null) // 'ok' | 'error'
  const navigate = useNavigate()

  const handleSelectChange = (e) => {
    onSelectPortfolio(e.target.value)
    navigate('/')
  }

  const handleRefresh = async () => {
    if (!selectedPortfolio || refreshing) return
    setRefreshing(true)
    setRefreshResult(null)
    try {
      await refreshPrices(selectedPortfolio, false)
      setRefreshResult('ok')
    } catch {
      setRefreshResult('error')
    } finally {
      setRefreshing(false)
      // Auto-clear the status badge after 3 s
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

          {/* Portfolio selector */}
          {portfolios.length > 0 && (
            <div className="relative">
              <select
                value={selectedPortfolio ?? ''}
                onChange={handleSelectChange}
                className="appearance-none bg-surface-border border border-surface-border text-gray-200
                           text-sm rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-2
                           focus:ring-indigo-500 cursor-pointer hover:border-gray-600 transition-colors"
              >
                {portfolios.map((pid) => (
                  <option key={pid} value={pid}>{pid}</option>
                ))}
              </select>
              {/* Dropdown chevron */}
              <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none"
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          )}

          {/* Refresh Prices button */}
          {selectedPortfolio && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Fetch latest prices from yfinance and update the database"
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
