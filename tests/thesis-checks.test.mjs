import test from 'node:test';
import assert from 'node:assert/strict';
import { thesisChecks } from '../packages/analysis/thesis-checks.mjs';

const base = {
  stage: 'NEAR_PIVOT', provisional: false, price: 10,
  plan: { stop: 9, riskPct: 0.1, rMultiple: 2 },
  revenueYoY: [{ end: '2026-03-31', yoy: 0.12 }, { end: '2026-06-30', yoy: 0.2 }],
  netIncomeQ: [{ end: '2025-06-30', value: -5e6 }, { end: '2026-03-31', value: -3e6 }, { end: '2026-06-30', value: -2e6 }],
  funding: { runwayMonths: 30, sharesYoY: 0.03 },
  narrative: { quality: {} },
};

test('all promote conditions met and nothing broken → review', () => {
  const t = thesisChecks(base, '2026-10-14');
  assert.equal(t.state, 'review');
  assert.ok(t.promote.every((p) => p.met === true));
  assert.ok(t.drop.every((d) => d.met === false));
  assert.equal(t.nextDue, '2026-11-13');
  assert.ok(t.promote[1].observed.includes('-$2.0M (1년 전 -$5.0M)'), t.promote[1].observed);
});

test('any drop condition decides: close under the stop, widening loss, dilution, short runway, slowing sales', () => {
  assert.equal(thesisChecks({ ...base, price: 8.5 }, '2026-10-14').state, 'drop');
  assert.equal(thesisChecks({ ...base, netIncomeQ: [{ end: '2025-06-30', value: -2e6 }, { end: '2026-06-30', value: -4e6 }] }, '2026-10-14').state, 'drop');
  assert.equal(thesisChecks({ ...base, funding: { runwayMonths: 30, sharesYoY: 0.4 } }, '2026-10-14').state, 'drop');
  assert.equal(thesisChecks({ ...base, funding: { runwayMonths: 6, sharesYoY: 0 } }, '2026-10-14').state, 'drop');
  assert.equal(thesisChecks({ ...base, revenueYoY: [{ end: '2026-03-31', yoy: 0.3 }, { end: '2026-06-30', yoy: 0.12 }] }, '2026-10-14').state, 'drop');
});

test('unknown is never counted as met or as safe; stale or blocked numbers do not promote', () => {
  const t = thesisChecks({ ...base, funding: {}, netIncomeQ: [] }, '2026-10-14');
  assert.equal(t.state, 'watch');
  assert.equal(t.promote[1].met, null);
  assert.equal(t.drop.find((d) => /희석/.test(d.label)).met, null);
  assert.ok(t.unknown >= 3);
  assert.equal(thesisChecks(base, '2027-03-01').promote[0].met, null, 'report older than 200 days');
  assert.equal(thesisChecks({ ...base, narrative: { quality: { growthBlocked: true } } }, '2026-10-14').promote[0].met, null);
  assert.equal(thesisChecks({ ...base, provisional: true }, '2026-10-14').state, 'watch', 'forming weekly/monthly bar is not a confirmed turn');
  assert.equal(thesisChecks({ ...base, revenueYoY: [...base.revenueYoY, { end: '2026-12-31', yoy: 0.5 }] }, '2026-10-14').promote[0].observed.includes('2026-06-30'), true, 'future periods ignored');
});
