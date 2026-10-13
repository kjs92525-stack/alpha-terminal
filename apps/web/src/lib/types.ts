export type {
  Bar, Num, Analysis, StructureEvent, FVG, OrderBlock, Level, Filing, Fundamentals, FactPoint,
  StockScore, Metrics, Factors, Evidence, Scenarios, TickerHit, Importance,
} from '../../../../packages/analysis/types';
import type { Bar, Filing, Fundamentals, StockScore, Importance } from '../../../../packages/analysis/types';

export type DataMode = 'live' | 'mock';
export type Timeframe = '5m' | '1H' | '1D' | '1W';

export interface SourceRef { name: string; url: string; fetchedAt: string; note?: string }

export interface BarsResponse {
  symbol: string; timeframe: Timeframe; bars: Bar[]; source: string; sourceUrl: string;
  fetchedAt: string; lastBarClosed: boolean; delayNote: string;
}

export interface AnalyzeResponse {
  symbol: string; name: string | null; cik: string | null; sic: string | null;
  score: StockScore; fundamentals: Fundamentals | null; filings: Filing[]; lastClose: Bar | null;
  sources: { prices: SourceRef; filings: SourceRef | null; fundamentals: SourceRef | null };
  warnings: string[]; generatedAt: string;
}

export interface ScreenRow extends Partial<StockScore> {
  symbol: string; name: string | null; cik?: string | null; sic?: string | null; lastClose?: Bar | null;
  score: number | null; error: string | null; rank?: number; percentile?: number;
}

export interface FilingsResponse {
  cik: string; name: string | null; tickers: string[]; sicDescription: string | null;
  filings: Filing[]; source: string; sourceUrl: string; fetchedAt: string;
}

export interface FdaRow {
  application: string; sponsor: string; brand: string | null; generic: string | null; type: string;
  number: string; status: string; statusDate: string | null; classDescription: string | null;
}
export interface FdaResponse { results: FdaRow[]; source: string; sourceUrl: string; fetchedAt: string; note?: string }

export interface Health {
  ok: boolean; version: string; time: string; secConfigured: boolean; priceProviders: string[];
  tradingview?: { webhook: boolean; storage: boolean; telegram: boolean };
}

export interface TvAlert {
  id: string; receivedAt: string; symbol: string; exchange: string | null; interval: string | null; signal: string | null;
  price: number | null; level: number | null; barTime: string | null; message: string | null; source: string | null;
  enrichment: {
    name: string | null; score: number | null; rating: string; riskLevel: string;
    flags: Array<{ level: 'warn' | 'info'; text: string; url?: string }>;
    nearestSupport: number | null; nearestResistance: number | null; computedAt: string;
  } | null;
  enrichmentError?: string | null;
  telegram?: 'sent' | 'failed' | 'disabled';
}

export interface Quote { symbol: string; price: number | null; prevClose: number | null; changePct: number | null; open: number | null; dayHigh: number | null; dayLow: number | null; volume: number | null; time: string | null }
export interface NewsItem {
  id: string; time: string; headline: string; summary: string; url: string; source: string; author: string | null; symbols: string[];
  tags: string[]; sentiment: 'positive' | 'negative' | 'neutral'; sentimentScore: number; importance: number; matched: { positive: string[]; negative: string[] };
}
export interface NewsResponse { items: NewsItem[]; quotes: Record<string, Quote>; source: string; quoteSource?: string; fetchedAt: string; note?: string }
export interface LatestFiling {
  accession: string | null; form: string; company: string; cik: string; ticker: string | null; acceptedAt: string | null; filingDate: string | null;
  items: string; url: string | null; label: string; category: string; importance: Importance;
}
export interface SecLatestResponse { items: LatestFiling[]; quotes: Record<string, Quote>; errors?: string[]; source: string; fetchedAt: string }
export interface Mover { symbol: string; price: number | null; changePct: number | null; change: number | null; dayLow: number | null; dayHigh: number | null; open: number | null; prevClose: number | null; volume: number | null }
export interface MoversResponse { gainers: Mover[]; losers: Mover[]; lastUpdated: string | null; minPrice: number; source: string; fetchedAt: string }
