import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreConviction, topConviction } from '../apps/web/src/lib/conviction.ts';

const good = (o = {}) => ({
  type: 'breakout', symbol: 'G', name: 'G Co', sector: 'Information Technology', price: 10, mcap: 1e9, adv20: 5e6, stage: 'NEAR_PIVOT', provisional: false,
  plan: { entry: 10.2, stop: 9.5, target: 12.5, riskPct: 0.07, rMultiple: 3.3, entryType: 'buy-stop' },
  priceAsOf: '2026-10-14', ret1: 0.01, ret5: 0.02, ret21: 0.05, ret63: 0.1, earningsChecked: true, earnings: null,
  storySignals: { revenueAcceleration: true, profitTurnaround: false, lossNarrowing: false },
  narrative: { lines: [], takeaway: '', quality: { growthFresh: true, profitFresh: true, revenuePeriod: '2026-06-30', profitPeriod: '2026-06-30' } },
  revenueYoY: [{ end: '2026-03-31', yoy: 0.1 }, { end: '2026-06-30', yoy: 0.25 }], netIncomeQ: [{ end: '2025-06-30', value: -5e6 }, { end: '2026-06-30', value: -1e6 }],
  funding: { runwayMonths: 30, sharesYoY: 0.02 }, trend: { passed: 8, total: 8 }, rs: { newHigh: true },
  reasons: [], themes: [], news: [], chartScore: 70, storyScore: 50, score: 60, ...o,
});
const insider = { checkedAt: '2026-10-14', insider: { days: 90, buyers: 3, buyValue: 3e5, sellValue: 0, cluster: true, recent: [] }, dilution: { days: 180, count: 0, shelf: false, offering: false, recent: [] }, analyst: null, errors: [] };

test('evidence adds up to a tier; the market regime caps it', () => {
  const a = scoreConviction(good({ edge: insider }), '2026-10-14', 'early', 'SELECTIVE');
  assert.equal(a.tier, 'A');
  assert.ok(a.plus.some((p) => /내부자 3명/.test(p)));
  assert.equal(scoreConviction(good({ edge: insider }), '2026-10-14', 'early', 'LIMIT').tier, 'B');
  const w = scoreConviction(good({ edge: insider }), '2026-10-14', 'early', 'WAIT');
  assert.equal(w.tier, 'C');
  assert.match(w.capped, /대기/);
  const dil = scoreConviction(good({ edge: { ...insider, insider: null, dilution: { days: 180, count: 1, shelf: false, offering: true, recent: [] } } }), '2026-10-14', 'early', 'SELECTIVE');
  assert.ok(dil.minus.includes('최근 발행 공시(424B)'));
  assert.ok(dil.points < a.points);
});

test('only rule-passing names are listed; nothing passes → empty, never padded', () => {
  const data = { asOf: '2026-10-14', candidates: [good({ symbol: 'OK' }), good({ symbol: 'RUN', ret63: 0.9 }), good({ symbol: 'PB', type: 'pullback', stage: 'BOUNCE' })] };
  assert.deepEqual(topConviction(data, 'SELECTIVE').map((c) => c.row.symbol), ['OK']);
  assert.deepEqual(topConviction({ asOf: '2026-10-14', candidates: [good({ ret63: 0.9 })] }, 'SELECTIVE'), []);
});
