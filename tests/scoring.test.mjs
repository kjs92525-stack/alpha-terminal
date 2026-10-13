import test from 'node:test';
import assert from 'node:assert/strict';
import { ramp, scoreStock, rankUniverse, sizeBucket, computeMetrics, factorScores } from '../packages/analysis/scoring.mjs';
import { makeBars } from './helpers.mjs';

test('ramp clamps and handles missing values', () => {
  assert.equal(ramp(5, 0, 10), 50);
  assert.equal(ramp(-1, 0, 10), 0);
  assert.equal(ramp(20, 0, 10), 100);
  assert.equal(ramp(null, 0, 10), null);
});

test('scores are bounded, deterministic, and report coverage without fundamentals', () => {
  const bars = makeBars(300, { seed: 9 });
  const a = scoreStock(bars);
  const b = scoreStock(bars);
  assert.deepEqual(a, b);
  assert.ok(a.score >= 0 && a.score <= 100);
  assert.ok(a.coverage < 100, 'quality/valuation missing without SEC data');
  assert.equal(a.factors.quality, null);
  assert.ok(a.scenarios.bear.range[0] < a.metrics.price && a.scenarios.bull.range[1] > a.metrics.price);
  assert.match(a.scenarios.method, /확률 아님/);
});

test('uptrend scores above downtrend on momentum and trend', () => {
  const up = makeBars(300, { seed: 1, drift: 0.003, vol: 0.01 });
  const down = makeBars(300, { seed: 1, drift: -0.003, vol: 0.01 });
  const su = scoreStock(up);
  const sd = scoreStock(down);
  assert.ok(su.factors.momentum > sd.factors.momentum);
  assert.ok(su.factors.trend > sd.factors.trend);
  assert.ok(su.score > sd.score);
});

test('dilution and short runway raise risk', () => {
  const bars = makeBars(300, { seed: 2 });
  const fundamentals = { sharesOutstanding: { value: 5e7 }, revenue: { value: 1e7 }, revenueGrowth: -0.1, netMargin: -0.8, operatingCashFlow: { value: -3e7 }, runwayMonths: 5, sharesYoY: 0.45 };
  const filings = [{ category: 'DILUTION', importance: 'high', filingDate: new Date(bars.at(-1).time * 1000).toISOString().slice(0, 10) }];
  const clean = factorScores(computeMetrics(bars));
  const risky = factorScores(computeMetrics(bars, fundamentals, filings));
  assert.ok(risky.risk > clean.risk);
  assert.ok(risky.quality < 30);
});

test('rankUniverse assigns rank and percentile', () => {
  const r = rankUniverse([{ score: 40 }, { score: 80 }, { score: null }, { score: 60 }]);
  assert.deepEqual(r.map((x) => x.score), [80, 60, 40, null]);
  assert.equal(r[0].rank, 1);
  assert.equal(r[0].percentile, 100);
  assert.equal(r[2].percentile, 0);
});

test('size buckets', () => {
  assert.equal(sizeBucket(3e12), 'mega');
  assert.equal(sizeBucket(5e9), 'mid');
  assert.equal(sizeBucket(1e8), 'micro');
  assert.equal(sizeBucket(null), 'unknown');
});

test('filings dated after the as-of bar are ignored (no look-ahead)', () => {
  const bars = makeBars(300, { seed: 4 });
  const asOf = new Date(bars.at(-1).time * 1000);
  const future = new Date(asOf.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const m = computeMetrics(bars, null, [{ category: 'DILUTION', importance: 'high', filingDate: future }]);
  assert.equal(m.dilutionFilings365d, 0);
});
