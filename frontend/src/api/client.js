// All requests go through the Vite dev-server proxy (/api → localhost:8000)
const BASE = '/api'

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
      // non-JSON error body
    }
    throw new Error(detail)
  }

  if (res.status === 204) return null  // No Content
  return res.json()
}

export const getPortfolios = () => apiFetch('/portfolios')
export const getPortfolioSummary = (portfolioId) => apiFetch(`/portfolios/${portfolioId}/summary`)
export const getAnalytics = (portfolioId) => apiFetch(`/portfolios/${portfolioId}/analytics`)

export const getHoldings = (portfolioId) => apiFetch(`/portfolios/${portfolioId}/holdings`)

export const createHolding = (portfolioId, body) =>
  apiFetch(`/portfolios/${portfolioId}/holdings`, { method: 'POST', body: JSON.stringify(body) })

export const updateHolding = (portfolioId, ticker, body) =>
  apiFetch(`/portfolios/${portfolioId}/holdings/${ticker}`, { method: 'PATCH', body: JSON.stringify(body) })

export const deleteHolding = (portfolioId, ticker) =>
  apiFetch(`/portfolios/${portfolioId}/holdings/${ticker}`, { method: 'DELETE' })

export const getTransactions = (portfolioId) => apiFetch(`/portfolios/${portfolioId}/transactions`)

export const createTransaction = (portfolioId, body) =>
  apiFetch(`/portfolios/${portfolioId}/transactions`, { method: 'POST', body: JSON.stringify(body) })

export const refreshPrices = (portfolioId, force = false) =>
  apiFetch(`/portfolios/${portfolioId}/prices/refresh?force=${force}`, { method: 'POST' })

export const getTickerPrices = (portfolioId, ticker) =>
  apiFetch(`/portfolios/${portfolioId}/prices/${ticker}`)

export const getAdvisorAdvice = (portfolioId) => apiFetch(`/portfolios/${portfolioId}/advisor`)

export const sendChatMessage = (portfolioId, message, history = []) =>
  apiFetch(`/portfolios/${portfolioId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message, history }),
  })

export const searchTickers = (query) => apiFetch(`/search/tickers?q=${encodeURIComponent(query)}`)

export const getHealth = () => apiFetch('/health')
