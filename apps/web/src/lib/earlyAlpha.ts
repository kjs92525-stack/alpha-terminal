import { SNAPSHOT_BASE } from './snapshot';
export interface EarlyEvidence { kind: string; title: string; url: string | null; publishedAt: string; period?: string; value?: number; source: string; confidence: string }
export interface EarlyRow {
  reportPeriod?: string | null; revenueYoY?: Array<{end:string;yoy:number;value:number}>; symbol: string; ticker: string; name: string; sector: string; score: number; status: 'candidate' | 'watch' | 'excluded';
  price: number; marketCap: number; capMethod: string; ret63: number; drawdown: number; adv20: number;
  firstSeen: string | null; isNew: boolean; components: Record<string, number>; reasons: Array<{ factor: string; points: number; text: string }>;
  warnings: string[]; excluded: string[]; evidence: EarlyEvidence[]; fetchedAt: string | null; newsStatus: string; enrichmentStatus?: string;
  risk: { level: string; runwayMonths: number | null; sharesYoY: number | null; dilutionFilings: number; checked: boolean };
}
export interface EarlyOutcome { status: string; return: number | null; excess: number | null; mfe: number | null; mae: number | null; entryDate?: string; exitDate?: string }
export interface EarlyData {
  asOf: string; model: string; ledgerModel?: string; generatedAt: string; refreshedAt: string; method: string; caveat: string;
  stats: { scanned: number; eligible: number; candidates: number; newsRequests: number; newsFailures: number; newsBudget: number };
  enrichment?: { generatedAt: string; newsRequests: number; newsFailures: number };
  candidates: EarlyRow[];
  performance: { method: string; summary: Record<string, { total: number; complete: number; pending: number; missing: number; meanReturn: number | null; meanExcess: number | null; winRate: number | null }>;
    discoveries: Array<{ symbol: string; name: string; asOf: string; score: number; outcomes: Record<string, EarlyOutcome> }> };
}
export async function fetchEarlyAlpha(signal?: AbortSignal): Promise<EarlyData> {
  const read = async (file: string) => {
    const r = await fetch(`${SNAPSHOT_BASE}/early-alpha/${file}`, { cache: 'no-cache', signal });
    if (r.status === 404) throw new Error('EARLY ALPHA 야간 데이터가 아직 없습니다. PR 병합 후 야간 배치가 실행되면 표시됩니다.');
    if (!r.ok) throw new Error(`EARLY ALPHA HTTP ${r.status}`);
    return r.json();
  };
  const status = await read('status.json');
  if (!status.ok) throw new Error(`EARLY ALPHA 배치 실패 (${status.asOf}). 이전 결과를 최신으로 표시하지 않습니다.`);
  const data: EarlyData = await read('latest.json');
  if (data.asOf !== status.asOf) throw new Error('스냅샷 발행 중입니다. 잠시 후 새로고침하세요.');
  return data;
}
