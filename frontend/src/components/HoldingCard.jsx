import { useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteHolding, updateHolding } from '../api/client'
import { fmtCurrency, fmtPctSigned, fmtWeight, gainLossClass } from '../utils/format'
import { currencyFromTicker } from '../utils/currency'

export default function HoldingCard({ holding, portfolioId, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editQty, setEditQty] = useState(holding.quantity)
  const [editAvgPrice, setEditAvgPrice] = useState(holding.average_buy_price)
  const pnlClass = gainLossClass(holding.unrealized_pnl)
  const currency = currencyFromTicker(holding.ticker)

  const handleDelete = async (e) => {
    e.preventDefault()   // prevent Link navigation
    e.stopPropagation()
    if (deleting) return
    if (!window.confirm(`Remove ${holding.ticker} from your portfolio?`)) return
    setDeleting(true)
    try {
      await deleteHolding(portfolioId, holding.ticker)
      onDeleted?.()
    } catch {
      setDeleting(false)
    }
  }

  const handleEditClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setEditQty(holding.quantity)
    setEditAvgPrice(holding.average_buy_price)
    setEditing(true)
  }

  const handleEditCancel = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setEditing(false)
  }

  const handleEditSave = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (saving) return
    setSaving(true)
    try {
      await updateHolding(portfolioId, holding.ticker, {
        quantity: Number(editQty),
        average_buy_price: Number(editAvgPrice),
      })
      setEditing(false)
      onDeleted?.()  // triggers a full refresh of analytics
    } catch (err) {
      alert(`Failed to update: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div
        className="card p-5 h-full flex flex-col gap-3 border-indigo-500/60 bg-surface-hover
                    shadow-lg shadow-indigo-500/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight text-white">
            {holding.ticker}
          </span>
          <span className="text-xs font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">
            Editing
          </span>
        </div>

        <div className="space-y-3 mt-1">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Quantity</label>
            <input
              type="number"
              value={editQty}
              onChange={(e) => setEditQty(e.target.value)}
              min="0"
              step="1"
              className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2
                         text-sm font-semibold text-white focus:outline-none focus:border-indigo-500
                         focus:ring-1 focus:ring-indigo-500/30"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Avg Buy Price</label>
            <input
              type="number"
              value={editAvgPrice}
              onChange={(e) => setEditAvgPrice(e.target.value)}
              min="0"
              step="0.01"
              className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2
                         text-sm font-semibold text-white focus:outline-none focus:border-indigo-500
                         focus:ring-1 focus:ring-indigo-500/30"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-auto pt-1">
          <button
            onClick={handleEditSave}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500
                       text-white text-xs font-semibold transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={handleEditCancel}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg bg-surface-card border border-surface-border
                       text-gray-300 text-xs font-semibold hover:bg-surface-hover transition-colors
                       disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <Link
      to={`/holdings/${holding.ticker}?pid=${portfolioId}`}
      className="block group relative focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
    >
      <div className="card p-5 h-full flex flex-col gap-3 transition-all duration-150
                      group-hover:border-indigo-500/60 group-hover:bg-surface-hover
                      group-hover:shadow-lg group-hover:shadow-indigo-500/5">

        {/* Header row: ticker + weight */}
        <div className="flex items-start justify-between pr-14">
          <span className="text-lg font-bold tracking-tight text-white">
            {holding.ticker}
          </span>
          <span className="text-xs font-mono text-gray-500 bg-surface-border px-2 py-0.5 rounded-full">
            {fmtWeight(holding.current_weight)}
          </span>
        </div>

        {/* Market value */}
        <p className="text-xl font-semibold num text-gray-100">
          {fmtCurrency(holding.market_value, currency)}
        </p>

        {/* P&L row */}
        <div className="flex items-center gap-2 mt-auto">
          <span className={`text-sm font-medium num ${pnlClass}`}>
            {fmtPctSigned(holding.unrealized_pnl_pct)}
          </span>
          <span className="text-gray-700">·</span>
          <span className={`text-xs num ${pnlClass}`}>
            {holding.unrealized_pnl >= 0 ? '+' : ''}{fmtCurrency(holding.unrealized_pnl, currency)}
          </span>
        </div>

        {/* Qty + avg price */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{holding.quantity} units</span>
          <span className="text-gray-700">·</span>
          <span>avg {fmtCurrency(holding.average_buy_price, currency)}</span>
        </div>

        {/* Estimated price warning */}
        {holding.price_is_estimated && (
          <div className="flex items-center gap-1.5 text-xs text-amber-500/80">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            No live price — using cost basis
          </div>
        )}
      </div>

      {/* Action buttons — top-right, visible on hover */}
      <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all z-10">
        {/* Edit button */}
        <button
          onClick={handleEditClick}
          title={`Edit ${holding.ticker}`}
          className="w-6 h-6 rounded-md flex items-center justify-center
                     text-gray-500 hover:text-indigo-400 hover:bg-indigo-400/10 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        {/* Delete button */}
        <button
          onClick={handleDelete}
          disabled={deleting}
          title={`Remove ${holding.ticker}`}
          className="w-6 h-6 rounded-md flex items-center justify-center
                     text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-all
                     disabled:cursor-not-allowed"
        >
          {deleting
            ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
          }
        </button>
      </div>
    </Link>
  )
}
