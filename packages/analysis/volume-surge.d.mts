export interface VolumeSurge { date: string; sessionsAgo: number; volMult: number; dollarVolume: number; priorDollarVolume: number; close: number; ret1: number; gap: number; closePos: number; ret63: number | null; fromHigh: number; fromLow: number; context: 'after_run' | 'new_high' | 'near_low' | 'downtrend' | 'mid_range'; after: number }
export interface SurgeExplanation { cause: string; causeKo: string; read: string; tone: string; contextKo: string; headlines: Array<{ date: string; headline: string; url: string | null; cause: string | null; roundup: boolean }>; filings: Array<{ date: string; form: string; label: string | null; url: string | null }>; newsChecked: boolean; confidence: 'none' | 'headline_only' | 'filing_and_headline' }
export const SURGE_RULES: { minMult: number; minDollarVolume: number; minPrice: number; minPriorDollarVolume: number; lookbackDays: number; recentSessions: number };
export function isRoundup(headline: string): boolean;
export const CAUSE_KO: Record<string, string>;
export function detectVolumeSurge(bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>, rules?: typeof SURGE_RULES): VolumeSurge | null;
export function classifyCause(headline: string): string | null;
export function explainSurge(args: { surge: VolumeSurge; news?: Array<{ time: string; headline: string; url?: string | null }> | null; filings?: Array<{ filingDate: string; form: string; label?: string; url?: string | null }>; asOf: string }): SurgeExplanation;
