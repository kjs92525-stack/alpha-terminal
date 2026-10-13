// Market feeds for the dashboard: news, latest SEC filings, top movers, quote snapshots.
// Alpaca endpoints need ALPACA_KEY_ID / ALPACA_SECRET_KEY (free Basic plan).
// Free-plan real-time quotes come from the IEX exchange only — labelled in responses.

import { classifyHeadline } from '../../../packages/analysis/news.mjs';
import { currentFeedUrl, parseCurrentAtom, padCik } from '../../../packages/analysis/sec.mjs';

export interface FeedEnv {
  ALPACA_KEY_ID?: string;
  ALPACA_SECRET_KEY?: string;
  SEC_USER_AGENT?: string;
}

export class FeedError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const DATA = 'https://data.alpaca.markets';

export function hasAlpaca(env: FeedEnv) {
  return Boolean(env.ALPACA_KEY_ID && env.ALPACA_SECRET_KEY);
}

async function alpaca<T>(env: FeedEnv, path: string): Promise<T> {
  if (!hasAlpaca(env)) throw new FeedError(503, 'ALPACA_KEY_ID / ALPACA_SECRET_KEY not configured');
  const res = await fetch(`${DATA}${path}`, { headers: { 'APCA-API-KEY-ID': env.ALPACA_KEY_ID!, 'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY!, Accept: 'application/json' } });
  if (!res.ok) throw new FeedError(502, `Alpaca ${path.split('?')[0]} HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Quote { symbol: string; price: number | null; prevClose: number | null; changePct: number | null; open: number | null; dayHigh: number | null; dayLow: number | null; volume: number | null; time: string | null }

interface RawBar { o: number; h: number; l: number; c: number; v: number; t: string }
interface RawSnap { latestTrade?: { p: number; t: string }; dailyBar?: RawBar; prevDailyBar?: RawBar }

export function parseSnapshots(json: unknown): Record<string, Quote> {
  const root = (json && typeof json === 'object' && 'snapshots' in (json as object) ? (json as { snapshots: unknown }).snapshots : json) as Record<string, RawSnap | null>;
  const out: Record<string, Quote> = {};
  for (const [symbol, s] of Object.entries(root ?? {})) {
    if (!s) continue;
    const price = s.latestTrade?.p ?? s.dailyBar?.c ?? null;
    const prevClose = s.prevDailyBar?.c ?? null;
    out[symbol] = {
      symbol, price, prevClose, changePct: price !== null && prevClose ? price / prevClose - 1 : null,
      open: s.dailyBar?.o ?? null, dayHigh: s.dailyBar?.h ?? null, dayLow: s.dailyBar?.l ?? null, volume: s.dailyBar?.v ?? null,
      time: s.latestTrade?.t ?? s.dailyBar?.t ?? null,
    };
  }
  return out;
}

export async function snapshots(env: FeedEnv, symbols: string[]): Promise<Record<string, Quote>> {
  const list = [...new Set(symbols.filter((s) => /^[A-Z][A-Z0-9.]{0,9}$/.test(s)))].slice(0, 100);
  if (!list.length || !hasAlpaca(env)) return {};
  try {
    return parseSnapshots(await alpaca(env, `/v2/stocks/snapshots?symbols=${list.join(',')}&feed=iex`));
  } catch {
    return {}; // quotes are decoration; never fail the feed because of them
  }
}

export interface NewsItem {
  id: string; time: string; headline: string; summary: string; url: string; source: string; author: string | null; symbols: string[];
  tags: string[]; sentiment: string; sentimentScore: number; importance: number; matched: { positive: string[]; negative: string[] };
}

export async function news(env: FeedEnv, symbols: string[], limit: number) {
  const qs = new URLSearchParams({ limit: String(Math.min(50, Math.max(1, limit))), sort: 'desc', include_content: 'false' });
  if (symbols.length) qs.set('symbols', symbols.slice(0, 50).join(','));
  const json = await alpaca<{ news: Array<{ id: number; headline: string; summary: string; url: string; source: string; author: string; created_at: string; symbols: string[] }> }>(env, `/v1beta1/news?${qs}`);
  const items: NewsItem[] = (json.news ?? []).map((n) => {
    const c = classifyHeadline(n.headline, n.summary);
    return { id: String(n.id), time: n.created_at, headline: n.headline, summary: n.summary ?? '', url: n.url, source: n.source, author: n.author || null, symbols: n.symbols ?? [], ...c };
  });
  const quotes = await snapshots(env, items.flatMap((i) => i.symbols.slice(0, 3)));
  return { items, quotes, source: 'Alpaca News API (Benzinga)', quoteSource: 'Alpaca snapshots (IEX feed)', fetchedAt: new Date().toISOString(), note: '태그·감정은 키워드 규칙 기반 (문맥 이해 아님)' };
}

export interface Mover { symbol: string; price: number | null; changePct: number | null; change: number | null; dayLow: number | null; dayHigh: number | null; open: number | null; prevClose: number | null; volume: number | null }

export async function movers(env: FeedEnv, top: number, minPrice: number) {
  const json = await alpaca<{ gainers: Array<{ symbol: string; percent_change: number; change: number; price: number }>; losers: Array<{ symbol: string; percent_change: number; change: number; price: number }>; last_updated: string }>(env, `/v1beta1/screener/stocks/movers?top=50`);
  const pick = (arr: typeof json.gainers) => (arr ?? []).filter((m) => m.price >= minPrice).slice(0, top);
  const g = pick(json.gainers);
  const l = pick(json.losers);
  const quotes = await snapshots(env, [...g, ...l].map((m) => m.symbol));
  const merge = (m: (typeof g)[number]): Mover => {
    const q = quotes[m.symbol];
    // Use the snapshot's price with its own day range so the marker and the range come from one source.
    const price = q?.price ?? m.price;
    const changePct = q?.price != null && q.prevClose ? q.price / q.prevClose - 1 : m.percent_change / 100;
    return { symbol: m.symbol, price, changePct, change: m.change, dayLow: q?.dayLow ?? null, dayHigh: q?.dayHigh ?? null, open: q?.open ?? null, prevClose: q?.prevClose ?? null, volume: q?.volume ?? null };
  };
  return { gainers: g.map(merge), losers: l.map(merge), lastUpdated: json.last_updated ?? null, minPrice, source: 'Alpaca screener movers + snapshots (IEX)', fetchedAt: new Date().toISOString() };
}

const TYPES = ['8-K', '424B', 'S-3', 'S-1', 'SC 13D', '10-Q', '10-K'];

export async function secLatest(env: FeedEnv, tickerOf: (cik: string) => string | null, limit: number) {
  if (!env.SEC_USER_AGENT?.trim()) throw new FeedError(503, 'SEC_USER_AGENT is not configured');
  const results = await Promise.allSettled(TYPES.map(async (t) => {
    const res = await fetch(currentFeedUrl(t, 40), { headers: { 'User-Agent': env.SEC_USER_AGENT!, Accept: 'application/atom+xml' } });
    if (!res.ok) throw new Error(`${t} HTTP ${res.status}`);
    return parseCurrentAtom(await res.text());
  }));
  const seen = new Set<string>();
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((f) => { const k = f.accession ?? `${f.cik}-${f.form}-${f.acceptedAt}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((f) => ({ ...f, ticker: tickerOf(padCik(f.cik)) }))
    .sort((a, b) => String(b.acceptedAt).localeCompare(String(a.acceptedAt)))
    .slice(0, Math.min(100, limit));
  const quotes = await snapshots(env, items.map((i) => i.ticker).filter((t): t is string => Boolean(t)).map((t) => t.replace('-', '.')));
  const errors = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason?.message ?? r));
  return { items, quotes, errors, source: 'SEC EDGAR current filings (Atom)', fetchedAt: new Date().toISOString() };
}
