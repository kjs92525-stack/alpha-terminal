import test from 'node:test';
import assert from 'node:assert/strict';
import { storyAsOf } from '../packages/analysis/story-pit.mjs';
import { runBreakoutBacktest } from '../packages/pipeline/backtest.mjs';

const q = (end, value, filed) => ({ end, value, filed });
const facts = {
  revenueQuarterly: [q('2024-03-31', 100, '2024-05-10'), q('2024-06-30', 100, '2024-08-10'), q('2025-03-31', 110, '2025-05-10'), q('2025-06-30', 130, '2025-08-10')],
  netIncomeQuarterly: [q('2024-06-30', -20, '2024-08-10'), q('2025-06-30', -8, '2025-08-10')],
};

test('only quarters filed by the trade date count (no look-ahead)', () => {
  const after = storyAsOf(facts, '2025-08-15');
  assert.equal(after.known, true);
  assert.ok(Math.abs(after.revYoY - 0.3) < 1e-9 && Math.abs(after.prevYoY - 0.1) < 1e-9);
  assert.equal(after.revAccel, true);
  assert.equal(after.niImproved, true);
  // the day before the Q2 filing, only Q1 is known: +10% YoY, no prior YoY to accelerate from, no NI pair
  const before = storyAsOf(facts, '2025-08-09');
  assert.equal(before.revAccel, false);
  assert.equal(before.niImproved, false);
  assert.equal(before.improving, false);
  assert.equal(storyAsOf(facts, '2026-06-01').known, false, 'last filing older than 200 days');
  assert.equal(storyAsOf(null, '2025-08-15').known, false);
});

test('a wider loss is not an improvement; loss to profit is', () => {
  const worse = { revenueQuarterly: facts.revenueQuarterly, netIncomeQuarterly: [q('2024-06-30', -5, '2024-08-10'), q('2025-06-30', -9, '2025-08-10')] };
  assert.equal(storyAsOf(worse, '2025-08-15').niImproved, false);
  const turned = { revenueQuarterly: facts.revenueQuarterly, netIncomeQuarterly: [q('2024-06-30', -5, '2024-08-10'), q('2025-06-30', 3, '2025-08-10')] };
  assert.equal(storyAsOf(turned, '2025-08-15').niImproved, true);
});

test('backtest adds story groups only when facts are given', () => {
  const spy = Array.from({ length: 450 }, (_, i) => ({ time: 1.6e9 + i * 86400, open: 100, high: 101, low: 99, close: 100, volume: 1e6 }));
  const plain = runBreakoutBacktest({}, spy);
  assert.equal(plain.report.storyImproving, undefined);
  const withFacts = runBreakoutBacktest({}, spy, { factsBySymbol: { X: facts } });
  assert.ok(withFacts.report.storyImproving && withFacts.report.storyNotImproving);
  assert.match(withFacts.limits[0], /공시된 분기만/);
});
