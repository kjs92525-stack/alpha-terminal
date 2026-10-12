import type { Filing, FilingItem, Fundamentals, TickerHit, Importance } from './types';
export function padCik(cik: string | number): string;
export function filingUrl(cik: string | number, accession: string, primaryDocument?: string): string;
export const EIGHT_K_ITEMS: Record<string, { label: string; category: string; importance: Importance }>;
export function classifyFiling(form: string, items?: string): { label: string; category: string; importance: Importance; items: FilingItem[] };
export function parseFilings(submissions: unknown, opts?: { limit?: number; forms?: string[] }): Filing[];
export function dilutionSignals(filings: Filing[], asOf: string, days?: number): Filing[];
export function summarizeFacts(facts: unknown): Fundamentals;
export function searchTickers(tickersJson: unknown, query: string, limit?: number): TickerHit[];
