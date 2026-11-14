import { useCallback, useEffect, useState } from 'react';
import { themeMembership, type MarketSnapshot, type MarketStock } from '../../../../packages/analysis/market-map.mjs';
import { fetchMarketSnapshot, fetchSetups, NoSnapshotError, type SetupRow, type Setups } from './snapshot';

export type ResearchSnapshot = MarketSnapshot & { fallback?: boolean };
export function uniqueSetups(data: Setups | null) {
  const best = new Map<string, SetupRow>();
  for (const r of data?.candidates ?? []) if (!best.has(r.symbol)) best.set(r.symbol, r);
  return best;
}
export function stockFromSetup(r: SetupRow): MarketStock {
  return { symbol: r.symbol, name: r.name || r.symbol, sector: r.sector, exchange: null, price: r.price, priceAsOf: r.priceAsOf || '',
    mcap: r.mcap, ret1: r.ret1 ?? null, ret5: r.ret5 ?? null, ret21: r.ret21 ?? null, ret63: r.ret63 ?? null, adv20: r.adv20,
    revenueGrowth: null, themes: themeMembership(r.symbol) };
}
async function loadMarket(force: boolean): Promise<ResearchSnapshot> {
  try {
    const d = await fetchMarketSnapshot(force);
    if (d.model !== 'market-map-v1' || !Array.isArray(d.stocks) || !d.coverage) throw Error('시장 데이터 형식을 확인할 수 없습니다.');
    return d;
  } catch (e) {
    if (!(e instanceof NoSnapshotError)) throw e;
    const d = await fetchSetups(force), stocks = [...uniqueSetups(d).values()].map(stockFromSetup);
    return { model: 'scanner-fallback', asOf: d.asOf, generatedAt: d.generatedAt, universe: d.stats.scanned,
      source: '야간 스캐너 후보 · 전체 시장 아님', classification: { reviewedAt: '2026-11-14', method: '사업 연결 편집 분류' },
      coverage: { priced: stocks.length, withCap: stocks.filter(s => s.mcap != null && s.mcap > 0).length, staleExcluded: 0 }, stocks, fallback: true };
  }
}
export function useResearchData() {
  const [market, setMarket] = useState<ResearchSnapshot | null>(null);
  const [setups, setSetups] = useState<Setups | null>(null);
  const [error, setError] = useState(''), [setupError, setSetupError] = useState(''), [loading, setLoading] = useState(true);
  const refresh = useCallback(async (force = true) => {
    setLoading(true); setError(''); setSetupError('');
    await Promise.allSettled([
      loadMarket(force).then(setMarket).catch(e => { setMarket(null); setError(e.message); }),
      fetchSetups(force).then(setSetups).catch(e => { setSetups(null); setSetupError(e.message); }),
    ]);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(false); }, [refresh]);
  return { market, setups, error, setupError, loading, refresh };
}

export function financialFlags(row?: SetupRow) {
  if (!row) return { positive: [], risks: ['스캐너 재무·공시 교차 검토 대기'] };
  const positive = [];
  if (row.storySignals?.revenueAcceleration && !row.narrative?.quality?.growthBlocked) positive.push('매출 성장 가속');
  if (row.storySignals?.profitTurnaround && !row.narrative?.quality?.profitBlocked) positive.push('흑자 전환');
  if (row.storySignals?.lossNarrowing && !row.narrative?.quality?.profitBlocked) positive.push('적자 축소');
  const risks = [];
  if (row.edge?.dilution?.offering) risks.push('최근 발행 공시');
  else if (row.edge?.dilution?.shelf) risks.push('증자 등록 공시');
  if (!row.edge?.dilution) risks.push('증자 공시 확인 대기');
  if (row.funding?.runwayMonths != null && row.funding.runwayMonths < 12) risks.push(`현금 런웨이 ${Math.round(row.funding.runwayMonths)}개월`);
  if (row.funding?.sharesYoY != null && row.funding.sharesYoY > .1) risks.push(`주식 수 YoY +${Math.round(row.funding.sharesYoY * 100)}%`);
  if (row.earnings && row.earnings.sessions <= 5) risks.push(`실적 발표 ${row.earnings.date}`);
  if (!row.earningsChecked) risks.push('실적 일정 미확인');
  return { positive, risks };
}
