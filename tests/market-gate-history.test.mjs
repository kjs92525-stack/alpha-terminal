import test from 'node:test';
import assert from 'node:assert/strict';
import { addSymbol, toSeries } from '../scripts/breadth-history.mjs';
import { parseDailyCsv, flagStats } from '../scripts/market-gate-full-backtest.mjs';

const mk = (n, f, vol = 1e6) => Array.from({ length: n }, (_, i) => ({ time: Date.UTC(2020, 0, 1) / 1000 + i * 86400, close: f(i), volume: vol }));

test('breadth history: same sample rules as the nightly breadth, point in time', () => {
  const acc = new Map();
  addSymbol(acc, mk(260, (i) => 10 + i * 0.1));            // rising, liquid: above both averages from bar 200
  addSymbol(acc, mk(260, (i) => 50 - i * 0.1));            // falling, liquid: below both
  addSymbol(acc, mk(260, () => 0.5, 1e9));                 // under $1: never in the sample
  const s = toSeries(acc);
  assert.equal(s.length, 260);
  assert.equal(s[198].sample, 0, 'fewer than 200 bars is not counted');
  const last = s.at(-1);
  assert.equal(last.universe, 3);
  assert.equal(last.sample, 2);
  assert.equal(last.above50, 0.5);
  assert.equal(last.above200, 0.5);
});

test('VIX/FRED csv parsing and credit flag stats', () => {
  const cboe = parseDailyCsv('DATE,OPEN,HIGH,LOW,CLOSE\n01/02/2020,13,14,12,12.47\n');
  assert.equal(cboe.get('2020-01-02'), 12.47);
  const fred = parseDailyCsv('observation_date,BAMLH0A0HYM2\n2020-01-02,3.5\n2020-01-03,.\n');
  assert.equal(fred.get('2020-01-02'), 3.5);
  assert.equal(fred.has('2020-01-03'), false);
  const rows = [0.01, -0.02, 0.01, -0.03].map((next, i) => ({ asOf: `2020-01-0${i + 1}`, next, fwd: { 5: next, 21: next, 63: next }, x: i % 2 }));
  const s = flagStats(rows, (r) => r.x === 1);
  assert.equal(s.flaggedShare, 0.5);
  assert.ok(s.gated.total > s.hold.total, 'skipping the flagged losing days beats holding');
});
