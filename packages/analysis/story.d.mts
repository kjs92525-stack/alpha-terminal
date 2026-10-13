import type { Fundamentals, Filing } from './types';
export interface StoryReason { kind: 'plus' | 'minus'; text: string; pts: number }
export interface NewsLike { time: string; headline: string; sentiment?: string }
export function quarterlyYoY(series: Array<{ end: string; value: number }>): Array<{ end: string; yoy: number; value: number }>;
export const THEMES: Array<[string, RegExp]>;
export function storySignals(input: { fundamentals: Fundamentals | null; filings?: Filing[]; news?: NewsLike[]; asOf: string }): {
  storyScore: number; reasons: StoryReason[]; themes: string[]; revenueYoY: Array<{ end: string; yoy: number }>; newsCount: { week: number; weeklyAvg: number }; narrative: Narrative;
};
export interface Narrative { lines: string[]; takeaway: string; method: string }
