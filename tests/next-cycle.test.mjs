import test from 'node:test';
import assert from 'node:assert/strict';
import { sectorBreadth, rankNextCycle, macroNote, SECTOR_MAP } from '../packages/analysis/next-cycle.mjs';

// quarterly revenue filed 40 days after quarter end; `yoys` are year-over-year growth for the last quarters
const facts = (yoys) => {
  const q = [], ends = ['2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'];
  const base = [100, 100, 100, 100];
  ends.forEach((end, i) => {
    const value = i < 4 ? base[i] : 100 * (1 + yoys[i - 4]);
    const filed = new Date(Date.parse(end) + 40 * 86400000).toISOString().slice(0, 10);
    q.push({ end, value, filed });
  });
  return { revenueQuarterly: q, netIncomeQuarterly: [] };
};
const many = (sector, n, yoys) => Array.from({ length: n }, () => ({ sector, facts: facts(yoys) }));

test('breadth is point in time: a quarter filed after the comparison date counts only now', () => {
  // accelerating in the quarter ended 2026-06-30 (filed 2026-08-09), flat before
  const e = [...many('Energy', 10, [0.02, 0.03, 0.15]), ...many('Energy', 10, [0.05, 0.05, 0.05])];
  const b = sectorBreadth(e, '2026-10-15').Energy;
  assert.equal(b.n, 20);
  assert.equal(b.share, 0.5);
  assert.equal(b.prevShare, 0); // on 2026-07-16 the June quarter was not yet filed
  assert.equal(b.delta, 0.5);
});

test('a sector counts only if its business improves faster than the others, and not if its ETF already ran', () => {
  const g = (etf, phase, m) => ({ etf, name: etf, phase, phaseKo: phase, metrics: { rs24m: -0.1, rs12m: 0, rs3m: 0.02, ma50Slope: 0.01, ddFromHigh: 0.2, ...m } });
  const groups = Object.values(SECTOR_MAP).map((c) => g(c.etf, 'NEUTRAL', {}));
  const breadth = Object.fromEntries(Object.keys(SECTOR_MAP).map((s) => [s, { n: 50, accel: 10, share: 0.2, prevShare: 0.15, delta: 0.05, medYoY: 0.05, prevMedYoY: 0.05 }]));
  breadth.Materials = { n: 50, accel: 20, share: 0.4, prevShare: 0.2, delta: 0.2, medYoY: 0.1, prevMedYoY: 0.05 };
  breadth.Energy = { ...breadth.Materials };
  groups.find((x) => x.etf === 'XLE').phase = 'LEADING';
  groups.find((x) => x.etf === 'XLE').metrics.rs12m = 0.3;
  const r = rankNextCycle({ groups, breadth, macro: { period: '2026-09', headlineMonthly: 0.6, headlineAnnual: 3.7, coreMonthly: 0.3, coreAnnual: 2.6 }, gate: 'WAIT', stocksBySector: { Materials: [{ symbol: 'MAT' }] } });
  const mat = r.find((x) => x.etf === 'XLB'), en = r.find((x) => x.etf === 'XLE'), tech = r.find((x) => x.etf === 'XLK');
  assert.equal(r[0].etf, 'XLB');
  assert.equal(mat.status, 'candidate');
  assert.ok(mat.why.some((w) => /다른 업종보다 빠르게 개선/.test(w)));
  assert.deepEqual(mat.stocks, [{ symbol: 'MAT' }]);
  assert.match(mat.macro, /신규 진입 대기/);
  assert.equal(en.status, 'priced', 'a sector already leading for a year is the running cycle, not the next one');
  assert.notEqual(tech.status, 'candidate', 'an earnings season that lifts every sector equally is not a sector signal');
});

test('macro note reads the CPI print and the market gate', () => {
  const hot = { period: '2026-09', headlineMonthly: 0.6, headlineAnnual: 3.7, coreMonthly: 0.3, coreAnnual: 2.6 };
  assert.match(macroNote('rates', hot, null), /역풍/);
  assert.match(macroNote('rates', { ...hot, headlineMonthly: 0.1, coreMonthly: 0.1 }, null), /수혜/);
  assert.match(macroNote('inflation', hot, 'LIMIT'), /제한적 진입/);
});
