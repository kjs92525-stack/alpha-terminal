// SIMULATED data for offline/demo mode. Instruments are fictitious (SIM01–SIM06)
// so synthetic numbers can never be mistaken for a real company's data.
import { resampleWeekly } from '../../../../packages/analysis/indicators.mjs';
import { classifyFiling } from '../../../../packages/analysis/sec.mjs';
import { scoreStock, rankUniverse } from '../../../../packages/analysis/scoring.mjs';
import { classifyHeadline } from '../../../../packages/analysis/news.mjs';
import type { AnalyzeResponse, Bar, BarsResponse, FdaResponse, Filing, FilingsResponse, Fundamentals, MoversResponse, NewsResponse, Quote, ScreenRow, SecLatestResponse, Timeframe } from './types';

interface SimSpec { symbol: string; name: string; price: number; drift: number; vol: number; seed: number; shares: number; revenue: number; growth: number; margin: number; ocf: number; cash: number; sharesYoY: number }

export const SIM_UNIVERSE: SimSpec[] = [
  { symbol: 'SIM01', name: 'Aurora Dynamics (가상)', price: 18.4, drift: 0.0012, vol: 0.032, seed: 11, shares: 9e7, revenue: 2.1e8, growth: 0.31, margin: -0.05, ocf: -1.2e7, cash: 1.4e8, sharesYoY: 0.04 },
  { symbol: 'SIM02', name: 'Northstar AI (가상)', price: 52.8, drift: 0.0016, vol: 0.022, seed: 23, shares: 3.1e8, revenue: 1.9e9, growth: 0.42, margin: 0.18, ocf: 4.1e8, cash: 2.2e9, sharesYoY: 0.01 },
  { symbol: 'SIM03', name: 'Vector Systems (가상)', price: 7.46, drift: 0.0004, vol: 0.041, seed: 37, shares: 6e7, revenue: 6e7, growth: 0.08, margin: -0.22, ocf: -2.4e7, cash: 3.1e7, sharesYoY: 0.19 },
  { symbol: 'SIM04', name: 'Solara Bio (가상)', price: 12.37, drift: -0.0004, vol: 0.05, seed: 41, shares: 1.2e8, revenue: 4e6, growth: -0.3, margin: -9, ocf: -9e7, cash: 1.1e8, sharesYoY: 0.38 },
  { symbol: 'SIM05', name: 'Cedar Holdings (가상)', price: 34.65, drift: 0.0005, vol: 0.013, seed: 53, shares: 4.5e8, revenue: 6.2e9, growth: 0.04, margin: 0.14, ocf: 1.1e9, cash: 9e8, sharesYoY: -0.02 },
  { symbol: 'SIM06', name: 'Orbit Energy (가상)', price: 26.18, drift: 0.0009, vol: 0.024, seed: 67, shares: 2.2e8, revenue: 3.3e9, growth: 0.12, margin: 0.07, ocf: 3.9e8, cash: 4.2e8, sharesYoY: 0 },
];

const spec = (symbol: string) => SIM_UNIVERSE.find((s) => s.symbol === symbol);

function genBars(s: SimSpec, n: number, stepSec: number, endSec: number, volScale = 1): Bar[] {
  let seed = s.seed * 7919 + n + stepSec;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const raw: Bar[] = [];
  let p = 100;
  const vol = s.vol * volScale;
  for (let i = 0; i < n; i++) {
    const shock = (rnd() - 0.5) * 2 * vol + (rnd() < 0.02 ? (rnd() - 0.45) * vol * 6 : 0);
    const o = p * (1 + (rnd() - 0.5) * vol * 0.3);
    const c = Math.max(0.2, o * (1 + s.drift * volScale + shock));
    const h = Math.max(o, c) * (1 + rnd() * vol * 0.6);
    const l = Math.min(o, c) * (1 - rnd() * vol * 0.6);
    raw.push({ time: 0, open: o, high: h, low: l, close: c, volume: Math.round((s.shares / 200) * (0.4 + rnd() * 1.4) * (1 + Math.abs(shock) * 12)) });
    p = c;
  }
  const k = s.price / raw[raw.length - 1].close;
  const times: number[] = [];
  let t = endSec;
  while (times.length < n) {
    const d = new Date(t * 1000).getUTCDay();
    if (stepSec < 86400 || (d !== 0 && d !== 6)) times.unshift(t);
    t -= stepSec;
  }
  return raw.map((b, i) => ({ ...b, time: times[i], open: b.open * k, high: b.high * k, low: b.low * k, close: b.close * k }));
}

const todayUtc = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000 - 86400; };

export function mockBars(symbol: string, tf: Timeframe): BarsResponse {
  const s = spec(symbol) ?? SIM_UNIVERSE[0];
  let bars: Bar[];
  if (tf === '1D') bars = genBars(s, 520, 86400, todayUtc());
  else if (tf === '1W') bars = resampleWeekly(genBars(s, 1300, 86400, todayUtc()));
  else if (tf === '1H') bars = genBars(s, 400, 3600, Math.floor(Date.now() / 3600000) * 3600 - 3600, 0.25);
  else bars = genBars(s, 400, 300, Math.floor(Date.now() / 300000) * 300 - 300, 0.08);
  return { symbol: s.symbol, timeframe: tf, bars, source: 'SIMULATED', sourceUrl: '', fetchedAt: new Date().toISOString(), lastBarClosed: true, delayNote: '가상 데이터' };
}

function mockFundamentals(s: SimSpec): Fundamentals {
  const end = `${new Date().getUTCFullYear() - 1}-12-31`;
  const pt = (value: number) => ({ end, value, filed: end, form: 'SIM' });
  return {
    entityName: s.name, revenue: pt(s.revenue), revenuePrior: pt(s.revenue / (1 + s.growth)), revenueGrowth: s.growth, revenueQuarterly: [],
    netIncome: pt(s.revenue * s.margin), netMargin: s.margin, operatingCashFlow: pt(s.ocf), cash: pt(s.cash), shortTermInvestments: null,
    liquidAssets: s.cash, runwayMonths: s.ocf < 0 ? s.cash / (-s.ocf / 12) : null, sharesOutstanding: pt(s.shares), sharesYoY: s.sharesYoY,
    stockholdersEquity: null, longTermDebt: null,
  };
}

const SIM_EVENTS: Array<[string, string, string, number]> = [
  ['SIM01', '8-K', '1.01,9.01', 3], ['SIM04', '424B5', '', 6], ['SIM04', '8-K', '8.01', 9], ['SIM02', '8-K', '2.02,9.01', 12],
  ['SIM03', '8-K', '3.02', 15], ['SIM05', '10-Q', '', 20], ['SIM06', 'SC 13D', '', 26], ['SIM03', 'S-3', '', 40], ['SIM02', '4', '', 44],
];

export function mockFilings(symbol?: string): Filing[] {
  return SIM_EVENTS.filter((e) => !symbol || e[0] === symbol).map(([sym, form, items, daysAgo], i): Filing => {
    const d = new Date(Date.now() - daysAgo * 86400000);
    d.setUTCHours(21, 5, 0, 0);
    return {
      accession: `SIM-${sym}-${i}`, form, filingDate: d.toISOString().slice(0, 10), acceptedAt: d.toISOString(), reportDate: null,
      description: `${sym} 가상 공시`, url: '', ...classifyFiling(form, items), items,
    };
  });
}

export function mockAnalyze(symbol: string): AnalyzeResponse {
  const s = spec(symbol) ?? SIM_UNIVERSE[0];
  const bars = mockBars(s.symbol, '1D').bars;
  const filings = mockFilings(s.symbol);
  const fundamentals = mockFundamentals(s);
  const now = new Date().toISOString();
  return {
    symbol: s.symbol, name: s.name, cik: null, sic: 'SIMULATED',
    score: scoreStock(bars, fundamentals, filings), fundamentals, filings, lastClose: bars[bars.length - 1],
    sources: { prices: { name: 'SIMULATED', url: '', fetchedAt: now }, filings: { name: 'SIMULATED', url: '', fetchedAt: now }, fundamentals: { name: 'SIMULATED', url: '', fetchedAt: now } },
    warnings: ['가상 데이터 — 실제 기업이 아닙니다'], generatedAt: now,
  };
}

export function mockScreen(symbols: string[]): ScreenRow[] {
  const rows = symbols.filter((s) => spec(s)).map((s) => {
    const a = mockAnalyze(s);
    return { ...a.score, symbol: a.symbol, name: a.name, lastClose: a.lastClose, error: null } as ScreenRow;
  });
  return rankUniverse(rows);
}

export function mockFilingsResponse(symbol: string): FilingsResponse {
  return { cik: '', name: spec(symbol)?.name ?? symbol, tickers: [symbol], sicDescription: 'SIMULATED', filings: mockFilings(symbol), source: 'SIMULATED', sourceUrl: '', fetchedAt: new Date().toISOString() };
}

export function mockFda(): FdaResponse {
  return { results: [], source: 'SIMULATED', sourceUrl: '', fetchedAt: new Date().toISOString(), note: '가상 모드에서는 openFDA를 조회하지 않습니다' };
}

// ---------- simulated feeds (SIM tickers only) ----------

function simQuote(symbol: string): Quote {
  const b = mockBars(symbol, '1D').bars;
  const last = b[b.length - 1];
  const prev = b[b.length - 2];
  return { symbol, price: last.close, prevClose: prev.close, changePct: last.close / prev.close - 1, open: last.open, dayHigh: last.high, dayLow: last.low, volume: last.volume, time: new Date(last.time * 1000).toISOString() };
}

const SIM_HEADLINES: Array<[string, string, number]> = [
  ['SIM01', 'Aurora Dynamics (가상) Wins $120 Million Defense Contract', 21],
  ['SIM04', 'Solara Bio (가상) Announces Proposed Public Offering of Common Stock and Warrants', 34],
  ['SIM02', 'Northstar AI (가상) Beats Estimates, Raises Full-Year Guidance on Strong AI Demand', 48],
  ['SIM04', 'Solara Bio (가상) Reports Positive Topline Phase 2 Trial Results', 95],
  ['SIM06', 'Analyst Upgrades Orbit Energy (가상) to Outperform, Raises Price Target', 130],
  ['SIM03', 'Vector Systems (가상) Receives Nasdaq Delisting Notice', 200],
];

export function mockNews(): NewsResponse {
  const now = Date.now();
  const items = SIM_HEADLINES.map(([sym, h, mins], i) => ({
    id: `sim-${i}`, time: new Date(now - mins * 60000).toISOString(), headline: h, summary: '가상 데이터 — 실제 뉴스가 아닙니다', url: '', source: 'SIMULATED', author: null, symbols: [sym], ...classifyHeadline(h),
  })) as NewsResponse['items'];
  return { items, quotes: Object.fromEntries(SIM_UNIVERSE.map((s) => [s.symbol, simQuote(s.symbol)])), source: 'SIMULATED', fetchedAt: new Date().toISOString(), note: '가상 뉴스' };
}

export function mockSecLatest(): SecLatestResponse {
  const items = mockFilings().map((f, i) => ({ ...f, company: SIM_UNIVERSE.find((s) => f.accession.includes(s.symbol))?.name ?? '', cik: String(i), ticker: f.accession.split('-')[1], url: null }));
  return { items, quotes: Object.fromEntries(SIM_UNIVERSE.map((s) => [s.symbol, simQuote(s.symbol)])), source: 'SIMULATED', fetchedAt: new Date().toISOString() };
}

export function mockMovers(minPrice: number): MoversResponse {
  const qs = SIM_UNIVERSE.map((s) => simQuote(s.symbol)).filter((q) => (q.price ?? 0) >= minPrice);
  const toMover = (q: Quote) => ({ symbol: q.symbol, price: q.price, changePct: q.changePct, change: q.price !== null && q.prevClose !== null ? q.price - q.prevClose : null, dayLow: q.dayLow, dayHigh: q.dayHigh, open: q.open, prevClose: q.prevClose, volume: q.volume });
  const sorted = [...qs].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  return { gainers: sorted.filter((q) => (q.changePct ?? 0) > 0).map(toMover), losers: sorted.filter((q) => (q.changePct ?? 0) < 0).reverse().map(toMover), lastUpdated: new Date().toISOString(), minPrice, source: 'SIMULATED', fetchedAt: new Date().toISOString() };
}
