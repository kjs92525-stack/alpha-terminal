import type { Bar } from '../analysis/types';
export function alpacaDayToUtc(t: string): number;
export function parseAlpacaBars(json: unknown): Record<string, Bar[]>;
export function fetchDailyBars(opts: {
  symbols: string[]; start: string; end: string; keyId?: string; secretKey?: string; feed?: 'sip' | 'iex'; timeframe?: '1Day' | '1Week' | '1Month'; batchSize?: number;
  fetchImpl?: typeof fetch; minIntervalMs?: number; onBatch?: (done: number, total: number) => void; wait?: (ms: number) => Promise<void>;
}): Promise<{ bars: Record<string, Bar[]>; requests: number; feed: string }>;
export function mergeBars(cached: Bar[], fresh: Bar[], tol?: number): { bars: Bar[]; needsFull: boolean };
