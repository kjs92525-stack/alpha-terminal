// Position sizing and book-level limits for the paper ledger: each trade risks the same dollar amount
// (1R = account × risk %), no sector may hold more than 25% of the account, and the open risk of all
// positions plus live orders stays under 6R (6% of the account at 1% per trade).
import type { PaperTrade } from './snapshot';

export const LIMITS = { sectorPct: 0.25, maxOpenR: 6, riskPctMin: 0.5, riskPctMax: 1 } as const;

export const sharesFor = (riskUsd: number, entry: number, stop: number) => (riskUsd > 0 && entry > stop ? Math.floor(riskUsd / (entry - stop)) : 0);

type T = Pick<PaperTrade, 'symbol' | 'entry' | 'stop' | 'result'> & { sector?: string | null };

/** Book after every open position and live order, plus a verdict for each order taken in list order. */
export function portfolioRisk(trades: T[], acct: number, riskUsd: number) {
  const bySector = new Map<string, number>();
  let openR = 0, pendingR = 0;
  const add = (sector: string | null | undefined, usd: number) => { const k = sector || '미분류'; bySector.set(k, (bySector.get(k) ?? 0) + usd); };
  for (const t of trades.filter((x) => x.result.status === 'open')) {
    const n = sharesFor(riskUsd, t.entry, t.stop), part = t.result.half ? 0.5 : 1, fill = t.result.fill ?? t.entry;
    const curStop = t.result.stop ?? t.stop, r0 = fill - t.stop;
    openR += r0 > 0 ? Math.max(0, (fill - curStop) / r0) * part : 0;
    add(t.sector, n * part * (t.result.lastClose ?? fill));
  }
  const orders: Record<string, string[]> = {};
  for (const t of trades.filter((x) => x.result.status === 'pending')) {
    const n = sharesFor(riskUsd, t.entry, t.stop), usd = n * t.entry, k = t.sector || '미분류';
    const why: string[] = [];
    const after = ((bySector.get(k) ?? 0) + usd) / (acct || Infinity);
    if (acct > 0 && after > LIMITS.sectorPct) why.push(`${k} 비중 ${(after * 100).toFixed(0)}% > 25%`);
    if (openR + pendingR + 1 > LIMITS.maxOpenR) why.push(`총위험 ${(openR + pendingR + 1).toFixed(1)}R > ${LIMITS.maxOpenR}R`);
    orders[t.symbol] = why;
    if (!why.length) { pendingR += 1; add(t.sector, usd); }
  }
  const sectors = [...bySector].map(([sector, usd]) => ({ sector, pct: acct > 0 ? usd / acct : 0 })).sort((a, b) => b.pct - a.pct);
  return { openR, pendingR, sectors, orders };
}
