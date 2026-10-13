import type { Bar } from './types';
export function parseStooqCsv(text: string): Bar[];
export interface ChartMeta { symbol: string | null; currency: string | null; exchange: string | null; timezone: string | null; regularMarketTime: number | null; regularMarketPrice: number | null }
export function parseYahooChart(json: unknown, opts?: { daily?: boolean }): { bars: Bar[]; meta: ChartMeta | null };
export function isDailyBarClosed(barTimeSec: number, nowMs?: number): boolean;
