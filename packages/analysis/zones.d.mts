import type { Bar } from './types';
export interface ZonePlan { entry: number; stop: number; stopKind: string; target: number; target2: number | null; zone: [number, number] | null; entryType: 'buy-stop' | 'limit' | 'zone' | 'market'; how: string; riskPct: number | null; rMultiple: number | null; note: string | null }
export interface Pullback { stage: 'BOUNCE' | 'AT_SUPPORT' | 'APPROACHING' | 'NONE'; reason?: string; high?: number; highAgeBars?: number; pullLow?: number; depth?: number; currentDepth?: number; support?: { kind: string; price: number }; confluence?: string[]; volumeDryUp?: boolean; rsi?: number | null; rsiCooled?: boolean; trend?: { passed: number; total: number }; plan?: ZonePlan; score?: number }
export interface HtfBottom { stage: 'TURNING' | 'AT_BOTTOM' | 'NONE'; reason?: string; timeframe?: 'weekly' | 'monthly'; high?: number; low?: number; decline?: number; lowAgeBars?: number; lowAgeLabel?: string; aboveLow?: number; higherLow?: boolean; aboveMa?: boolean; maRising?: boolean; volumeDryUp?: boolean; rsiRecover?: boolean; pivot?: number | null; plan?: ZonePlan; score?: number }
export const PULLBACK_RULES: Record<string, number>;
export const BOTTOM_RULES: Record<'weekly' | 'monthly', Record<string, number | string>>;
export function resampleMonthly(bars: Bar[]): Bar[];
export function mergeMonthly(longMonthly: Bar[] | null | undefined, daily: Bar[]): Bar[];
export function detectPullback(bars: Bar[], rules?: typeof PULLBACK_RULES): Pullback;
export function detectHtfBottom(htf: Bar[], tf?: 'weekly' | 'monthly'): HtfBottom;
