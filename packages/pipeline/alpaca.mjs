// Alpaca Market Data v2 — multi-symbol daily bars.
// Free (Basic) plan: historical SIP data except the most recent 15 minutes, 200 requests/minute.
// Docs: https://docs.alpaca.markets/docs/about-market-data-api

import { fetchRetry, throttle } from './http.mjs';

const BASE = 'https://data.alpaca.markets/v2/stocks/bars';

/** Alpaca daily bar timestamps are midnight America/New_York; normalise to 00:00 UTC of that date. */
export function alpacaDayToUtc(t) {
  const d = new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return Date.parse(`${d}T00:00:00Z`) / 1000;
}

export function parseAlpacaBars(json) {
  const out = {};
  for (const [sym, arr] of Object.entries(json?.bars ?? {})) {
    out[sym] = (arr || [])
      .map((b) => ({ time: alpacaDayToUtc(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }))
      .filter((b) => [b.open, b.high, b.low, b.close].every(Number.isFinite));
  }
  return out;
}

/**
 * Fetch adjusted daily bars for many symbols, following next_page_token.
 * Returns { bars: {SYMBOL: Bar[]}, requests, feed }.
 */
export async function fetchDailyBars({ symbols, start, end, keyId, secretKey, feed = 'sip', timeframe = '1Day', batchSize = 100, fetchImpl = fetch, minIntervalMs = 320, onBatch, wait } = {}) {
  if (!keyId || !secretKey) throw new Error('Alpaca API keys missing (ALPACA_KEY_ID / ALPACA_SECRET_KEY)');
  const gate = throttle(minIntervalMs);
  const headers = { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secretKey, Accept: 'application/json' };
  const result = {};
  let requests = 0;
  let activeFeed = feed;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    let token = null;
    for (;;) {
      const qs = new URLSearchParams({ symbols: batch.join(','), timeframe, start, end, limit: '10000', adjustment: 'all', feed: activeFeed, sort: 'asc' });
      if (token) qs.set('page_token', token);
      await gate();
      const res = await fetchRetry(`${BASE}?${qs}`, { headers }, { fetchImpl, wait });
      requests++;
      if (res.status === 403 && activeFeed === 'sip') {
        // Subscription does not permit SIP for this window -> retry this batch on IEX (lower volume coverage).
        activeFeed = 'iex';
        token = null;
        continue;
      }
      if (!res.ok) throw new Error(`Alpaca bars HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      for (const [sym, bars] of Object.entries(parseAlpacaBars(json))) (result[sym] ??= []).push(...bars);
      token = json.next_page_token || null;
      if (!token) break;
    }
    onBatch?.(Math.min(symbols.length, i + batchSize), symbols.length);
  }
  for (const s of Object.keys(result)) {
    const m = new Map(result[s].map((b) => [b.time, b]));
    result[s] = [...m.values()].sort((a, b) => a.time - b.time);
  }
  return { bars: result, requests, feed: activeFeed };
}

/**
 * Merge freshly fetched bars into a cached series. Adjusted prices change after splits/dividends,
 * so if overlapping closes disagree by more than `tol`, the cache is stale and needs a full refetch.
 */
export function mergeBars(cached, fresh, tol = 0.005) {
  if (!cached?.length) return { bars: fresh, needsFull: false };
  if (!fresh.length) return { bars: cached, needsFull: false };
  const byTime = new Map(cached.map((b) => [b.time, b]));
  for (const f of fresh) {
    const c = byTime.get(f.time);
    if (c && Math.abs(c.close / f.close - 1) > tol) return { bars: cached, needsFull: true };
  }
  for (const f of fresh) byTime.set(f.time, f);
  return { bars: [...byTime.values()].sort((a, b) => a.time - b.time), needsFull: false };
}

/** Recent news for one symbol (Alpaca News API, Benzinga source). */
export async function fetchNews({ symbol, start, keyId, secretKey, fetchImpl = fetch, wait, limit = 50 }) {
  const qs = new URLSearchParams({ symbols: symbol, start, limit: String(limit), sort: 'desc', include_content: 'false' });
  const res = await fetchRetry(`https://data.alpaca.markets/v1beta1/news?${qs}`, { headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secretKey, Accept: 'application/json' } }, { fetchImpl, wait, retries: 1, baseDelayMs: 500 });
  if (!res.ok) throw new Error(`Alpaca news HTTP ${res.status}`);
  const json = await res.json();
  return (json.news ?? []).map((n) => ({ id: String(n.id), time: n.created_at, headline: n.headline ?? '', url: n.url ?? null, source: n.source ?? null }));
}
