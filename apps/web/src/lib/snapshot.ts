// Nightly pipeline outputs, published to the public `data` branch by .github/workflows/nightly.yml.
// Read directly from GitHub (CORS-enabled CDN), so it works with or without the Cloudflare API.

export const SNAPSHOT_BASE = (import.meta.env.VITE_SNAPSHOT_BASE_URL || 'https://raw.githubusercontent.com/kjs92525-stack/alpha-terminal/data').replace(/\/+$/, '');
export const DATA_HISTORY_URL = 'https://github.com/kjs92525-stack/alpha-terminal/commits/data/ledger';

export type Horizon = 'mid' | 'short';

export interface RankRow {
  rank: number; percentile: number; symbol: string; name: string | null; sector: string; score: number; coverage: number;
  factors: Record<string, number | null>; price: number; mcap: number | null; adv20: number | null;
  f: Record<string, number | null | string[]>; excluded: string[];
}

export interface Latest {
  asOf: string; model: string; generatedAt: string; universe: number; ranked: { mid: number; short: number };
  sources: Record<string, string>; weights: Record<Horizon, Record<string, number>>;
  filters: Record<Horizon, { minPrice: number; minAdv: number; count: number; sectorCap: number }>;
  recommendations: Record<Horizon, string[]>; mid: RankRow[]; short: RankRow[];
}

export interface PerfDetail { asOf: string; key: string; status: 'pending' | 'partial' | 'complete'; n?: number; pending?: number; portfolioReturn?: number; spyReturn?: number; excess?: number; hitRate?: number; model?: string }
export interface PerfSummary { cohorts: number; meanExcess: number | null; medianExcess: number | null; cohortsBeatingSpy: number; meanHitRate: number | null; note: string | null }
export interface Performance { summary: Record<string, PerfSummary>; detail: PerfDetail[]; evaluatedAt: string; ledgers: number; benchmark: string }

export class NoSnapshotError extends Error {}

async function get<T>(file: string): Promise<T> {
  const res = await fetch(`${SNAPSHOT_BASE}/${file}`, { cache: 'no-cache' });
  if (res.status === 404) throw new NoSnapshotError('아직 야간 배치가 실행되지 않았습니다');
  if (!res.ok) throw new Error(`스냅샷 HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchLatest = () => get<Latest>('latest.json');
export const fetchPerformance = () => get<Performance>('performance.json');

export const FACTOR_KO: Record<string, string> = {
  momentum: '모멘텀', quality: '재무품질', value: '밸류', lowrisk: '저위험', trend: '추세', pullback: '눌림', flow: '수급', breakout: '돌파',
};
export const SECTOR_KO: Record<string, string> = {
  'Information Technology': 'IT', 'Health Care': '헬스케어', Financials: '금융', 'Consumer Discretionary': '경기소비재', 'Consumer Staples': '필수소비재',
  Industrials: '산업재', Energy: '에너지', Materials: '소재', Utilities: '유틸리티', 'Real Estate': '부동산', 'Communication Services': '커뮤니케이션',
  'Blank Check': 'SPAC', Other: '기타', Unknown: '미분류',
};
