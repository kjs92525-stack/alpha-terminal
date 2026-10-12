// Investable US common-stock universe from SEC's company_tickers_exchange.json.
// {"fields":["cik","name","ticker","exchange"],"data":[[320193,"Apple Inc.","AAPL","Nasdaq"], ...]}

export const LISTED_EXCHANGES = ['Nasdaq', 'NYSE', 'CBOE'];

// Heuristics for non-common instruments (documented, not perfect):
//  - SEC hyphen suffixes: -WT/-WS (warrants), -UN/-U (units), -RT/-R (rights), -P* (preferred)
//  - 5-letter Nasdaq tickers ending in W/U/R are warrants/units/rights by Nasdaq convention
//  - names of blank-check / acquisition vehicles
const SUFFIX_RE = /-(WT|WS|W|UN|U|RT|R|P|P[A-Z])$/;
const NAME_EXCLUDE_RE = /\b(ACQUISITION CORP|ACQUISITION CO\b|BLANK CHECK|SPAC\b)|\bETF\b/i;

export function parseExchangeTickers(json) {
  const fields = json?.fields;
  const data = json?.data;
  if (!Array.isArray(fields) || !Array.isArray(data)) return [];
  const idx = Object.fromEntries(fields.map((f, i) => [f, i]));
  return data.map((r) => ({ cik: String(r[idx.cik]).padStart(10, '0'), name: String(r[idx.name] ?? ''), ticker: String(r[idx.ticker] ?? '').toUpperCase(), exchange: r[idx.exchange] ?? null }));
}

export function isCommonStockTicker(ticker, exchange) {
  if (!/^[A-Z]{1,5}(-[A-Z]{1,2})?$/.test(ticker)) return false;
  if (SUFFIX_RE.test(ticker)) {
    // keep share classes like BRK-B / BF-A (single letter A-D, not R/U/W/P)
    if (!/^[A-Z]{1,4}-[A-D]$/.test(ticker)) return false;
  }
  if (exchange === 'Nasdaq' && ticker.length === 5 && /[WUR]$/.test(ticker)) return false;
  return true;
}

/** SEC uses BRK-B; Alpaca and most venues use BRK.B. */
export const toVendorSymbol = (t) => t.replace('-', '.');
export const fromVendorSymbol = (t) => t.replace('.', '-');

export function buildUniverse(rows, { exchanges = LISTED_EXCHANGES } = {}) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!exchanges.includes(r.exchange)) continue;
    if (!isCommonStockTicker(r.ticker, r.exchange)) continue;
    if (NAME_EXCLUDE_RE.test(r.name)) continue;
    if (seen.has(r.ticker)) continue;
    seen.add(r.ticker);
    out.push({ ...r, symbol: toVendorSymbol(r.ticker) });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// SIC -> GICS-like sector (approximation for diversification caps and display).
export function sicToSector(sic) {
  const s = Number(sic);
  if (!Number.isFinite(s) || s <= 0) return 'Unknown';
  if (s === 6770) return 'Blank Check';
  if (s >= 1300 && s < 1400) return 'Energy';
  if (s >= 2900 && s < 3000) return 'Energy';
  if (s >= 1000 && s < 1500) return 'Materials';
  if (s >= 1500 && s < 1800) return 'Industrials';
  if (s >= 2000 && s < 2200) return 'Consumer Staples';
  if (s >= 2830 && s <= 2836) return 'Health Care';
  if (s >= 2800 && s < 2900) return s >= 2840 && s <= 2844 ? 'Consumer Staples' : 'Materials';
  if (s >= 2700 && s < 2800) return 'Communication Services';
  if (s >= 2600 && s < 2700) return 'Materials';
  if (s >= 2200 && s < 2600) return 'Consumer Discretionary';
  if (s >= 3000 && s < 3400) return 'Materials';
  if (s >= 3400 && s < 3500) return 'Industrials';
  if (s >= 3570 && s < 3580) return 'Information Technology';
  if (s >= 3500 && s < 3600) return 'Industrials';
  if (s >= 3610 && s < 3630) return 'Industrials';
  if (s >= 3630 && s < 3640) return 'Consumer Discretionary';
  if (s >= 3640 && s < 3650) return 'Industrials';
  if (s >= 3600 && s < 3700) return 'Information Technology';
  if ((s >= 3711 && s <= 3716) || s === 3751) return 'Consumer Discretionary';
  if (s >= 3700 && s < 3800) return 'Industrials';
  if (s >= 3840 && s <= 3851) return 'Health Care';
  if (s >= 3800 && s < 3900) return 'Information Technology';
  if (s >= 3900 && s < 4000) return 'Consumer Discretionary';
  if (s >= 4800 && s < 4900) return 'Communication Services';
  if (s >= 4900 && s < 5000) return 'Utilities';
  if (s >= 4000 && s < 4800) return 'Industrials';
  if (s >= 5120 && s <= 5122) return 'Health Care';
  if (s >= 5000 && s < 5200) return 'Industrials';
  if ((s >= 5400 && s < 5500) || s === 5912) return 'Consumer Staples';
  if (s >= 5200 && s < 6000) return 'Consumer Discretionary';
  if (s === 6798 || (s >= 6500 && s < 6600)) return 'Real Estate';
  if (s >= 6000 && s < 6800) return 'Financials';
  if (s >= 7370 && s < 7380) return 'Information Technology';
  if (s >= 7800 && s < 8000) return 'Communication Services';
  if (s >= 7000 && s < 7100) return 'Consumer Discretionary';
  if (s >= 8000 && s < 8100) return 'Health Care';
  if (s >= 7000 && s < 9000) return 'Industrials';
  return 'Other';
}
