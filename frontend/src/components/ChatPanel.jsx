import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { sendChatMessage } from '../api/client'

/**
 * ChatPanel.jsx
 * -------------
 * Global floating chatbot that lets users have a conversation with the AI
 * about their portfolio, market conditions, and investment strategy.
 *
 * Features
 * --------
 * - Floating action button (bottom-right) with pulse animation
 * - Slide-up chat panel with dark glass morphism design
 * - Message history with ReactMarkdown rendering
 * - Passes conversation history for multi-turn context
 * - Loading indicator during AI inference
 * - Suggested quick prompts for first interaction
 *
 * @param {object} props
 * @param {string} props.portfolioId
 */

const QUICK_PROMPTS = [
  "What's my portfolio's biggest risk right now?",
  "Which stocks should I consider buying?",
  "How is the market looking this week?",
  "Should I rebalance my portfolio?",
]

export default function ChatPanel({ portfolioId }) {
  const [isOpen, setIsOpen]       = useState(false)
  const [messages, setMessages]   = useState([])   // { role, content }
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const messagesEndRef            = useRef(null)
  const inputRef                  = useRef(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen])

  const sendMessage = async (text) => {
    const trimmed = (text || input).trim()
    if (!trimmed || loading) return

    const userMsg = { role: 'user', content: trimmed }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const response = await sendChatMessage(portfolioId, trimmed, messages)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: response.response },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ **Error**: ${err.message}\n\nMake sure the backend is running and Ollama is serving.`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const clearChat = () => {
    setMessages([])
  }

  return (
    <>
      {/* ── Floating action button ──────────────────────────────────────── */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-2xl
                    flex items-center justify-center transition-all duration-300
                    ${isOpen
                      ? 'bg-gray-700 hover:bg-gray-600 rotate-0'
                      : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
                    }`}
        title={isOpen ? 'Close chat' : 'Chat with AI Advisor'}
      >
        {isOpen ? (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <>
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {messages.length === 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-pulse" />
            )}
          </>
        )}
      </button>

      {/* ── Chat panel ──────────────────────────────────────────────────── */}
      <div
        className={`fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-3rem)]
                    transition-all duration-300 origin-bottom-right
                    ${isOpen
                      ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
                      : 'opacity-0 scale-95 translate-y-4 pointer-events-none'
                    }`}
      >
        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl shadow-black/40
                        flex flex-col overflow-hidden"
             style={{ height: '32rem', maxHeight: 'calc(100vh - 10rem)' }}
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d]
                          bg-[#0d1117]/50 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30
                              flex items-center justify-center">
                <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">AI Market Advisor</p>
                <p className="text-xs text-gray-500">Ask about stocks, markets, portfolio</p>
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors px-2 py-1 rounded
                           hover:bg-white/5"
                title="Clear chat history"
              >
                Clear
              </button>
            )}
          </div>

          {/* ── Messages ────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">

            {/* Welcome state */}
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20
                                flex items-center justify-center">
                  <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm text-gray-300 font-medium">How can I help?</p>
                  <p className="text-xs text-gray-600 mt-1 max-w-[16rem]">
                    Ask me anything about your portfolio, stocks, or the market.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 w-full">
                  {QUICK_PROMPTS.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(prompt)}
                      className="text-xs text-left text-gray-400 hover:text-indigo-300 px-3 py-2
                                 rounded-lg border border-[#30363d] hover:border-indigo-500/30
                                 hover:bg-indigo-500/5 transition-all"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message bubbles */}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                    ${msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-md'
                      : 'bg-[#21262d] text-gray-200 rounded-bl-md border border-[#30363d]'
                    }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="md-prose chat-prose">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span>{msg.content}</span>
                  )}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-[#21262d] border border-[#30363d] rounded-2xl rounded-bl-md
                                px-4 py-3 flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
                         style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
                         style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
                         style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-gray-500">Thinking…</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Input ───────────────────────────────────────────────────── */}
          <div className="shrink-0 border-t border-[#30363d] p-3 bg-[#0d1117]/50">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about stocks, markets, portfolio…"
                rows={1}
                className="flex-1 resize-none bg-[#21262d] border border-[#30363d] rounded-xl
                           px-3.5 py-2.5 text-sm text-white placeholder-gray-600
                           focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20
                           transition-colors max-h-24"
                style={{ minHeight: '2.5rem' }}
                disabled={loading}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                className="shrink-0 w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-500
                           disabled:bg-gray-700 disabled:cursor-not-allowed
                           flex items-center justify-center transition-colors"
              >
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            <p className="text-[10px] text-gray-700 mt-1.5 text-center">
              AI responses are educational, not financial advice
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
