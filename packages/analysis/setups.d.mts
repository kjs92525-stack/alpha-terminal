import type { Bar } from './types';
export interface Base { window: number; start: number; end: number; high: number; low: number; depth: number; highAgeBars: number; lowAgeBars: number; higherLows: boolean; contraction: boolean; volumeDryUp: boolean; quality: number; priorPeak?: number | null }
export type Stage = 'BREAKOUT' | 'POST_BREAKOUT' | 'EXTENDED' | 'FAILED' | 'NEAR_PIVOT' | 'IN_BASE' | 'NONE';
export interface Setup { stage: Stage; base?: Base; pivot?: number; breakoutIndex?: number; barsSinceBreakout?: number; breakoutVolMult?: number; extension?: number; distanceToPivot?: number; reason?: string }
export interface TrendTemplate { passed: number; total: number; checks: Record<string, boolean>; ok: boolean }
export interface RelStrength { rsNewHigh: boolean; rs3m: number | null; rs12m: number | null }
export interface TradePlan { entry: number; stop: number; stopKind: string; target: number; riskPct: number; rMultiple: number | null; orderBlock: { top: number; bottom: number } | null; note: string | null; how: string; entryType: 'buy-stop' | 'limit' }
export const SETUP_RULES: { baseWindows: number[]; maxDepth: number; minDepth: number; breakoutVolMult: number; lookbackBreakout: number; maxExtension: number; nearPivot: number; minBelowPeak: number; peakLookbackDays: number };
export function priorPeak(bars: Bar[], startIdx: number, monthly?: Bar[] | null, lookbackDays?: number): number | null;
export function trendTemplate(bars: Bar[]): TrendTemplate;
export function relativeStrength(bars: Bar[], bench: Bar[]): RelStrength;
export function findBase(bars: Bar[], endIdx: number, rules?: typeof SETUP_RULES, monthly?: Bar[] | null): Base | null;
export function detectSetup(bars: Bar[], rules?: typeof SETUP_RULES, monthly?: Bar[] | null): Setup;
export function tradePlan(bars: Bar[], setup: Setup): TradePlan | null;
export function evaluateChart(bars: Bar[], bench?: Bar[], monthly?: Bar[] | null): { setup: Setup; trend: TrendTemplate; rs: RelStrength; plan: TradePlan | null; chartScore: number };
