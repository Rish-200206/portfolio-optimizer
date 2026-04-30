/**
 * api/client.js
 * -------------
 * Thin fetch wrapper around the FastAPI backend.
 *
 * All requests go through the Vite dev-server proxy (/api → localhost:8000)
 * so no CORS preflight is needed during development.
 *
 * Every function returns a Promise that resolves to the parsed JSON body or
 * rejects with an Error whose message is the API's `detail` string.
 */

const BASE = '/api'

/**
 * Core fetch wrapper. Throws an Error with the API detail message on non-2xx.
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      detail = body.detail ?? detail
    } catch {
      // non-JSON error body — keep the status string
    }
    throw new Error(detail)
  }

  // 204 No Content
  if (res.status === 204) return null
  return res.json()
}

// ---------------------------------------------------------------------------
// Portfolio endpoints
// ---------------------------------------------------------------------------

/** @returns {Promise<string[]>} List of portfolio IDs */
export const getPortfolios = () => apiFetch('/portfolios')

/** @returns {Promise<import('./types').PortfolioSummary>} */
export const getPortfolioSummary = (portfolioId) =>
  apiFetch(`/portfolios/${portfolioId}/summary`)

/** @returns {Promise<import('./types').PortfolioAnalytics>} */
export const getAnalytics = (portfolioId) =>
  apiFetch(`/portfolios/${portfolioId}/analytics`)

// ---------------------------------------------------------------------------
// Holdings endpoints
// ---------------------------------------------------------------------------

/** @returns {Promise<import('./types').Holding[]>} */
export const getHoldings = (portfolioId) =>
  apiFetch(`/portfolios/${portfolioId}/holdings`)

/**
 * @param {string} portfolioId
 * @param {{ ticker: string, quantity: number, average_buy_price: number }} body
 * @returns {Promise<import('./types').Holding>}
 */
export const createHolding = (portfolioId, body) =>
  apiFetch(`/portfolios/${portfolioId}/holdings`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

/**
 * @param {string} portfolioId
 * @param {string} ticker
 * @param {{ quantity?: number, average_buy_price?: number }} body
 */
export const updateHolding = (portfolioId, ticker, body) =>
  apiFetch(`/portfolios/${portfolioId}/holdings/${ticker}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

/** @returns {Promise<null>} */
export const deleteHolding = (portfolioId, ticker) =>
  apiFetch(`/portfolios/${portfolioId}/holdings/${ticker}`, { method: 'DELETE' })

// ---------------------------------------------------------------------------
// Transactions endpoints
// ---------------------------------------------------------------------------

/** @returns {Promise<import('./types').Transaction[]>} */
export const getTransactions = (portfolioId) =>
  apiFetch(`/portfolios/${portfolioId}/transactions`)

/**
 * @param {string} portfolioId
 * @param {{ ticker: string, action: 'BUY'|'SELL', price: number, quantity: number, transaction_date: string }} body
 * @returns {Promise<import('./types').Transaction>}
 */
export const createTransaction = (portfolioId, body) =>
  apiFetch(`/portfolios/${portfolioId}/transactions`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

// ---------------------------------------------------------------------------
// Price endpoints
// ---------------------------------------------------------------------------

/**
 * Trigger a yfinance price refresh for all holdings in a portfolio.
 * @param {string} portfolioId
 * @param {boolean} [force=false]
 */
export const refreshPrices = (portfolioId, force = false) =>
  apiFetch(`/portfolios/${portfolioId}/prices/refresh?force=${force}`, {
    method: 'POST',
  })

/** @returns {Promise<Array<{ date: string, close: number }>>} */
export const getTickerPrices = (portfolioId, ticker) =>
  apiFetch(`/portfolios/${portfolioId}/prices/${ticker}`)

// ---------------------------------------------------------------------------
// AI Advisor endpoint
// ---------------------------------------------------------------------------

/** @returns {Promise<import('./types').AdvisorResponse>} */
export const getAdvisorAdvice = (portfolioId) =>
  apiFetch(`/portfolios/${portfolioId}/advisor`)

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const getHealth = () => apiFetch('/health')
