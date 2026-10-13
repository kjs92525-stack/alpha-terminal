import type { Bar } from './types';
export type Phase = 'EARLY' | 'BASING' | 'LEADING' | 'LATE' | 'NEUTRAL' | 'DOWN';
export const SECTOR_ETFS: Array<[string, string]>;
export const PHASE_KO: Record<Phase, string>;
export function cyclePhase(bars: Bar[], spy: Bar[]): { phase: Phase; phaseKo: string; earlyScore: number; metrics: Record<string, number | null> } | null;
export function returnCorrelation(a: Bar[], b: Bar[], days?: number): number | null;
export function bestGroup(bars: Bar[], etfBars: Record<string, Bar[]>, spy: Bar[], minCorr?: number): { etf: string; corr: number } | null;
