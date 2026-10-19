export interface TgPost { id: number; channel: string; url: string; date: string | null; text: string }
export interface TgItem { symbol: string; name: string | null; verdict: string; lines: string[]; checks: string[] }
export interface TgAnalysis extends TgPost { tickers: string[]; claims: string[]; items: TgItem[] }
export interface TgLookup { asOf: string; gate: { state: string; label: string } | null; symbols: string[]; setups: Record<string, any> }
export function parseChannelHtml(html: string, channel: string): TgPost[];
export function extractTickers(text: string, known: Set<string>): string[];
export function analyzePost(post: TgPost, ctx: { asOf: string; setups: Map<string, any>; known: Set<string>; facts: (s: string) => any }): TgAnalysis;
export function formatReport(a: TgAnalysis, gate: { state: string; label?: string } | null): string;
export function buildLookup(o: { asOf: string; candidates: any[]; symbols: string[]; gate: { state: string; label: string } | null }): TgLookup;
