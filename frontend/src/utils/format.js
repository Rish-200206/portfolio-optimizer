// Intl.NumberFormat cache keyed by "CURRENCY:compact"
const _fmt = new Map()

function getFormatter(currency = 'USD', compact = false) {
  const key = `${currency}:${compact}`
  if (!_fmt.has(key)) {
    _fmt.set(
      key,
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        ...(compact
          ? { notation: 'compact', maximumFractionDigits: 1 }
          : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      }),
    )
  }
  return _fmt.get(key)
}

/**
 * Format a number as a currency string.
 * @param {number} n
 * @param {string} [currency='USD']  ISO 4217 code, e.g. 'INR', 'GBP'
 * @returns {string} e.g. "₹1,25,430.50" | "$125,430.50"
 */
export const fmtCurrency = (n, currency = 'USD') =>
  getFormatter(currency).format(n)

/**
 * Format a large number in compact notation.
 * @param {number} n
 * @param {string} [currency='USD']
 * @returns {string} e.g. "₹1.2L" | "$125.4K"
 */
export const fmtCompact = (n, currency = 'USD') =>
  getFormatter(currency, true).format(n)

/**
 * Format a decimal fraction as a percentage with a sign prefix.
 * @param {number} n  – already a percentage value (e.g. 9.07 for 9.07%)
 * @param {number} [decimals=2]
 * @returns {string} e.g. "+9.07%" or "-3.14%"
 */
export const fmtPctSigned = (n, decimals = 2) =>
  `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`

/**
 * Format a 0–1 weight fraction as a percentage (no sign).
 * @param {number} n – fraction, e.g. 0.359
 * @returns {string} e.g. "35.9%"
 */
export const fmtWeight = (n) => `${(n * 100).toFixed(1)}%`

/**
 * Format a decimal fraction (0–1) as an annualised percentage.
 * @param {number} n  – e.g. 0.185
 * @returns {string} e.g. "18.5%"
 */
export const fmtVolatility = (n) => `${(n * 100).toFixed(1)}%`

/**
 * Return the CSS class name for a positive/negative/neutral value.
 * @param {number} n
 * @returns {'gain'|'loss'|'flat'}
 */
export const gainLossClass = (n) => (n > 0 ? 'gain' : n < 0 ? 'loss' : 'flat')

/**
 * Return a sign-prefixed currency string for a P&L value.
 * @param {number} n
 * @param {string} [currency='USD']
 * @returns {string} e.g. "+₹10,430.50" or "-₹3,210.00"
 */
export const fmtPnlCurrency = (n, currency = 'USD') =>
  n >= 0 ? `+${fmtCurrency(n, currency)}` : fmtCurrency(n, currency)
