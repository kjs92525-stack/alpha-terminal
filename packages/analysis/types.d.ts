export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }
export type Num = number | null;

export interface Swing { type: 'high' | 'low'; index: number; time: number; price: number; confirmedIndex: number }
export interface StructureEvent {
  kind: 'BOS' | 'CHoCH'; direction: 'bull' | 'bear'; index: number; time: number; level: number;
  swingIndex: number; confirmedIndex: number; provisional: boolean;
}
export interface FVG {
  direction: 'bull' | 'bear'; top: number; bottom: number; index: number; startTime: number; time: number;
  confirmedIndex: number; filledIndex: number | null; provisional: boolean;
}
export interface OrderBlock {
  direction: 'bull' | 'bear'; index: number; time: number; top: number; bottom: number;
  confirmedIndex: number; provisional: boolean; source: 'BOS' | 'CHoCH'; mitigatedIndex: number | null;
}
export interface ProfileBin { low: number; high: number; volume: number }
export interface VolumeProfile { bins: ProfileBin[]; poc: Num; valueAreaLow: Num; valueAreaHigh: Num }
export interface Level { price: number; touches: number; lastIndex: number; kind: 'support' | 'resistance'; strength: number }
export interface Regime { regime: 'uptrend' | 'downtrend' | 'range' | 'insufficient'; sma50: Num; sma200: Num; slopeUp?: boolean | null }
export interface Analysis {
  sma20: Num[]; ema20: Num[]; sma50: Num[]; sma200: Num[]; rsi14: Num[];
  macd: { macd: Num[]; signal: Num[]; hist: Num[] };
  atr14: Num[]; vwap: Num[]; obv: number[];
  structure: { events: StructureEvent[]; trend: 'up' | 'down' | 'neutral'; swings: Swing[] };
  fvg: FVG[]; orderBlocks: OrderBlock[]; levels: Level[]; profile: VolumeProfile; regime: Regime;
}

export interface FilingItem { item: string; label: string; category: string; importance: Importance }
export type Importance = 'low' | 'medium' | 'high' | 'critical';
export interface Filing {
  accession: string; form: string; filingDate: string | null; acceptedAt: string | null; reportDate: string | null;
  items: string; description: string; url: string; label: string; category: string; importance: Importance;
  itemDetails: FilingItem[];
}
export interface FactPoint { end: string; value: number; filed: string; form: string; fy?: number }
export interface Fundamentals {
  entityName: string | null; revenue: FactPoint | null; revenuePrior: FactPoint | null; revenueGrowth: Num;
  revenueQuarterly: FactPoint[]; netIncome: FactPoint | null; netMargin: Num; operatingCashFlow: FactPoint | null;
  cash: FactPoint | null; shortTermInvestments: FactPoint | null; liquidAssets: Num; runwayMonths: Num;
  sharesOutstanding: FactPoint | null; sharesYoY: Num; stockholdersEquity: FactPoint | null; longTermDebt: FactPoint | null;
}
export interface TickerHit { ticker: string; name: string; cik: string }

export interface Metrics {
  asOf: string; bars: number; price: Num; ret1m: Num; ret3m: Num; ret6m: Num; ret12m1: Num; high52: Num; low52: Num;
  distHigh52: Num; sma50: Num; sma200: Num; rsi14: Num; atrPct: Num; vol20: Num; vol60: Num; maxDD1y: Num;
  adv20Usd: Num; relVolume: Num; marketCap: Num; priceToSales: Num; priceToEarnings: Num; revenueGrowth: Num;
  netMargin: Num; operatingCashFlow: Num; runwayMonths: Num; sharesYoY: Num; dilutionFilings365d: number; hasFundamentals: boolean;
}
export interface Factors { momentum: Num; trend: Num; quality: Num; valuation: Num; liquidity: Num; stability: Num; risk: Num }
export interface Evidence { sign: '+' | '-'; factor: string; text: string }
export interface Scenario { range: [number, number]; trigger: string }
export interface Scenarios {
  horizon: string; method: string; sigmaPct: number; bull: Scenario; base: Scenario; bear: Scenario;
  nearestResistance: Num; nearestSupport: Num;
}
export interface StockScore {
  score: Num; coverage: number; rating: string; riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';
  size: 'mega' | 'large' | 'mid' | 'small' | 'micro' | 'unknown'; style: 'growth' | 'value' | 'blend';
  factors: Factors; metrics: Metrics; evidence: Evidence[]; scenarios: Scenarios | null; model: string;
  rank?: number; percentile?: number;
}
