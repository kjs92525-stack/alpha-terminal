import type { TvAlert, AnalyzeResponse, BarsResponse, DataMode, FdaResponse, FilingsResponse, Health, ScreenRow, Timeframe, TickerHit } from './types';
import { mockAnalyze, mockBars, mockFda, mockFilingsResponse, mockScreen } from './mock';

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  detail: string | null;
  constructor(status: number, message: string, detail: string | null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal, headers: { Accept: 'application/json' } });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new ApiError(res.status, 'API가 JSON을 반환하지 않았습니다 (API 미배포 가능성)', null);
  const body = await res.json();
  if (!res.ok) throw new ApiError(res.status, body?.error || `HTTP ${res.status}`, body?.detail ?? null);
  return body as T;
}

/** Decide live vs mock. Live requires the API to answer and SEC to be configured. */
export async function detectMode(): Promise<{ mode: DataMode; health: Health | null; reason: string }> {
  const forced = import.meta.env.VITE_DATA_MODE;
  if (forced === 'mock') return { mode: 'mock', health: null, reason: 'VITE_DATA_MODE=mock' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const health = await getJson<Health>('/api/v1/health', ctrl.signal);
    clearTimeout(timer);
    if (!health.ok) return { mode: 'mock', health, reason: 'API health check failed' };
    return { mode: 'live', health, reason: health.secConfigured ? 'API 연결됨' : 'API 연결됨 (SEC_USER_AGENT 미설정 — 공시/재무 비활성)' };
  } catch (e) {
    if (forced === 'live') throw e;
    return { mode: 'mock', health: null, reason: `API 미연결: ${(e as Error).message}` };
  }
}

export interface DataSource {
  mode: DataMode;
  bars(symbol: string, tf: Timeframe, signal?: AbortSignal): Promise<BarsResponse>;
  analyze(symbol: string, signal?: AbortSignal): Promise<AnalyzeResponse>;
  screen(symbols: string[], onProgress?: (done: number, total: number, rows: ScreenRow[]) => void): Promise<ScreenRow[]>;
  filings(symbol: string, signal?: AbortSignal): Promise<FilingsResponse>;
  fda(query: string, signal?: AbortSignal): Promise<FdaResponse>;
  search(query: string, signal?: AbortSignal): Promise<TickerHit[]>;
}

// Cloudflare free plan allows 50 subrequests per invocation; keep each screen call small.
const SCREEN_CHUNK = 4;

export const liveSource: DataSource = {
  mode: 'live',
  bars: (s, tf, signal) => getJson(`/api/v1/bars/${encodeURIComponent(s)}?tf=${tf}`, signal),
  analyze: (s, signal) => getJson(`/api/v1/analyze/${encodeURIComponent(s)}`, signal),
  async screen(symbols, onProgress) {
    const rows: ScreenRow[] = [];
    for (let i = 0; i < symbols.length; i += SCREEN_CHUNK) {
      const chunk = symbols.slice(i, i + SCREEN_CHUNK);
      try {
        const r = await getJson<{ results: ScreenRow[] }>(`/api/v1/screen?symbols=${chunk.map(encodeURIComponent).join(',')}`);
        rows.push(...r.results);
      } catch (e) {
        rows.push(...chunk.map((symbol) => ({ symbol, name: null, score: null, error: (e as Error).message })));
      }
      onProgress?.(Math.min(symbols.length, i + SCREEN_CHUNK), symbols.length, rankLocal(rows));
    }
    return rankLocal(rows);
  },
  filings: (s, signal) => getJson(`/api/v1/sec/filings/${encodeURIComponent(s)}?limit=60`, signal),
  fda: (q, signal) => getJson(`/api/v1/fda?q=${encodeURIComponent(q)}`, signal),
  search: async (q, signal) => (await getJson<{ results: TickerHit[] }>(`/api/v1/search?q=${encodeURIComponent(q)}`, signal)).results,
};

function rankLocal(rows: ScreenRow[]): ScreenRow[] {
  const ok = rows.filter((r) => typeof r.score === 'number').sort((a, b) => (b.score as number) - (a.score as number));
  const n = ok.length;
  ok.forEach((r, i) => { r.rank = i + 1; r.percentile = n > 1 ? Math.round(((n - 1 - i) / (n - 1)) * 100) : 100; });
  return [...ok, ...rows.filter((r) => typeof r.score !== 'number')];
}

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));

export const mockSource: DataSource = {
  mode: 'mock',
  bars: (s, tf) => delay(mockBars(s, tf)),
  analyze: (s) => delay(mockAnalyze(s)),
  async screen(symbols, onProgress) { const r = mockScreen(symbols); onProgress?.(symbols.length, symbols.length, r); return delay(r); },
  filings: (s) => delay(mockFilingsResponse(s)),
  fda: () => delay(mockFda()),
  search: async (q) => mockScreen(['SIM01', 'SIM02', 'SIM03', 'SIM04', 'SIM05', 'SIM06']).filter((r) => r.symbol.includes(q.toUpperCase()) || (r.name ?? '').toUpperCase().includes(q.toUpperCase())).map((r) => ({ ticker: r.symbol, name: r.name ?? '', cik: '' })),
};

export const API_BASE = BASE;

/** TradingView alerts stored by the webhook (needs the webhook key). */
export async function fetchTvAlerts(key: string, limit = 50): Promise<{ alerts: TvAlert[]; storage: boolean }> {
  const res = await fetch(`${BASE}/api/v1/tv/alerts?limit=${limit}`, { headers: { 'X-Alpha-Key': key, Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error || `HTTP ${res.status}`, null);
  return body;
}
