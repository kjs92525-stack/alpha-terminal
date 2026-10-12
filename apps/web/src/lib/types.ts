export type {
  Bar, Num, Analysis, StructureEvent, FVG, OrderBlock, Level, Filing, Fundamentals, FactPoint,
  StockScore, Metrics, Factors, Evidence, Scenarios, TickerHit, Importance,
} from '../../../../packages/analysis/types';
import type { Bar, Filing, Fundamentals, StockScore } from '../../../../packages/analysis/types';

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

export interface Health { ok: boolean; version: string; time: string; secConfigured: boolean; priceProviders: string[] }
