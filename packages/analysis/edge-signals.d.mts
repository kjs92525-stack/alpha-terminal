export interface InsiderSignal { days: number; buyers: number; buyValue: number; sellValue: number; cluster: boolean; recent: Array<{ name: string; date: string; shares: number; value: number }>; holderBuys: { names: string[]; value: number } | null }
export interface DilutionSignal { days: number; count: number; shelf: boolean; offering: boolean; likelyDebt: boolean; recent: Array<{ form: string; date: string; url: string | null }> }
export interface AnalystTrend { period: string; analysts: number; bullShare: number; change3m: number | null; direction: 'up' | 'down' | 'flat' | 'unknown' }
export interface EdgeSignals { checkedAt: string; insider: InsiderSignal | null; dilution: DilutionSignal | null; analyst: AnalystTrend | null; errors: string[] }
export function insiderSignal(rows: unknown, asOf: string, days?: number): InsiderSignal | null;
export function dilutionSignal(filings: unknown, asOf: string, days?: number, mcap?: number | null): DilutionSignal | null;
export function analystTrend(rows: unknown): AnalystTrend | null;
