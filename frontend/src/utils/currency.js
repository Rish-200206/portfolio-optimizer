/**
 * utils/currency.js
 * -----------------
 * Maps ticker exchange suffixes to ISO 4217 currency codes.
 *
 * yfinance supports equities on virtually every major world exchange.
 * Tickers without a suffix are assumed to be on a US exchange (USD).
 * Suffixes are the part after the last '.' in the ticker symbol.
 *
 * Examples:
 *   AAPL        → USD  (no suffix = US exchange)
 *   RELIANCE.NS → INR  (NSE India)
 *   BP.L        → GBP  (London)
 *   SAP.DE      → EUR  (Xetra / Frankfurt)
 *   7203.T      → JPY  (Tokyo)
 */

const SUFFIX_TO_CURRENCY = {
  // India
  NS: 'INR', BO: 'INR',
  // UK
  L: 'GBP',
  // Eurozone
  DE: 'EUR', F: 'EUR', MI: 'EUR', PA: 'EUR',
  AS: 'EUR', MC: 'EUR', VI: 'EUR', BR: 'EUR',
  LS: 'EUR', HE: 'EUR', AT: 'EUR',
  // Japan
  T: 'JPY', OS: 'JPY',
  // Hong Kong
  HK: 'HKD',
  // Canada
  TO: 'CAD', V: 'CAD',
  // Australia
  AX: 'AUD',
  // China (mainland)
  SS: 'CNY', SZ: 'CNY',
  // South Korea
  KS: 'KRW', KQ: 'KRW',
  // Taiwan
  TW: 'TWD', TWO: 'TWD',
  // Singapore
  SI: 'SGD',
  // Indonesia
  JK: 'IDR',
  // Malaysia
  KL: 'MYR',
  // Thailand
  BK: 'THB',
  // Switzerland
  SW: 'CHF', VX: 'CHF',
  // Sweden
  ST: 'SEK',
  // Norway
  OL: 'NOK',
  // Denmark
  CO: 'DKK',
  // New Zealand
  NZ: 'NZD',
  // Brazil
  SA: 'BRL',
  // Mexico
  MX: 'MXN',
  // South Africa
  JO: 'ZAR',
  // Israel
  TA: 'ILS',
}

/**
 * Return the ISO 4217 currency code for a given ticker symbol.
 * @param {string} ticker  e.g. "AAPL", "RELIANCE.NS", "BP.L"
 * @returns {string}       e.g. "USD", "INR", "GBP"
 */
export function currencyFromTicker(ticker) {
  if (!ticker) return 'USD'
  const parts = ticker.toUpperCase().split('.')
  if (parts.length === 1) return 'USD'
  const suffix = parts[parts.length - 1]
  return SUFFIX_TO_CURRENCY[suffix] ?? 'USD'
}

/**
 * Return the currency symbol character(s) for a given ISO 4217 code.
 * Uses Intl.NumberFormat to extract the symbol so it matches the browser locale.
 * @param {string} code  e.g. "INR", "USD", "GBP"
 * @returns {string}     e.g. "₹", "$", "£"
 */
export function currencySymbol(code) {
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
      .formatToParts(0)
    return parts.find((p) => p.type === 'currency')?.value ?? code
  } catch {
    return code
  }
}
