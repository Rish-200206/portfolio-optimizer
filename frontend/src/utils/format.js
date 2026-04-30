/**
 * utils/format.js
 * ---------------
 * Formatting helpers used across the dashboard components.
 * All functions are pure and have no side effects.
 */

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const COMPACT_USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

/**
 * Format a number as a full USD currency string.
 * @param {number} n
 * @returns {string} e.g. "$125,430.50"
 */
export const fmtCurrency = (n) => USD.format(n)

/**
 * Format a large number in compact notation.
 * @param {number} n
 * @returns {string} e.g. "$125.4K"
 */
export const fmtCompact = (n) => COMPACT_USD.format(n)

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
 * @returns {string} e.g. "+$10,430.50" or "-$3,210.00"
 */
export const fmtPnlCurrency = (n) => `${n >= 0 ? '+' : ''}${fmtCurrency(n)}`
