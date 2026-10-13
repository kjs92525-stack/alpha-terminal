import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPullback, detectHtfBottom, resampleMonthly, mergeMonthly } from '../packages/analysis/zones.mjs';
import { resampleWeekly, sma } from '../packages/analysis/indicators.mjs';

function series(closes, { t0 = Date.UTC(2020, 0, 6) / 1000, step = 86400, vol = () => 1e6, seed = 7 } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    const w = c * 0.006 * (0.5 + rnd());
    return { time: t0 + i * step, open: o, high: Math.max(o, c) + w, low: Math.min(o, c) - w, close: c, volume: vol(i) };
  });
}

// steady uptrend 50 -> ~110 with small waves, then a ~10% pullback
function uptrendThenPullback(extra = []) {
  const c = [];
  for (let i = 0; i < 320; i++) c.push(50 * Math.pow(2.2, i / 320) * (1 + 0.01 * Math.sin(i / 4)));
  // pull back ~0.8%/day until price reaches the 50-day average (a typical support touch)
  const top = c.at(-1);
  for (let i = 1; i <= 25; i++) {
    const px = top * (1 - 0.008 * i);
    c.push(px);
    if (px <= sma(c, 50).at(-1) * 1.005) break;
  }
  return series([...c, ...extra], { vol: (i) => (i > 320 ? 6e5 : 1e6) });
}

test('pullback in an uptrend to support gives a buy point with stop and target', () => {
  const bars = uptrendThenPullback();
  const p = detectPullback(bars);
  assert.ok(['AT_SUPPORT', 'APPROACHING', 'BOUNCE'].includes(p.stage), `${p.stage} ${p.reason ?? ''}`);
  assert.ok(p.depth > 0.05 && p.depth < 0.25);
  assert.ok(p.plan.stop < p.plan.entry && p.plan.target > p.plan.entry);
  assert.ok(p.plan.how.includes('$'));
  assert.ok(p.volumeDryUp);
});

test('a reversal bar at support turns the pullback into BOUNCE (buy above its high)', () => {
  const base = uptrendThenPullback();
  const p0 = detectPullback(base);
  const lastC = base.at(-1).close;
  const bars = [...base];
  const prev = bars.at(-1);
  bars.push({ time: prev.time + 86400, open: lastC * 0.995, high: prev.high * 1.006, low: Math.min(prev.low, p0.support.price) * 0.999, close: prev.high * 1.003, volume: 1.4e6 });
  const p = detectPullback(bars);
  assert.equal(p.stage, 'BOUNCE', p.reason);
  assert.equal(p.plan.entry, bars.at(-1).high);
});

test('no pullback signal in a downtrend', () => {
  const c = Array.from({ length: 330 }, (_, i) => 100 * Math.pow(0.5, i / 330));
  assert.equal(detectPullback(series(c)).stage, 'NONE');
});

function weeklyBottom({ falling = false } = {}) {
  const c = [];
  for (let i = 0; i < 20; i++) c.push(100 + i);
  for (let i = 0; i < 50; i++) c.push(120 * Math.pow(40 / 120, i / 49)); // -67%
  if (falling) { for (let i = 1; i <= 3; i++) c.push(40 * (1 - 0.03 * i)); return series(c, { step: 7 * 86400 }); }
  for (let i = 0; i < 14; i++) c.push(41 + (i / 13) * 5 + 1.2 * Math.sin(i)); // higher lows, drifting up
  return series(c, { step: 7 * 86400, vol: (i) => (i >= 70 ? 4e6 : 1e7) });
}

test('weekly bottom: big decline, low several weeks old, higher lows → TURNING with zone + stop', () => {
  const b = detectHtfBottom(weeklyBottom(), 'weekly');
  assert.equal(b.stage, 'TURNING', b.reason);
  assert.ok(b.decline > 0.5);
  assert.ok(b.higherLow && b.aboveMa);
  assert.ok(b.plan.stop < b.low && b.plan.zone[0] === b.low);
  assert.ok(b.plan.target > b.plan.entry);
});

test('weekly bottom: still making new lows is not a bottom (no falling knife)', () => {
  const b = detectHtfBottom(weeklyBottom({ falling: true }), 'weekly');
  assert.equal(b.stage, 'NONE');
});

test('monthly resample and merge with long monthly history', () => {
  const daily = series(Array.from({ length: 70 }, (_, i) => 10 + i * 0.1), { t0: Date.UTC(2024, 0, 15) / 1000 });
  const m = resampleMonthly(daily);
  assert.equal(new Date(m[0].time * 1000).toISOString().slice(0, 10), '2024-01-01');
  assert.equal(m.at(-1).close, daily.at(-1).close);
  const long = [0, 1, 2].map((k) => ({ time: Date.UTC(2023, 10 + k, 1, 5) / 1000, open: 1, high: 2, low: 0.5, close: 1, volume: 1 }));
  const merged = mergeMonthly(long, daily);
  assert.equal(merged.filter((b) => b.time === Date.UTC(2024, 0, 1) / 1000).length, 1, 'no duplicate month');
  assert.equal(merged.at(-1).close, daily.at(-1).close);
  assert.ok(merged.length >= m.length + 1);
  assert.ok(resampleWeekly(daily).length > 9);
});
