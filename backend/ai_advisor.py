"""
ai_advisor.py
-------------
Local LLM advisor powered by a locally running Ollama instance.

Responsibilities
----------------
- Build a structured, data-rich prompt from a :class:`~backend.models.PortfolioAnalytics`
  object and inject it into a system + user message pair tuned for an 8B-parameter
  Llama 3 model.
- Stream or receive the response via the ``ollama`` Python client's async API.
- Degrade gracefully when the Ollama service is not running: return a static
  fallback message with ``is_fallback=True`` so the frontend can still display
  meaningful information.

Public API
----------
generate_advice(analytics) → AdvisorResponse   (async)

Design notes
------------
- No external API keys are used.  All inference is 100% local.
- The system prompt is written for a short-context 8B model:
  concise instructions, numbered outputs, no open-ended chain-of-thought.
- The user-facing data payload is deliberately compact (uses abbreviations and
  tables) to stay well within the 8 192-token context window of Llama 3 8B.
- Temperature is set low (0.25) to produce deterministic, factual output
  rather than creative hallucinations.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import ollama

from .models import AdvisorResponse, PortfolioAnalytics

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

#: Ollama model tag.  Must be pulled locally: ``ollama pull llama3``
OLLAMA_MODEL: str = "llama3"

#: Base URL of the local Ollama HTTP service.
OLLAMA_HOST: str = "http://localhost:11434"

#: Max tokens the model should generate.  ~600 words at typical token ratios.
MAX_TOKENS: int = 900

#: Sampling temperature.  Lower = more factual, less creative.
TEMPERATURE: float = 0.25

# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT: str = """\
You are a concise, factual quantitative financial advisor helping a retail investor \
understand their stock portfolio.

When given portfolio data, produce a structured markdown report with EXACTLY these \
four sections — no more, no less:

## Portfolio Health Summary
2-3 sentences: overall P&L, whether the portfolio is profitable, and its risk level \
in plain English.

## Key Observations
3 bullet points: the most important things the investor should know right now \
(e.g. concentrated positions, best/worst performer, volatility vs. typical market).

## Rebalancing Recommendations
Explain what the optimizer suggests in plain English. For each ticker with a \
meaningful weight change (> 2%), say whether to BUY MORE or TRIM, and briefly why \
(diversification, over-concentration, or expected-return improvement). \
If no optimisation was possible, say so and explain why.

## Actionable Insight
One clear, specific action the investor can take this week.

Rules:
- Use simple language. Avoid jargon; if you must use a term, define it in parentheses.
- Do NOT fabricate numbers. Use only the data provided.
- Do NOT give tax or legal advice.
- Keep the total response under 400 words.\
"""


def _pct(value: float) -> str:
    """Format a decimal fraction as a percentage string, e.g. 0.183 → '18.3%'."""
    return f"{value * 100:.1f}%"


def _currency(value: float) -> str:
    """Format a float as a compact currency string, e.g. 125430.5 → '$125,430.50'."""
    return f"${value:,.2f}"


def _sign(value: float) -> str:
    """Prefix positive numbers with '+', negatives already have '-'."""
    return f"+{value:,.2f}" if value >= 0 else f"{value:,.2f}"


def _build_user_prompt(analytics: PortfolioAnalytics) -> str:
    """Serialise a :class:`PortfolioAnalytics` object into a compact, LLM-readable prompt.

    The format prioritises density over verbosity so the entire payload fits
    comfortably within the 8B model's context window even for large portfolios.

    Parameters
    ----------
    analytics:
        The full analytics payload produced by the quant engine.

    Returns
    -------
    str
        The complete user message to send to the model.
    """
    lines: list[str] = []

    # ── Header ─────────────────────────────────────────────────────────────
    lines.append(f"PORTFOLIO: {analytics.portfolio_id}")
    lines.append(f"VALUATION DATE: {analytics.valuation_date}")
    lines.append("")

    # ── Portfolio-level summary ─────────────────────────────────────────────
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
            "(for reference, the S&P 500 averages ~15-17% per year)"
        )
    else:
        lines.append("  Annualized Vol     : Not available (no price history stored)")

    lines.append("")

    # ── Holdings table (top 10 by market value) ────────────────────────────
    lines.append("## CURRENT HOLDINGS (sorted by market value)")
    lines.append("  Ticker | Weight | Mkt Value | Unreal. P&L%  | Price Estimated?")
    lines.append("  " + "-" * 65)
    for h in analytics.holdings[:10]:
        flag = " [ESTIMATED]" if h.price_is_estimated else ""
        lines.append(
            f"  {h.ticker:<12} | {_pct(h.current_weight):>7} | "
            f"{_currency(h.market_value):>12} | "
            f"{h.unrealized_pnl_pct:>+8.2f}%{flag}"
        )
    if len(analytics.holdings) > 10:
        lines.append(f"  ... and {len(analytics.holdings) - 10} more holdings")
    lines.append("")

    # ── Rebalancing recommendations ────────────────────────────────────────
    if analytics.optimisation is not None:
        opt = analytics.optimisation
        lines.append("## OPTIMISATION (Max Sharpe Ratio)")
        lines.append(f"  Expected Return    : {_pct(opt.expected_annual_return)} per year")
        lines.append(f"  Expected Vol       : {_pct(opt.expected_annual_volatility)} per year")
        lines.append(f"  Sharpe Ratio       : {opt.sharpe_ratio:.2f}")
        lines.append("")
        lines.append("  WEIGHT CHANGES REQUIRED (sorted by urgency):")
        lines.append("  Ticker | Current | Optimal | Delta    | Action")
        lines.append("  " + "-" * 55)
        for rec in opt.weights:
            action = "BUY MORE" if rec.weight_delta > 0.005 else (
                "TRIM" if rec.weight_delta < -0.005 else "HOLD"
            )
            lines.append(
                f"  {rec.ticker:<12} | {_pct(rec.current_weight):>7} | "
                f"{_pct(rec.optimal_weight):>7} | "
                f"{rec.weight_delta * 100:>+6.1f}pp | {action}"
            )
    else:
        lines.append("## OPTIMISATION")
        lines.append(
            "  Not available — requires ≥ 2 tickers with ≥ 60 days of price history."
        )
    lines.append("")

    # ── Warnings ───────────────────────────────────────────────────────────
    if analytics.warnings:
        lines.append("## DATA WARNINGS")
        for w in analytics.warnings:
            lines.append(f"  - {w}")
        lines.append("")

    lines.append(
        "Based on the above data, provide your structured financial advisor report."
    )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Fallback message
# ---------------------------------------------------------------------------


def _build_fallback_response(
    analytics: PortfolioAnalytics,
    error: str,
) -> AdvisorResponse:
    """Return a static, data-driven fallback when Ollama is unavailable.

    The fallback is not empty — it computes a simple plain-English summary
    from the analytics object so the user still gets useful information.

    Parameters
    ----------
    analytics:
        Full analytics payload from the quant engine.
    error:
        Raw error message from the Ollama client.

    Returns
    -------
    AdvisorResponse
        Response with ``is_fallback=True``.
    """
    pnl_direction = "profit" if analytics.total_unrealized_pnl >= 0 else "loss"
    pnl_sign = "+" if analytics.total_unrealized_pnl >= 0 else ""

    top_holding = analytics.holdings[0] if analytics.holdings else None
    top_line = (
        f"Your largest position is **{top_holding.ticker}** "
        f"({_pct(top_holding.current_weight)} of the portfolio)."
        if top_holding
        else ""
    )

    vol_line = (
        f"Portfolio annualised volatility is **{_pct(analytics.annualized_volatility)}**."
        if analytics.annualized_volatility is not None
        else "Volatility data is not yet available — run a price refresh first."
    )

    opt_line = (
        f"The Sharpe optimiser suggests targeting a **{_pct(analytics.optimisation.expected_annual_return)}** "
        f"expected return at a Sharpe ratio of **{analytics.optimisation.sharpe_ratio:.2f}**."
        if analytics.optimisation
        else "Portfolio optimisation data is not yet available."
    )

    analysis = f"""\
> **AI Advisor is offline** — the local Ollama service could not be reached.
> Start it with `ollama serve` and ensure `{OLLAMA_MODEL}` is pulled.
> The summary below is generated from raw data without LLM analysis.

---

## Portfolio Health Summary

Your portfolio is currently valued at **{_currency(analytics.total_market_value)}** \
with an unrealised **{pnl_direction}** of \
**{pnl_sign}{_currency(analytics.total_unrealized_pnl)}** \
({pnl_sign}{analytics.total_unrealized_pnl_pct:.2f}%). \
{top_line}

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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def generate_advice(analytics: PortfolioAnalytics) -> AdvisorResponse:
    """Call the local Ollama LLM and return a markdown-formatted advisory report.

    The function is ``async`` because LLM inference on an 8B model can take
    10–40 seconds locally; running it asynchronously keeps the FastAPI event
    loop unblocked for other requests.

    Error handling
    --------------
    The following failure modes are caught and converted to a graceful fallback
    rather than raising an HTTP 500 error:

    - ``ConnectionRefusedError`` / ``httpx.ConnectError``:
      Ollama service is not running (``ollama serve`` not started).
    - ``ollama.ResponseError``:
      Model not found locally (``ollama pull llama3`` not run yet).
    - Any other unexpected ``Exception``:
      Logged at ERROR level; fallback returned.

    Parameters
    ----------
    analytics:
        Full portfolio analytics payload from :func:`~backend.quant_engine.run_portfolio_analytics`.

    Returns
    -------
    AdvisorResponse
        Markdown advisory text, or a static fallback with ``is_fallback=True``
        when Ollama cannot be reached.
    """
    user_prompt: str = _build_user_prompt(analytics)

    logger.info(
        "Requesting LLM advice for portfolio '%s' using model '%s'.",
        analytics.portfolio_id,
        OLLAMA_MODEL,
    )

    try:
        client = ollama.AsyncClient(host=OLLAMA_HOST)

        response: Any = await client.chat(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            options={
                "temperature": TEMPERATURE,
                "num_predict": MAX_TOKENS,
            },
        )

        # The ollama client returns either a dict or a pydantic model depending
        # on version; handle both.
        if hasattr(response, "message"):
            raw_text: str = response.message.content
        else:
            raw_text = response["message"]["content"]

        logger.info(
            "LLM advice generated for portfolio '%s' (%d chars).",
            analytics.portfolio_id,
            len(raw_text),
        )

        return AdvisorResponse(
            portfolio_id=analytics.portfolio_id,
            model_used=OLLAMA_MODEL,
            analysis=raw_text,
            generated_at=datetime.now(tz=timezone.utc),
            is_fallback=False,
            error_detail=None,
        )

    except ollama.ResponseError as exc:
        error_msg = str(exc)
        logger.error(
            "Ollama model error for portfolio '%s': %s. "
            "Run 'ollama pull %s' to install the model.",
            analytics.portfolio_id,
            error_msg,
            OLLAMA_MODEL,
        )
        return _build_fallback_response(analytics, error_msg)

    except (ConnectionRefusedError, OSError) as exc:
        error_msg = (
            f"Cannot connect to Ollama at {OLLAMA_HOST}. "
            f"Start the service with 'ollama serve'. Detail: {exc}"
        )
        logger.warning(error_msg)
        return _build_fallback_response(analytics, str(exc))

    except Exception as exc:  # pragma: no cover
        error_msg = f"Unexpected error during LLM inference: {type(exc).__name__}: {exc}"
        logger.error(error_msg)
        return _build_fallback_response(analytics, str(exc))
