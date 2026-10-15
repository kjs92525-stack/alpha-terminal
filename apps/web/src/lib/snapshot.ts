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

export type SetupType = 'breakout' | 'base' | 'pullback' | 'weekly_bottom' | 'monthly_bottom';
export type SetupStage = 'BREAKOUT' | 'POST_BREAKOUT' | 'NEAR_PIVOT' | 'EXTENDED' | 'IN_BASE' | 'FAILED' | 'NONE' | 'BOUNCE' | 'AT_SUPPORT' | 'APPROACHING' | 'TURNING' | 'AT_BOTTOM';
export interface SetupReason { kind: 'plus' | 'minus'; text: string; pts: number }
export interface SetupPlan {
  entry: number; stop: number; stopKind: string; target: number; target2?: number | null; zone?: [number, number] | null;
  entryType?: 'buy-stop' | 'limit' | 'zone' | 'market' | null; how?: string | null; riskPct: number | null; rMultiple: number | null; note: string | null;
}
export interface SetupRow {
  priceAsOf?:string;ret1?:number|null;ret5?:number|null;ret63?:number|null;ret21?:number|null;provisional?:boolean;netIncomeQ?:Array<{end:string;value:number}>;earnings?:{date:string;hour:string;sessions:number}|null;edge?:import('../../../../packages/analysis/edge-signals.d.mts').EdgeSignals|null;earningsChecked?:boolean;assetPivot?:import('../../../../packages/analysis/asset-pivot.d.mts').AssetPivot;htfBasis?:'closed'|'closed_confirmed'|'forming';htfNote?:string|null;storySignals?:{revenueAcceleration:boolean;profitTurnaround:boolean;lossNarrowing:boolean};funding?:{runwayMonths:number|null;sharesYoY:number|null;source:string};
  type?: SetupType; symbol: string; name: string | null; sector: string; price: number; mcap: number | null; adv20: number | null; stage: SetupStage;
  // breakout
  pivot?: number | null; distanceToPivot?: number | null; extension?: number | null; barsSinceBreakout?: number | null; posInBase?: number | null; breakoutVolMult?: number | null;
  base?: { months: number; depth: number; high: number; low: number; higherLows: boolean; contraction: boolean; volumeDryUp: boolean } | null;
  rs?: { newHigh: boolean; rs3m: number | null; rs12m: number | null };
  // pullback
  high?: number; highAgeBars?: number; pullLow?: number; depth?: number; currentDepth?: number; support?: { kind: string; price: number };
  confluence?: string[]; rsi?: number | null; rsiCooled?: boolean;
  // weekly / monthly bottom
  low?: number; decline?: number; lowAgeBars?: number; lowAgeLabel?: string; aboveLow?: number; higherLow?: boolean; aboveMa?: boolean; maRising?: boolean; rsiRecover?: boolean; bars?: number;
  volumeDryUp?: boolean; trend?: { passed: number; total: number };
  plan: SetupPlan | null;
  chartScore: number; storyScore: number; score: number;
  reasons: SetupReason[]; themes: string[]; revenueYoY: Array<{ end: string; yoy: number }>;
  narrative?: { lines: string[]; takeaway: string; method: string;quality?:{profitBlocked:boolean;growthBlocked:boolean;growthFresh?:boolean;profitFresh?:boolean;revenuePeriod?:string|null;profitPeriod?:string|null} };
  news: Array<{ time: string; headline: string; url?: string; sentiment?: string; tags?: string[] }>;
  newsChecked: boolean;
}
export interface Setups {
  asOf: string; generatedAt: string; model: string; weights: { chart: number; story: number }; method: string | Record<string, string>; caveat: string;
  stats: { scanned: number; candidates: number; newsRequests: number; byStage: Record<string, number>; byType?: Record<SetupType, Record<string, number>> };
  candidates: SetupRow[];
}
export interface BtSummary { n: number; winRate?: number; stoppedRate?: number; avgReturn?: number; medianReturn?: number; avgR?: number; avgExcessVsSpy?: number; bigWinners?: number; p10?: number; p90?: number }
export interface Backtest {
  generatedAt: string; method: string; limits: string[]; trades: number; symbols: number;
  report: Record<string, Record<string, BtSummary>>;
  caseStudies: Record<string, Array<{ date: string; entry: number; stop: number; baseMonths: number; results: Record<string, { ret: number; r: number; stopped: boolean; spy: number | null } | null> }>>;
  caseNearMisses?: Record<string, Array<{ date: string; close: number; volMult: number; why: string[] }>>;
}
export const fetchSetups = () => get<Setups>('setups.json');
export const fetchBacktest = () => get<Backtest>('backtest/breakouts.json');
export interface EdgeEvents { generatedAt: string; method: string; limits: string[]; symbols: number; errors: number; events: number; firstEventDate: string | null; report: Record<string, Record<string, BtSummary>> }
export const fetchEdgeEvents = () => get<EdgeEvents>('backtest/edge-events.json');

export type CyclePhase = 'EARLY' | 'BASING' | 'LEADING' | 'LATE' | 'NEUTRAL' | 'DOWN';
export interface SectorGroup {
  model?:string;warnings?:string[]; etf: string; name: string; price: number; phase: CyclePhase; phaseKo: string; earlyScore: number;
  metrics: { vs200: number | null; ma50vs200: number | null; ma50Slope: number | null; ddFromHigh: number | null; offLow: number | null; ret3m: number | null; ret12m: number | null; ret24m?: number | null; rs3m: number | null; rs12m: number | null; rs24m?: number | null; rsiW: number | null };
  members: Array<{ symbol: string; name: string | null; price: number; type: string; stage: string; score: number; corr: number; how: string | null; takeaway: string | null }>;
}
export interface Sectors { asOf: string; generatedAt: string; method: string; caveat: string; groups: SectorGroup[] }
export const fetchSectors = () => get<Sectors>('sectors.json');
export type SurgeRow = { symbol: string; name: string | null; sector: string; mcap: number | null; adv20: number | null } & import('../../../../packages/analysis/volume-surge.d.mts').VolumeSurge & import('../../../../packages/analysis/volume-surge.d.mts').SurgeExplanation;
export interface VolumeSurges { asOf: string; generatedAt: string; method: string; caveat: string; stats: { detected: number; shown: number; newsRequests: number }; items: SurgeRow[] }
export const fetchVolumeSurges = () => get<VolumeSurges>('volume-surges.json');
type PaperResult = import('../../../../packages/analysis/paper-trade.d.mts').PaperResult;
export interface PaperTrade { id: string; symbol: string; name: string | null; mode: 'early' | 'pivot'; type: string; stage: string; signalDate: string; entry: number; stop: number; target: number; entryType: string; result: PaperResult }
export interface PaperLedger { asOf: string; generatedAt: string; method: string; caveat: string; summary: ReturnType<typeof import('../../../../packages/analysis/paper-trade.mjs').summarizePaper>; actions: Array<{ symbol: string; kind: string; text: string }>; trades: PaperTrade[] }
export const fetchPaper = () => get<PaperLedger>('paper/latest.json');
