import { useState, useEffect, useCallback } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { getPortfolios, refreshPrices } from './api/client'
import Navbar from './components/Navbar'
import Spinner from './components/Spinner'
import AddHoldingModal from './components/AddHoldingModal'
import ChatPanel from './components/ChatPanel'
import SummaryPage from './pages/SummaryPage'
import DetailPage from './pages/DetailPage'

const DEFAULT_PORTFOLIO = 'my_portfolio'

function EmptyState({ onAddStock }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-6">
      <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/20
                      flex items-center justify-center text-3xl">
        📊
      </div>
      <div className="max-w-sm">
        <h2 className="text-2xl font-bold text-white mb-2">Build your portfolio</h2>
        <p className="text-gray-400 text-sm leading-relaxed">
          Add the stocks you hold — ticker, quantity, and the price you paid.
          We'll pull the latest closing prices automatically.
        </p>
      </div>
      <button
        onClick={onAddStock}
        className="flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500
                   text-white font-medium text-sm transition-colors shadow-lg shadow-indigo-600/20"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add your first stock
      </button>
    </div>
  )
}

export default function App() {
  const [portfolios, setPortfolios]               = useState([])
  const [selectedPortfolio, setSelectedPortfolio] = useState(DEFAULT_PORTFOLIO)
  const [loadingPortfolios, setLoadingPortfolios] = useState(true)
  const [portfolioError, setPortfolioError]       = useState(null)
  const [showAddModal, setShowAddModal]           = useState(false)
  // Incrementing this tells SummaryPage to re-fetch analytics (e.g. after price refresh)
  const [refreshKey, setRefreshKey]               = useState(0)

  const bumpRefresh = () => setRefreshKey((k) => k + 1)

  const loadPortfolios = useCallback(() => {
    setLoadingPortfolios(true)
    setPortfolioError(null)
    getPortfolios()
      .then((data) => {
        setPortfolios(data)
        if (data.length > 0 && !data.includes(selectedPortfolio)) {
          setSelectedPortfolio(data[0])
        }
      })
      .catch((err) => setPortfolioError(err.message))
      .finally(() => setLoadingPortfolios(false))
  }, [selectedPortfolio])

  useEffect(() => { loadPortfolios() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddSuccess = async () => {
    setShowAddModal(false)
    try { await refreshPrices(selectedPortfolio, false) } catch { /* ignore */ }
    bumpRefresh()       // tell SummaryPage to reload analytics with new prices
    loadPortfolios()
  }

  const isEmpty = !loadingPortfolios && !portfolioError && portfolios.length === 0

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#0d1117] text-white">

        <Navbar
          selectedPortfolio={selectedPortfolio}
          onAddStock={() => setShowAddModal(true)}
          onRefreshComplete={bumpRefresh}
        />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {loadingPortfolios && <Spinner label="Connecting to backend…" />}

          {portfolioError && !loadingPortfolios && (
            <div className="card border-red-700/50 bg-red-900/10 p-6 text-center max-w-lg mx-auto mt-16">
              <p className="text-red-400 font-semibold">Cannot reach the backend</p>
              <p className="text-sm text-red-300/70 mt-1">{portfolioError}</p>
              <p className="text-xs text-gray-500 mt-3">
                Start the API server:{' '}
                <code className="text-gray-400">uvicorn backend.main:app --reload --port 8000</code>
              </p>
            </div>
          )}

          {!loadingPortfolios && !portfolioError && (
            <Routes>
              <Route
                path="/"
                element={
                  isEmpty ? (
                    <EmptyState onAddStock={() => setShowAddModal(true)} />
                  ) : (
                    <SummaryPage
                      portfolioId={selectedPortfolio}
                      refreshKey={refreshKey}
                      onAddStock={() => setShowAddModal(true)}
                      onHoldingDeleted={() => { bumpRefresh(); loadPortfolios() }}
                    />
                  )
                }
              />
              <Route
                path="/holdings/:ticker"
                element={<DetailPage portfolioId={selectedPortfolio} />}
              />
            </Routes>
          )}
        </main>

        {showAddModal && (
          <AddHoldingModal
            portfolioId={selectedPortfolio}
            onClose={() => setShowAddModal(false)}
            onSuccess={handleAddSuccess}
          />
        )}

        <ChatPanel portfolioId={selectedPortfolio} />
      </div>
    </BrowserRouter>
  )
}
