import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { getAdvisorAdvice } from '../api/client'

/**
 * AiAdvisorPanel.jsx
 * ------------------
 * Panel that fetches and renders the Ollama LLM portfolio advisory report.
 *
 * States
 * ------
 * idle     → "Generate AI Analysis" CTA button
 * loading  → spinner + estimated wait message (LLM inference can take 10-40s)
 * success  → ReactMarkdown-rendered advisory text with model badge
 * fallback → same as success but with an amber banner noting Ollama is offline
 * error    → error message with retry button
 *
 * @param {object} props
 * @param {string} props.portfolioId
 */
export default function AiAdvisorPanel({ portfolioId }) {
  const [advice, setAdvice]   = useState(null)   // AdvisorResponse | null
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    setAdvice(null)
    try {
      const data = await getAdvisorAdvice(portfolioId)
      setAdvice(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-5 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            AI Advisor
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {advice && (
            <span className="text-xs text-gray-600 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
              {advice.model_used}
            </span>
          )}
          {(advice || error) && !loading && (
            <button
              onClick={generate}
              className="text-xs text-gray-500 hover:text-indigo-400 transition-colors px-2 py-1 rounded hover:bg-indigo-500/10"
            >
              Regenerate ↺
            </button>
          )}
        </div>
      </div>

      {/* ── Idle: CTA ────────────────────────────────────────────────────── */}
      {!advice && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 py-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20
                          flex items-center justify-center">
            <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-gray-300 font-medium mb-1">
              Generate AI Portfolio Analysis
            </p>
            <p className="text-xs text-gray-500 max-w-xs">
              A local Llama 3 model will analyse your portfolio metrics and
              provide plain-English rebalancing advice.
            </p>
          </div>
          <button
            onClick={generate}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700
                       text-white text-sm font-medium rounded-lg transition-colors
                       flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Analysis
          </button>
          <p className="text-xs text-gray-600">
            Requires <code className="text-gray-500">ollama serve</code> +{' '}
            <code className="text-gray-500">ollama pull llama3</code>
          </p>
        </div>
      )}

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 py-6 text-center">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent
                            border-t-indigo-500 animate-spin" />
          </div>
          <div>
            <p className="text-sm text-gray-300">Generating advice…</p>
            <p className="text-xs text-gray-500 mt-1">
              LLM inference may take 10–40 s on an 8B model
            </p>
          </div>
          <div className="w-full max-w-xs space-y-1.5">
            {['Crunching portfolio analytics', 'Consulting the oracle', 'Writing your report'].map(
              (step, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                  <div
                    className="w-1.5 h-1.5 rounded-full bg-indigo-500/50 animate-pulse"
                    style={{ animationDelay: `${i * 0.3}s` }}
                  />
                  {step}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-6 text-center">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-gray-400">Failed to generate advice</p>
            <p className="text-xs text-gray-600 mt-1">{error}</p>
          </div>
          <button
            onClick={generate}
            className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* ── Success: rendered markdown ─────────────────────────────────────── */}
      {advice && !loading && (
        <div className="flex-1 flex flex-col gap-3 min-h-0">

          {/* Fallback / Ollama-offline banner */}
          {advice.is_fallback && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300/80 shrink-0">
              <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span>
                Ollama offline — showing data-driven summary.
                Run <code className="text-amber-200">ollama serve</code> for LLM analysis.
              </span>
            </div>
          )}

          {/* Markdown content — scrollable */}
          <div className="flex-1 overflow-y-auto -mx-1 px-1">
            <div className="md-prose">
              <ReactMarkdown>{advice.analysis}</ReactMarkdown>
            </div>
          </div>

          {/* Footer: timestamp */}
          <p className="text-xs text-gray-700 shrink-0 pt-2 border-t border-surface-border">
            Generated {new Date(advice.generated_at).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  )
}
