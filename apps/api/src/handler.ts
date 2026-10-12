// ALPHA TERMINAL API — shared request handler.
// Runs as a standalone Cloudflare Worker (apps/api/src/index.ts) and as
// Cloudflare Pages Functions (functions/api/[[path]].ts). No paid APIs.
//
// Data sources (all free, no API key):
//   - SEC EDGAR (official): submissions, XBRL company facts, ticker map
//   - openFDA (official): drug approval submissions by sponsor
//   - Stooq (EOD daily CSV) and Yahoo Finance chart endpoint (unofficial,
//     delayed) for OHLCV. Providers are tried in the order of PRICE_PROVIDERS.

import { parseFilings, summarizeFacts, searchTickers, padCik } from '../../../packages/analysis/sec.mjs';
import { parseStooqCsv, parseYahooChart, isDailyBarClosed } from '../../../packages/analysis/market.mjs';
import { resampleWeekly } from '../../../packages/analysis/indicators.mjs';
import { scoreStock, rankUniverse } from '../../../packages/analysis/scoring.mjs';
import type { Bar, Filing, Fundamentals } from '../../../packages/analysis/types';

export interface Env {
  SEC_USER_AGENT?: string;
  ALLOWED_ORIGIN?: string;
  PRICE_PROVIDERS?: string;
  SCREEN_MAX?: string;
}

const VERSION = '0.3.0';
const SEC_TTL = 600;
const FACTS_TTL = 6 * 3600;
const TICKERS_TTL = 24 * 3600;
const BARS_TTL_DAILY = 900;
const BARS_TTL_INTRADAY = 60;

class HttpError extends Error {
  status: number;
  detail?: string;
  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

type Timeframe = '5m' | '1H' | '1D' | '1W';
const TIMEFRAMES: Timeframe[] = ['5m', '1H', '1D', '1W'];

// ---------- helpers ----------

function corsHeaders(env: Env, req: Request): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
  const origin = req.headers.get('Origin') || '';
  const allow = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}, maxAge = 0): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store', ...extra },
  });
}

function edgeCache(): Cache | null {
  try { return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default ?? null; } catch { return null; }
}

/** Fetch with Cloudflare edge cache. Only successful responses are cached. */
async function cachedFetch(url: string, init: RequestInit, ttl: number): Promise<Response> {
  const cache = edgeCache();
  const key = new Request(url, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const res = await fetch(url, init);
  if (!res.ok) return res;
  const body = await res.arrayBuffer();
  const stored = new Response(body, { status: 200, headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': `public, max-age=${ttl}`, 'X-Fetched-At': new Date().toISOString() } });
  if (cache) await cache.put(key, stored.clone());
  return stored;
}

function secHeaders(env: Env): HeadersInit {
  const ua = env.SEC_USER_AGENT?.trim();
  if (!ua) throw new HttpError(503, 'SEC_USER_AGENT is not configured', 'Set a truthful "AppName contact@email" User-Agent as a secret (SEC fair-access policy).');
  return { 'User-Agent': ua, Accept: 'application/json' };
}

async function secJson<T>(env: Env, url: string, ttl: number): Promise<{ data: T; fetchedAt: string }> {
  const res = await cachedFetch(url, { headers: secHeaders(env) }, ttl);
  if (res.status === 404) throw new HttpError(404, 'Not found at SEC', url);
  if (!res.ok) throw new HttpError(502, `SEC responded ${res.status}`, url);
  return { data: (await res.json()) as T, fetchedAt: res.headers.get('X-Fetched-At') || new Date().toISOString() };
}

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
function normSymbol(raw: string): string {
  const s = decodeURIComponent(raw).trim().toUpperCase();
  if (!SYMBOL_RE.test(s)) throw new HttpError(400, 'Invalid ticker symbol');
  return s;
}

function normCik(raw: string): string {
  const digits = decodeURIComponent(raw).replace(/\D/g, '');
  if (!digits || digits.length > 10) throw new HttpError(400, 'Invalid CIK');
  return padCik(digits);
}

// ---------- SEC ----------

type TickerMap = Record<string, { cik_str: number; ticker: string; title: string }>;
let tickerMemo: { at: number; data: TickerMap } | null = null;

async function tickerMap(env: Env): Promise<TickerMap> {
  if (tickerMemo && Date.now() - tickerMemo.at < TICKERS_TTL * 1000) return tickerMemo.data;
  const { data } = await secJson<TickerMap>(env, 'https://www.sec.gov/files/company_tickers.json', TICKERS_TTL);
  tickerMemo = { at: Date.now(), data };
  return data;
}

async function resolveTicker(env: Env, symbol: string): Promise<{ ticker: string; name: string; cik: string } | null> {
  const map = await tickerMap(env);
  const want = symbol.replace('.', '-');
  for (const t of Object.values(map)) {
    if (t.ticker.toUpperCase() === symbol || t.ticker.toUpperCase() === want) return { ticker: t.ticker, name: t.title, cik: padCik(t.cik_str) };
  }
  return null;
}

async function getFilings(env: Env, cik: string, limit = 40, forms?: string[]) {
  const { data, fetchedAt } = await secJson<{ name?: string; tickers?: string[]; sicDescription?: string; cik: string }>(env, `https://data.sec.gov/submissions/CIK${cik}.json`, SEC_TTL);
  return {
    cik,
    name: data.name ?? null,
    tickers: data.tickers ?? [],
    sicDescription: data.sicDescription ?? null,
    filings: parseFilings(data, { limit, forms }) as Filing[],
    source: 'SEC EDGAR submissions API',
    sourceUrl: `https://data.sec.gov/submissions/CIK${cik}.json`,
    fetchedAt,
  };
}

async function getFacts(env: Env, cik: string): Promise<{ fundamentals: Fundamentals; fetchedAt: string } | null> {
  try {
    const { data, fetchedAt } = await secJson<unknown>(env, `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, FACTS_TTL);
    return { fundamentals: summarizeFacts(data) as Fundamentals, fetchedAt };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null; // some issuers have no XBRL facts
    throw e;
  }
}

// ---------- prices ----------

interface BarsResult { symbol: string; timeframe: Timeframe; bars: Bar[]; source: string; sourceUrl: string; fetchedAt: string; lastBarClosed: boolean; delayNote: string }

async function stooqDaily(symbol: string): Promise<{ bars: Bar[]; url: string; fetchedAt: string }> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase().replace('.', '-'))}.us&i=d`;
  const res = await cachedFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (AlphaTerminal)' } }, BARS_TTL_DAILY);
  if (!res.ok) throw new HttpError(502, `Stooq responded ${res.status}`);
  const bars = parseStooqCsv(await res.text()) as Bar[];
  if (!bars.length) throw new HttpError(404, 'Stooq returned no data for symbol');
  return { bars, url, fetchedAt: res.headers.get('X-Fetched-At') || new Date().toISOString() };
}

async function yahooChart(symbol: string, interval: string, range: string, daily: boolean, ttl: number) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.replace('.', '-'))}?interval=${interval}&range=${range}&includePrePost=false`;
  const res = await cachedFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (AlphaTerminal)', Accept: 'application/json' } }, ttl);
  if (!res.ok) throw new HttpError(502, `Yahoo chart responded ${res.status}`);
  const { bars } = parseYahooChart(await res.json(), { daily });
  if (!bars.length) throw new HttpError(404, 'Yahoo returned no data for symbol');
  return { bars: bars as Bar[], url, fetchedAt: res.headers.get('X-Fetched-At') || new Date().toISOString() };
}

function providers(env: Env): string[] {
  return (env.PRICE_PROVIDERS || 'stooq,yahoo').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function getBars(env: Env, symbol: string, tf: Timeframe): Promise<BarsResult> {
  const list = providers(env);
  const errors: string[] = [];
  if (tf === '5m' || tf === '1H') {
    if (!list.includes('yahoo')) throw new HttpError(501, 'Intraday bars need the yahoo provider (PRICE_PROVIDERS)');
    const [interval, range, sec] = tf === '5m' ? ['5m', '5d', 300] : ['60m', '3mo', 3600];
    const r = await yahooChart(symbol, interval, range, false, BARS_TTL_INTRADAY);
    const lastT = r.bars[r.bars.length - 1].time;
    return { symbol, timeframe: tf, bars: r.bars, source: 'Yahoo Finance chart (비공식)', sourceUrl: r.url, fetchedAt: r.fetchedAt, lastBarClosed: Date.now() / 1000 >= lastT + Number(sec), delayNote: '지연 시세 가능 (보통 15분 이상), 비공식 엔드포인트' };
  }
  for (const p of list) {
    try {
      let r: { bars: Bar[]; url: string; fetchedAt: string };
      let source: string;
      if (p === 'stooq') { r = await stooqDaily(symbol); source = 'Stooq EOD'; }
      else if (p === 'yahoo') { r = await yahooChart(symbol, '1d', tf === '1W' ? '10y' : '5y', true, BARS_TTL_DAILY); source = 'Yahoo Finance chart (비공식)'; }
      else continue;
      let bars = r.bars;
      let lastBarClosed = isDailyBarClosed(bars[bars.length - 1].time);
      if (tf === '1W') {
        bars = resampleWeekly(bars) as Bar[];
        const lastWeekEnd = bars[bars.length - 1].time + 5 * 86400;
        lastBarClosed = lastBarClosed && Date.now() / 1000 >= lastWeekEnd;
        bars = bars.slice(-520);
      } else {
        bars = bars.slice(-1260);
      }
      return { symbol, timeframe: tf, bars, source, sourceUrl: r.url, fetchedAt: r.fetchedAt, lastBarClosed, delayNote: '일봉 종가 기준 (장중 미반영 가능)' };
    } catch (e) {
      errors.push(`${p}: ${(e as Error).message}`);
    }
  }
  throw new HttpError(502, 'All price providers failed', errors.join(' | '));
}

// ---------- analysis ----------

async function analyze(env: Env, symbol: string) {
  const ref = await resolveTicker(env, symbol);
  const [barsRes, filingsRes, factsRes] = await Promise.allSettled([
    getBars(env, symbol, '1D'),
    ref ? getFilings(env, ref.cik, 60) : Promise.resolve(null),
    ref ? getFacts(env, ref.cik) : Promise.resolve(null),
  ]);
  if (barsRes.status === 'rejected') throw barsRes.reason;
  const bars = barsRes.value;
  const filings = filingsRes.status === 'fulfilled' && filingsRes.value ? filingsRes.value : null;
  const facts = factsRes.status === 'fulfilled' && factsRes.value ? factsRes.value : null;
  const closedBars = bars.lastBarClosed ? bars.bars : bars.bars.slice(0, -1);
  const score = scoreStock(closedBars, facts?.fundamentals ?? null, filings?.filings ?? []);
  return {
    symbol,
    name: ref?.name ?? filings?.name ?? null,
    cik: ref?.cik ?? null,
    sic: filings?.sicDescription ?? null,
    score,
    fundamentals: facts?.fundamentals ?? null,
    filings: filings?.filings.slice(0, 25) ?? [],
    lastClose: closedBars.length ? closedBars[closedBars.length - 1] : null,
    sources: {
      prices: { name: bars.source, url: bars.sourceUrl, fetchedAt: bars.fetchedAt, note: '점수는 마감된 일봉만 사용' },
      filings: filings ? { name: filings.source, url: filings.sourceUrl, fetchedAt: filings.fetchedAt } : null,
      fundamentals: facts ? { name: 'SEC XBRL companyfacts', url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${ref?.cik}.json`, fetchedAt: facts.fetchedAt } : null,
    },
    warnings: [
      ...(ref ? [] : ['SEC 티커 매핑 없음 — 재무·공시 데이터 제외']),
      ...(filingsRes.status === 'rejected' ? [`공시 조회 실패: ${(filingsRes.reason as Error).message}`] : []),
      ...(factsRes.status === 'rejected' ? [`재무 조회 실패: ${(factsRes.reason as Error).message}`] : []),
    ],
    generatedAt: new Date().toISOString(),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function screen(env: Env, symbols: string[]) {
  const max = Number(env.SCREEN_MAX || 25);
  const list = [...new Set(symbols.map(normSymbol))].slice(0, max);
  const results = await mapLimit(list, 4, async (s) => {
    try {
      const a = await analyze(env, s);
      return { symbol: s, name: a.name, cik: a.cik, sic: a.sic, lastClose: a.lastClose, ...a.score, error: null as string | null };
    } catch (e) {
      return { symbol: s, name: null, score: null, error: (e as Error).message } as { symbol: string; score: null; error: string };
    }
  });
  return { results: rankUniverse(results as { score: number | null }[]), universe: list, generatedAt: new Date().toISOString(), model: 'ALPHA-QUANT v0.3 (rule-based)' };
}

// ---------- FDA ----------

async function fda(query: string) {
  const q = query.trim();
  if (q.length < 2 || q.length > 80 || /["\\]/.test(q)) throw new HttpError(400, 'Invalid sponsor/drug query');
  const term = encodeURIComponent(`"${q.toUpperCase()}"`);
  const url = `https://api.fda.gov/drug/drugsfda.json?search=sponsor_name:${term}+openfda.brand_name:${term}&limit=20`;
  const res = await cachedFetch(url, {}, 3600);
  if (res.status === 404) return { results: [], source: 'openFDA drugsfda', sourceUrl: url, fetchedAt: new Date().toISOString() };
  if (!res.ok) throw new HttpError(502, `openFDA responded ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ application_number: string; sponsor_name: string; openfda?: { brand_name?: string[]; generic_name?: string[] }; submissions?: Array<{ submission_type: string; submission_number: string; submission_status: string; submission_status_date: string; submission_class_code_description?: string }> }> };
  const rows = (data.results ?? []).flatMap((r) => (r.submissions ?? []).map((s) => ({
    application: r.application_number,
    sponsor: r.sponsor_name,
    brand: r.openfda?.brand_name?.[0] ?? null,
    generic: r.openfda?.generic_name?.[0] ?? null,
    type: s.submission_type,
    number: s.submission_number,
    status: s.submission_status,
    statusDate: s.submission_status_date ? `${s.submission_status_date.slice(0, 4)}-${s.submission_status_date.slice(4, 6)}-${s.submission_status_date.slice(6, 8)}` : null,
    classDescription: s.submission_class_code_description ?? null,
  })));
  rows.sort((a, b) => String(b.statusDate).localeCompare(String(a.statusDate)));
  return { results: rows.slice(0, 40), source: 'openFDA drugsfda', sourceUrl: url, fetchedAt: res.headers.get('X-Fetched-At') || new Date().toISOString(), note: '임상시험 결과·PDUFA 일정은 포함되지 않음' };
}

// ---------- router ----------

export async function handle(req: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(env, req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = (re: RegExp) => path.match(re);
  try {
    let r: RegExpMatchArray | null;
    if (path === '/health' || path === '/api/v1/health') {
      return json({ ok: true, version: VERSION, time: new Date().toISOString(), secConfigured: Boolean(env.SEC_USER_AGENT?.trim()), priceProviders: providers(env) }, 200, cors);
    }
    if (path === '/api/v1/search') {
      const q = url.searchParams.get('q') || '';
      return json({ results: searchTickers(await tickerMap(env), q, 12), source: 'SEC company_tickers.json' }, 200, cors, 3600);
    }
    if ((r = m(/^\/api\/v1\/sec\/filings\/([^/]+)$/))) {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 40)));
      const forms = url.searchParams.get('forms')?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const id = decodeURIComponent(r[1]);
      let cik: string;
      if (/^\d+$/.test(id)) cik = normCik(id);
      else { const t = await resolveTicker(env, normSymbol(id)); if (!t) throw new HttpError(404, 'Ticker not found in SEC map'); cik = t.cik; }
      return json(await getFilings(env, cik, limit, forms), 200, cors, 120);
    }
    if ((r = m(/^\/api\/v1\/sec\/submissions\/([^/]+)$/))) {
      const { data, fetchedAt } = await secJson<unknown>(env, `https://data.sec.gov/submissions/CIK${normCik(r[1])}.json`, SEC_TTL);
      return json({ data, fetchedAt }, 200, cors, 120);
    }
    if ((r = m(/^\/api\/v1\/sec\/facts\/([^/]+)$/))) {
      const f = await getFacts(env, normCik(r[1]));
      if (!f) throw new HttpError(404, 'No XBRL company facts for this CIK');
      return json({ ...f, source: 'SEC XBRL companyfacts' }, 200, cors, 600);
    }
    if ((r = m(/^\/api\/v1\/bars\/([^/]+)$/))) {
      const tf = (url.searchParams.get('tf') || '1D') as Timeframe;
      if (!TIMEFRAMES.includes(tf)) throw new HttpError(400, `tf must be one of ${TIMEFRAMES.join(', ')}`);
      return json(await getBars(env, normSymbol(r[1]), tf), 200, cors, tf === '1D' || tf === '1W' ? 300 : 30);
    }
    if ((r = m(/^\/api\/v1\/analyze\/([^/]+)$/))) {
      return json(await analyze(env, normSymbol(r[1])), 200, cors, 300);
    }
    if (path === '/api/v1/screen') {
      const symbols = (url.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!symbols.length) throw new HttpError(400, 'symbols query parameter required');
      return json(await screen(env, symbols), 200, cors, 300);
    }
    if (path === '/api/v1/fda') {
      return json(await fda(url.searchParams.get('q') || ''), 200, cors, 900);
    }
    return json({ error: 'Not found' }, 404, cors);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, detail: e.detail ?? null }, e.status, cors);
    return json({ error: 'Internal error', detail: (e as Error).message }, 500, cors);
  }
}
