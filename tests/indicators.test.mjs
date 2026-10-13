import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, macd, atr, vwap, obv, volumeProfile, resampleWeekly, trendRegime } from '../packages/analysis/indicators.mjs';
import { makeBars, close } from './helpers.mjs';

test('sma and ema warm-up and values', () => {
  const v = [1, 2, 3, 4, 5];
  assert.deepEqual(sma(v, 3), [null, null, 2, 3, 4]);
  const e = ema(v, 3);
  assert.equal(e[1], null);
  assert.equal(e[2], 2);
  assert.ok(close(e[3], 3));
  assert.ok(close(e[4], 4));
});

test('rsi is 100 on monotonic rise, 0 on monotonic fall, within bounds otherwise', () => {
  const up = Array.from({ length: 30 }, (_, i) => 10 + i);
  const down = up.slice().reverse();
  assert.equal(rsi(up, 14)[29], 100);
  assert.equal(rsi(down, 14)[29], 0);
  const r = rsi(makeBars(200).map((b) => b.close), 14).filter((x) => x !== null);
  assert.ok(r.every((x) => x >= 0 && x <= 100));
});

test('macd histogram equals line minus signal', () => {
  const closes = makeBars(120).map((b) => b.close);
  const m = macd(closes);
  assert.equal(m.macd[24], null);
  assert.notEqual(m.macd[25], null);
  const i = 100;
  assert.ok(close(m.hist[i], m.macd[i] - m.signal[i]));
});

test('atr is positive and warms up at period-1', () => {
  const a = atr(makeBars(50), 14);
  assert.equal(a[12], null);
  assert.ok(a[13] > 0 && a[49] > 0);
});

test('session vwap resets on a new US/Eastern day; anchored vwap does not', () => {
  const t = Date.UTC(2025, 2, 3, 15, 0) / 1000; // 10:00 ET
  const bars = [
    { time: t, open: 10, high: 10, low: 10, close: 10, volume: 100 },
    { time: t + 3600, open: 20, high: 20, low: 20, close: 20, volume: 100 },
    { time: t + 86400, open: 30, high: 30, low: 30, close: 30, volume: 100 },
  ];
  assert.deepEqual(vwap(bars, 'session'), [10, 15, 30]);
  assert.deepEqual(vwap(bars, 'none'), [10, 15, 20]);
});

test('obv accumulates signed volume', () => {
  const bars = [10, 11, 10.5, 10.5].map((c, i) => ({ time: i, open: c, high: c, low: c, close: c, volume: 100 }));
  assert.deepEqual(obv(bars), [0, 100, 0, 0]);
});

test('volume profile conserves volume and value area contains POC', () => {
  const bars = makeBars(150);
  const p = volumeProfile(bars, 20);
  const total = bars.reduce((s, b) => s + b.volume, 0);
  assert.ok(Math.abs(p.bins.reduce((s, b) => s + b.volume, 0) - total) / total < 1e-9);
  assert.ok(p.valueAreaLow <= p.poc && p.poc <= p.valueAreaHigh);
});

test('weekly resample aggregates OHLCV', () => {
  const bars = makeBars(10, { t0: Date.UTC(2025, 0, 6) / 1000 }); // Monday
  const w = resampleWeekly(bars);
  assert.equal(w.length, 2);
  assert.equal(w[0].open, bars[0].open);
  assert.equal(w[0].close, bars[6].close);
  assert.equal(w[0].volume, bars.slice(0, 7).reduce((s, b) => s + b.volume, 0));
});

test('trend regime detects a clean uptrend', () => {
  const closes = Array.from({ length: 260 }, (_, i) => 50 + i * 0.5);
  assert.equal(trendRegime(closes).regime, 'uptrend');
  assert.equal(trendRegime(closes.slice(0, 30)).regime, 'insufficient');
});

test('indicators are causal: values on a truncated series match the full series', () => {
  const bars = makeBars(300, { seed: 11 });
  const k = 180;
  const cut = bars.slice(0, k);
  const full = bars.map((b) => b.close);
  const part = cut.map((b) => b.close);
  for (const [fa, fb] of [[rsi(full), rsi(part)], [ema(full, 20), ema(part, 20)], [atr(bars), atr(cut)], [macd(full).hist, macd(part).hist]]) {
    for (let i = 0; i < k; i++) assert.ok(fa[i] === fb[i] || close(fa[i], fb[i], 1e-9), `index ${i}`);
  }
});
