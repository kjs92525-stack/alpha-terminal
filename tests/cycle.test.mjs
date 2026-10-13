import test from 'node:test';
import assert from 'node:assert/strict';
import { cyclePhase, returnCorrelation, bestGroup } from '../packages/analysis/cycle.mjs';

const series = (closes, t0 = Date.UTC(2023, 0, 2) / 1000) => closes.map((c, i) => ({ time: t0 + i * 86400, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1e6 }));
const spy = series(Array.from({ length: 600 }, (_, i) => 400 + i * 0.2));

test('long slide then back above a turning 200-day = early cycle; steady leader = leading; slide = down', () => {
  const early = [];
  for (let i = 0; i < 300; i++) early.push(100 - i * 0.15); // 100 -> 55
  for (let i = 0; i < 200; i++) early.push(55 + 3 * Math.sin(i / 10)); // base
  for (let i = 0; i < 100; i++) early.push(55 + i * 0.12); // turn up to ~67
  const e = cyclePhase(series(early), spy);
  assert.equal(e.phase, 'EARLY', JSON.stringify(e.metrics));

  const lead = Array.from({ length: 600 }, (_, i) => 50 * Math.pow(1.001, i) * (1 + 0.06 * Math.sin(i / 12)));
  assert.equal(cyclePhase(series(lead), spy).phase, 'LEADING');

  const down = Array.from({ length: 600 }, (_, i) => 100 * Math.pow(0.9985, i));
  assert.equal(cyclePhase(series(down), spy).phase, 'DOWN');
  assert.ok(e.earlyScore > cyclePhase(series(lead), spy).earlyScore);
});

test('stocks are attached to the ETF they track beyond the market, not to everything', () => {
  let s = 7;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  const mkt = []; const semi = []; const bio = [];
  for (let i = 0; i < 200; i++) { mkt.push(rnd() * 0.01); semi.push(rnd() * 0.03); bio.push(rnd() * 0.03); }
  const path = (rets, p0 = 100) => { let p = p0; return rets.map((r) => (p *= 1 + r)); };
  const SPY = series(path(mkt));
  const SMH = series(path(semi.map((r, i) => r + mkt[i])));
  const XBI = series(path(bio.map((r, i) => r + mkt[i])));
  const chip = series(path(semi.map((r, i) => 1.2 * r + mkt[i] + rnd() * 0.01)));
  const g = bestGroup(chip, { SMH, XBI }, SPY);
  assert.equal(g.etf, 'SMH');
  assert.ok(returnCorrelation(chip, SMH) > 0.8);
  const marketOnly = series(path(mkt.map((r) => r + rnd() * 0.002)));
  assert.equal(bestGroup(marketOnly, { SMH, XBI }, SPY), null);
});

test('modest pullback near highs is a pause, not a bottom; weak-year turnaround outperforming is early', () => {
  const spyUp = series(Array.from({ length: 600 }, (_, i) => 400 + i * 0.1));
  // up 50% over two years, then a 9% dip just under the 200-day: a pause
  const pause = Array.from({ length: 560 }, (_, i) => 60 + i * 0.06).concat(Array.from({ length: 40 }, (_, i) => 93.6 - i * 0.22));
  const p = cyclePhase(series(pause), spyUp);
  assert.ok(['NEUTRAL', 'LEADING'].includes(p.phase), p.phase);
  assert.notEqual(p.phase, 'BASING');
  // flat-to-down year, then a sharp 3-month rally beating the market (IGV 2026-like)
  const turn = Array.from({ length: 460 }, (_, i) => 100 - i * 0.05).concat(Array.from({ length: 140 }, (_, i) => 77 + i * 0.06 + 1.5 * Math.sin(i / 6)));
  assert.equal(cyclePhase(series(turn), spyUp).phase, 'EARLY');
});
