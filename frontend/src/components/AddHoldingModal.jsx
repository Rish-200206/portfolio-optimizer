import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { createHolding, searchTickers } from '../api/client'
import { currencyFromTicker, currencySymbol } from '../utils/currency'

/**
 * Modal form to manually add a stock holding.
 *
 * - Ticker field: live search backed by the local NSE/BSE CSV (falls back to
 *   Yahoo Finance for international tickers). Selecting a result fills in the
 *   full symbol including exchange suffix (e.g. "JSWSTEEL.NS") so currency
 *   detection works correctly.
 * - Price field: shows the correct currency symbol (₹ for NSE/BSE, $ for US, etc.)
 *   derived from the ticker's exchange suffix in real-time.
 * - The dropdown is rendered into document.body via a React portal so it is
 *   never clipped by the modal's rounded corners or any overflow:hidden parent.
 */
export default function AddHoldingModal({ portfolioId, onClose, onSuccess }) {
  // ── Ticker combobox ──────────────────────────────────────────────────────
  const [inputValue, setInputValue]   = useState('')
  const [ticker, setTicker]           = useState('')
  const [results, setResults]         = useState([])
  const [searching, setSearching]     = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dropdownRect, setDropdownRect] = useState(null) // {top,left,width}
  const inputRef    = useRef(null)
  const dropdownRef = useRef(null)

  // ── Other form fields ────────────────────────────────────────────────────
  const [quantity, setQuantity] = useState('')
  const [price, setPrice]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)

  // Derive currency from whatever ticker is set (with suffix → correct symbol)
  const currency = currencyFromTicker(ticker || inputValue)
  const symbol   = currencySymbol(currency)

  // ── Compute dropdown position anchored to the input element ─────────────
  const openDropdown = (items) => {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    setDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    setResults(items)
    setDropdownOpen(true)
  }

  // ── Debounced search ─────────────────────────────────────────────────────
  useEffect(() => {
    const val = inputValue.trim()
    if (val.length < 1) {
      setResults([])
      setDropdownOpen(false)
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await searchTickers(val)
        if (data.length > 0) {
          openDropdown(data)
        } else {
          setDropdownOpen(false)
        }
      } catch {
        setDropdownOpen(false)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [inputValue]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close dropdown on outside click ─────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        inputRef.current   && !inputRef.current.contains(e.target)
      ) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleInput = (e) => {
    const val = e.target.value
    setInputValue(val)
    setTicker(val.trim().toUpperCase())
  }

  const handleSelect = (result) => {
    // Use the full symbol with exchange suffix (e.g. JSWSTEEL.NS, not JSWSTEEL)
    setInputValue(result.symbol)
    setTicker(result.symbol)
    setDropdownOpen(false)
    setResults([])
    setTimeout(() => document.getElementById('ah-qty')?.focus(), 50)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    const sym   = ticker.trim()
    const qty   = parseFloat(quantity)
    const avgPx = parseFloat(price)
    if (!sym)                        { setError('Please select or type a ticker symbol.'); return }
    if (isNaN(qty)   || qty   <= 0) { setError('Quantity must be a positive number.');    return }
    if (isNaN(avgPx) || avgPx <= 0) { setError('Buy price must be a positive number.');   return }
    setSaving(true)
    try {
      await createHolding(portfolioId, { ticker: sym, quantity: qty, average_buy_price: avgPx })
      onSuccess()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Dropdown portal (renders into document.body — never clipped) ─────────
  const dropdown = dropdownOpen && results.length > 0 && dropdownRect
    ? createPortal(
        <ul
          ref={dropdownRef}
          style={{
            position:  'fixed',
            top:       dropdownRect.top,
            left:      dropdownRect.left,
            width:     dropdownRect.width,
            zIndex:    99999,
            maxHeight: '14rem',
            overflowY: 'auto',
          }}
          className="bg-[#1c2128] border border-[#30363d] rounded-lg shadow-2xl"
        >
          {results.map((r) => (
            <li key={r.symbol}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(r) }}
                className="w-full text-left px-3 py-2.5 hover:bg-indigo-600/20
                           flex items-center justify-between gap-3 group
                           border-b border-[#30363d] last:border-0"
              >
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-bold text-white font-mono tracking-wide">
                    {r.symbol}
                  </span>
                  <span className="text-xs text-gray-400 truncate">{r.name}</span>
                </span>
                <span className="text-xs text-gray-600 group-hover:text-gray-400 shrink-0">
                  {r.exchange}
                </span>
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )
    : null

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md mx-4 bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#30363d]">
          <h2 className="text-lg font-semibold text-white">Add Stock</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* ── Ticker combobox ─────────────────────────────────────────── */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">
              Stock / ETF
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                placeholder="Search by name or symbol… e.g. Reliance, JSWSTEEL"
                value={inputValue}
                onChange={handleInput}
                onFocus={() => results.length > 0 && openDropdown(results)}
                autoComplete="off"
                autoFocus
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5
                           text-white placeholder-gray-600 text-sm focus:outline-none
                           focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              {searching && (
                <div className="absolute right-10 top-1/2 -translate-y-1/2">
                  <svg className="w-4 h-4 text-gray-500 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                </div>
              )}
              {/* Currency badge */}
              {ticker && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono
                                 text-indigo-400 bg-indigo-400/10 px-1.5 py-0.5 rounded">
                  {currency}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Type a company name or ticker symbol and pick from the list.
              Indian stocks show as <span className="text-gray-500 font-mono">SYMBOL.NS</span> (NSE) or{' '}
              <span className="text-gray-500 font-mono">SYMBOL.BO</span> (BSE).
            </p>
          </div>

          {/* ── Quantity ─────────────────────────────────────────────────── */}
          <div>
            <label htmlFor="ah-qty" className="block text-sm font-medium text-gray-400 mb-1.5">
              Quantity (shares / units)
            </label>
            <input
              id="ah-qty"
              type="number"
              placeholder="e.g. 10"
              min="0.000001"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5
                         text-white placeholder-gray-600 text-sm focus:outline-none
                         focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* ── Average buy price ─────────────────────────────────────────── */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">
              Average Buy Price
              {currency !== 'USD' && (
                <span className="ml-2 text-xs font-normal text-indigo-400">in {currency}</span>
              )}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm select-none">
                {symbol}
              </span>
              <input
                type="number"
                placeholder="0.00"
                min="0.000001"
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg pl-8 pr-3 py-2.5
                           text-white placeholder-gray-600 text-sm focus:outline-none
                           focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Price you paid per share in {currency}.
              Latest closing price will be fetched automatically after saving.
            </p>
          </div>

          {/* ── Error ────────────────────────────────────────────────────── */}
          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-700/30
                          rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* ── Actions ──────────────────────────────────────────────────── */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-[#30363d] text-gray-400
                         hover:text-white hover:border-gray-500 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500
                         text-white text-sm font-medium transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Add Stock'}
            </button>
          </div>
        </form>
      </div>

      {/* Dropdown portal — outside modal DOM tree, never clipped */}
      {dropdown}
    </div>
  )
}
