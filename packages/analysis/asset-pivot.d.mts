export interface PivotHeadline { date: string; headline: string; url: string | null; amount: number | null; ratio: number | null }
export interface AssetPivot { pivot: boolean; newsChecked: boolean; contracts: PivotHeadline[]; material: number; financing: PivotHeadline[]; acquisition: PivotHeadline | null; capex: { ttm: number; prior: number | null; growth: number | null; toRevenue: number | null; end: string | null } | null; investmentPhase: boolean; fundedMonths: number | null; selfFunded: boolean | null }
export function headlineAmount(headline: string): number | null;
export function classifyPivotHeadline(headline: string): 'acquisition' | 'financing' | 'demand' | null;
export function assetPivotSignals(args: { news?: Array<{ time: string; headline: string; url?: string | null }> | null; facts?: unknown; mcap?: number | null; asOf: string; windowDays?: number }): AssetPivot;
