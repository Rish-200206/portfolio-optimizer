"""Local LLM advisor via Ollama. Falls back gracefully when Ollama is offline."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import ollama

from .models import AdvisorResponse, ChatMessage, ChatResponse, PortfolioAnalytics

logger = logging.getLogger(__name__)

OLLAMA_MODEL: str = "llama3"  # try qwen3:8b or deepseek-r1:8b for better financial analysis
OLLAMA_HOST: str = "http://localhost:11434"
MAX_TOKENS: int = 1500
CHAT_MAX_TOKENS: int = 800
TEMPERATURE: float = 0.3

_SYSTEM_PROMPT: str = """\
You are an expert stock market investor, financial analyst, and portfolio advisor \
with deep knowledge of global equity markets, macroeconomics, and quantitative finance.

You are helping a retail investor understand and improve their stock portfolio. \
You should think like a seasoned fund manager — not just report data, but provide \
insightful analysis drawing on your knowledge of market conditions, sector trends, \
and investment strategy.

When given portfolio data, produce a structured markdown report with EXACTLY these \
sections — no more, no less:

## Portfolio Health Summary
2-3 sentences: overall P&L, whether the portfolio is profitable, risk level, and \
how it compares to typical market performance. Comment on portfolio concentration \
and diversification.

## Key Observations
3-4 bullet points covering:
- Best and worst performers and why (sector context, recent catalysts)
- Concentration risks or over-exposure to any sector/theme
- Volatility assessment relative to broader markets (S&P 500 ~15-17% annual vol)
- Any notable market conditions or macroeconomic factors that affect these holdings

## Rebalancing Recommendations
Explain what the optimizer suggests in plain English. For each ticker with a \
meaningful weight change (> 2%), say whether to BUY MORE or TRIM, and briefly why \
(diversification, over-concentration, valuation, or expected-return improvement). \
If no optimisation was possible, say so and explain why.

## Stocks to Consider
Suggest 2-3 specific stocks or ETFs that could complement or strengthen this \
portfolio. For each suggestion, briefly explain:
- Why it would add value (diversification, sector exposure, growth potential)
- The general risk level of the suggestion
Base these on what's MISSING from the portfolio (e.g., if all tech, suggest \
defensive sectors; if all US, suggest international exposure).

## Risk Factors & Market Outlook
2-3 bullet points about current macro risks or market conditions the investor \
should be aware of (interest rates, inflation, geopolitical events, sector rotations). \
Keep this grounded and practical.

## Actionable Insight
One clear, specific action the investor can take this week, considering both \
their portfolio and broader market conditions.

Rules:
- Use simple language. Avoid jargon; if you must use a term, define it in parentheses.
- Do NOT fabricate specific numerical data (stock prices, P/E ratios) — but you may \
  reference general market knowledge and well-known facts about companies/sectors.
- Do NOT give tax or legal advice.
- Keep the total response under 600 words.
- When suggesting stocks, note that these are educational suggestions, not financial advice.\
"""

_CHAT_SYSTEM_PROMPT: str = """\
You are an expert stock market investor, financial analyst, and portfolio advisor \
with deep knowledge of global equity markets, macroeconomics, and quantitative finance. \
You are having a conversation with a retail investor about their portfolio and the markets.

You have access to their current portfolio data (provided below). Use this context \
to give personalized, insightful answers. Think like a seasoned fund manager.

Guidelines:
- Be conversational but informative. Give direct, actionable answers.
- You may reference general market knowledge, sector trends, macroeconomic conditions, \
  and well-known facts about companies.
- Do NOT fabricate specific numerical data (exact stock prices, P/E ratios) unless \
  provided in the portfolio context.
- When asked about stocks to buy/sell, provide thoughtful analysis but always note \
  these are educational perspectives, not financial advice.
- Do NOT give tax or legal advice.
- Keep responses concise (under 300 words unless the question requires detail).
- Use markdown formatting for readability (bold, bullets, headers when appropriate).
- If asked about something outside your expertise, say so honestly.\
"""


def _pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def _currency(value: float) -> str:
    return f"${value:,.2f}"


def _build_user_prompt(analytics: PortfolioAnalytics) -> str:
    lines: list[str] = []

    lines.append(f"PORTFOLIO: {analytics.portfolio_id}")
    lines.append(f"VALUATION DATE: {analytics.valuation_date}")
    lines.append("")

    lines.append("## PERFORMANCE SNAPSHOT")
    lines.append(f"  Total Market Value : {_currency(analytics.total_market_value)}")
    lines.append(f"  Total Cost Basis   : {_currency(analytics.total_cost_basis)}")
    pnl_sign = "+" if analytics.total_unrealized_pnl >= 0 else ""
    lines.append(
        f"  Unrealized P&L     : {pnl_sign}{_currency(analytics.total_unrealized_pnl)} "
        f"({pnl_sign}{analytics.total_unrealized_pnl_pct:.2f}%)"
    )
    if analytics.annualized_volatility is not None:
        lines.append(
            f"  Annualized Vol     : {_pct(analytics.annualized_volatility)} "
            "(S&P 500 averages ~15-17%/yr)"
        )
    else:
        lines.append("  Annualized Vol     : Not available (no price history stored)")
    lines.append("")

    lines.append("## CURRENT HOLDINGS (top 10 by market value)")
    lines.append("  Ticker | Weight | Mkt Value | Unreal. P&L%  | P/E | Div Yld")
    lines.append("  " + "-" * 70)
    for h in analytics.holdings[:10]:
        flag = " [EST]" if h.price_is_estimated else ""
        pe = f"{h.fundamentals.trailing_pe:.1f}" if (h.fundamentals and h.fundamentals.trailing_pe) else "N/A"
        yld = f"{h.fundamentals.dividend_yield * 100:.1f}%" if (h.fundamentals and h.fundamentals.dividend_yield) else "N/A"
        lines.append(
            f"  {h.ticker:<12} | {_pct(h.current_weight):>7} | "
            f"{_currency(h.market_value):>12} | "
            f"{h.unrealized_pnl_pct:>+8.2f}%{flag} | {pe:>5} | {yld:>5}"
        )
    if len(analytics.holdings) > 10:
        lines.append(f"  ... and {len(analytics.holdings) - 10} more holdings")
    lines.append("")

    lines.append("## RECENT RELEVANT NEWS")
    news_count = 0
    for h in analytics.holdings[:5]:
        if h.news:
            lines.append(f"  **{h.ticker}**")
            for n in h.news[:2]:
                lines.append(f"  - {n.title}")
                news_count += 1
    if news_count == 0:
        lines.append("  No recent news available.")
    lines.append("")

    if analytics.optimisation is not None:
        opt = analytics.optimisation
        lines.append("## OPTIMISATION (Max Sharpe Ratio)")
        lines.append(f"  Expected Return : {_pct(opt.expected_annual_return)} per year")
        lines.append(f"  Expected Vol    : {_pct(opt.expected_annual_volatility)} per year")
        lines.append(f"  Sharpe Ratio    : {opt.sharpe_ratio:.2f}")
        lines.append("")
        lines.append("  WEIGHT CHANGES (top 15 by magnitude):")
        lines.append("  Ticker | Current | Optimal | Delta    | Action")
        lines.append("  " + "-" * 55)
        for rec in sorted(opt.weights, key=lambda r: abs(r.weight_delta), reverse=True)[:15]:
            action = "BUY MORE" if rec.weight_delta > 0.005 else ("TRIM" if rec.weight_delta < -0.005 else "HOLD")
            lines.append(
                f"  {rec.ticker:<12} | {_pct(rec.current_weight):>7} | "
                f"{_pct(rec.optimal_weight):>7} | {rec.weight_delta * 100:>+6.1f}pp | {action}"
            )
    else:
        lines.append("## OPTIMISATION")
        lines.append("  Not available — requires ≥ 2 tickers with ≥ 60 days of price history.")
    lines.append("")

    if analytics.warnings:
        lines.append("## DATA WARNINGS")
        for w in analytics.warnings:
            lines.append(f"  - {w}")
        lines.append("")

    lines.append(
        "Based on the above, provide your expert financial advisor report. "
        "Include stock suggestions beyond the current portfolio and consider "
        "broader market conditions."
    )
    return "\n".join(lines)


def _build_portfolio_context(analytics: PortfolioAnalytics) -> str:
    lines: list[str] = ["=== PORTFOLIO CONTEXT ==="]
    lines.append(f"Portfolio: {analytics.portfolio_id}")
    lines.append(f"Total Value: {_currency(analytics.total_market_value)}")
    lines.append(f"Cost Basis: {_currency(analytics.total_cost_basis)}")
    pnl_sign = "+" if analytics.total_unrealized_pnl >= 0 else ""
    lines.append(f"P&L: {pnl_sign}{_currency(analytics.total_unrealized_pnl)} ({pnl_sign}{analytics.total_unrealized_pnl_pct:.2f}%)")
    if analytics.annualized_volatility is not None:
        lines.append(f"Volatility: {_pct(analytics.annualized_volatility)}")
    lines.append("\nHoldings:")
    for h in analytics.holdings[:15]:
        est = " [EST]" if h.price_is_estimated else ""
        pe = f", P/E={h.fundamentals.trailing_pe:.1f}" if (h.fundamentals and h.fundamentals.trailing_pe) else ""
        lines.append(
            f"  {h.ticker}: {h.quantity} shares @ {_currency(h.latest_price)}, "
            f"weight={_pct(h.current_weight)}, P&L={h.unrealized_pnl_pct:+.1f}%{pe}{est}"
        )
        if h.news:
            lines.append(f"    Recent news: {h.news[0].title}")
    if analytics.optimisation:
        lines.append(f"\nOptimal Sharpe: {analytics.optimisation.sharpe_ratio:.2f}")
    lines.append("=== END CONTEXT ===")
    return "\n".join(lines)


def _build_fallback_response(analytics: PortfolioAnalytics, error: str) -> AdvisorResponse:
    pnl_direction = "profit" if analytics.total_unrealized_pnl >= 0 else "loss"
    pnl_sign = "+" if analytics.total_unrealized_pnl >= 0 else ""
    top_holding = analytics.holdings[0] if analytics.holdings else None

    top_line = (
        f"Your largest position is **{top_holding.ticker}** ({_pct(top_holding.current_weight)} of the portfolio)."
        if top_holding else ""
    )
    vol_line = (
        f"Portfolio annualised volatility is **{_pct(analytics.annualized_volatility)}**."
        if analytics.annualized_volatility is not None
        else "Volatility data not yet available — run a price refresh first."
    )
    opt_line = (
        f"The Sharpe optimiser suggests targeting **{_pct(analytics.optimisation.expected_annual_return)}** "
        f"expected return at a Sharpe of **{analytics.optimisation.sharpe_ratio:.2f}**."
        if analytics.optimisation else "Portfolio optimisation data not yet available."
    )

    analysis = f"""\
> **AI Advisor is offline** — Ollama could not be reached.
> Start it with `ollama serve` and ensure `{OLLAMA_MODEL}` is pulled.
> The summary below is generated from raw data without LLM analysis.

---

## Portfolio Health Summary

Your portfolio is currently valued at **{_currency(analytics.total_market_value)}** \
with an unrealised **{pnl_direction}** of \
**{pnl_sign}{_currency(analytics.total_unrealized_pnl)}** \
({pnl_sign}{analytics.total_unrealized_pnl_pct:.2f}%). {top_line}

## Risk

{vol_line}

## Optimisation

{opt_line}
"""
    return AdvisorResponse(
        portfolio_id=analytics.portfolio_id,
        model_used=OLLAMA_MODEL,
        analysis=analysis,
        generated_at=datetime.now(tz=timezone.utc),
        is_fallback=True,
        error_detail=error,
    )


def _build_chat_fallback(error: str) -> ChatResponse:
    return ChatResponse(
        response=(
            "⚠️ **AI Chat is offline** — Ollama could not be reached.\n\n"
            f"Start it with `ollama serve` and ensure `{OLLAMA_MODEL}` is pulled.\n\n"
            "Once running, I can help with portfolio analysis, stock research, "
            "market outlook, and investment strategy questions."
        ),
        model_used=OLLAMA_MODEL,
        generated_at=datetime.now(tz=timezone.utc),
        is_fallback=True,
        error_detail=error,
    )


async def generate_advice(analytics: PortfolioAnalytics) -> AdvisorResponse:
    """Run the advisory prompt against the local Ollama LLM. Returns a fallback if Ollama is offline."""
    user_prompt = _build_user_prompt(analytics)
    logger.info("Requesting LLM advice for '%s' using '%s'.", analytics.portfolio_id, OLLAMA_MODEL)

    try:
        client = ollama.AsyncClient(host=OLLAMA_HOST)
        response: Any = await client.chat(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            options={"temperature": TEMPERATURE, "num_predict": MAX_TOKENS},
        )

        # ollama client returns either a pydantic model or a dict depending on version
        raw_text: str = response.message.content if hasattr(response, "message") else response["message"]["content"]
        logger.info("LLM advice generated for '%s' (%d chars).", analytics.portfolio_id, len(raw_text))

        return AdvisorResponse(
            portfolio_id=analytics.portfolio_id,
            model_used=OLLAMA_MODEL,
            analysis=raw_text,
            generated_at=datetime.now(tz=timezone.utc),
            is_fallback=False,
            error_detail=None,
        )

    except ollama.ResponseError as exc:
        logger.error("Ollama model error for '%s': %s. Run 'ollama pull %s'.",
                     analytics.portfolio_id, exc, OLLAMA_MODEL)
        return _build_fallback_response(analytics, str(exc))

    except (ConnectionRefusedError, OSError) as exc:
        logger.warning("Cannot connect to Ollama at %s: %s", OLLAMA_HOST, exc)
        return _build_fallback_response(analytics, str(exc))

    except Exception as exc:
        logger.error("Unexpected error during LLM inference: %s: %s", type(exc).__name__, exc)
        return _build_fallback_response(analytics, str(exc))


async def generate_chat_response(
    message: str,
    history: list[ChatMessage],
    analytics: PortfolioAnalytics | None = None,
) -> ChatResponse:
    """Send a conversational message to Ollama with portfolio context injected into the system prompt."""
    system_content = _CHAT_SYSTEM_PROMPT
    if analytics:
        system_content = f"{_CHAT_SYSTEM_PROMPT}\n\n{_build_portfolio_context(analytics)}"

    messages: list[dict[str, str]] = [{"role": "system", "content": system_content}]
    for msg in history[-10:]:  # cap history to stay within context window
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": message})

    logger.info("Chat request using '%s' (%d history messages).", OLLAMA_MODEL, len(history))

    try:
        client = ollama.AsyncClient(host=OLLAMA_HOST)
        response: Any = await client.chat(
            model=OLLAMA_MODEL,
            messages=messages,
            options={"temperature": TEMPERATURE, "num_predict": CHAT_MAX_TOKENS},
        )

        raw_text: str = response.message.content if hasattr(response, "message") else response["message"]["content"]
        logger.info("Chat response generated (%d chars).", len(raw_text))

        return ChatResponse(
            response=raw_text,
            model_used=OLLAMA_MODEL,
            generated_at=datetime.now(tz=timezone.utc),
            is_fallback=False,
            error_detail=None,
        )

    except ollama.ResponseError as exc:
        logger.error("Ollama model error in chat: %s. Run 'ollama pull %s'.", exc, OLLAMA_MODEL)
        return _build_chat_fallback(str(exc))

    except (ConnectionRefusedError, OSError) as exc:
        logger.warning("Cannot connect to Ollama at %s: %s", OLLAMA_HOST, exc)
        return _build_chat_fallback(str(exc))

    except Exception as exc:
        logger.error("Unexpected error in chat: %s: %s", type(exc).__name__, exc)
        return _build_chat_fallback(str(exc))
