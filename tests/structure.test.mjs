import test from 'node:test';
import assert from 'node:assert/strict';
import { swings, marketStructure, fairValueGaps, orderBlocks, supportResistance } from '../packages/analysis/indicators.mjs';
import { makeBars } from './helpers.mjs';

const bar = (i, o, h, l, c) => ({ time: i * 86400, open: o, high: h, low: l, close: c, volume: 1000 });

test('swing pivots report confirmedIndex = index + right', () => {
  const highs = [1, 2, 3, 9, 3, 2, 1, 2];
  const bars = highs.map((h, i) => bar(i, h - 0.5, h, h - 1, h - 0.2));
  const s = swings(bars, 3, 3).filter((x) => x.type === 'high');
  assert.equal(s.length, 1);
  assert.equal(s[0].index, 3);
  assert.equal(s[0].confirmedIndex, 6);
});

test('swings never use data beyond confirmedIndex (no repaint)', () => {
  const bars = makeBars(260, { seed: 3 });
  const full = swings(bars);
  for (const k of [60, 120, 200]) {
    const part = swings(bars.slice(0, k));
    const expected = full.filter((s) => s.confirmedIndex < k);
    assert.deepEqual(part, expected);
  }
});

test('market structure: BOS then CHoCH, and events never precede the swing confirmation', () => {
  // up-leg making a swing high at 3, pullback, breakout (BOS up), then collapse below swing low (CHoCH down)
  const seq = [10, 11, 12, 15, 13, 12, 11, 12, 13, 16, 17, 14, 12, 10, 8, 7, 6];
  const bars = seq.map((c, i) => bar(i, c - 0.3, c + 0.5, c - 0.5, c));
  const { events } = marketStructure(bars, { left: 2, right: 2, lastBarClosed: true });
  assert.ok(events.length >= 2);
  const bull = events.find((e) => e.direction === 'bull');
  assert.equal(bull.kind, 'BOS');
  const bear = events.find((e) => e.direction === 'bear');
  assert.equal(bear.kind, 'CHoCH');
  const piv = swings(bars, 2, 2);
  for (const e of events) {
    const s = piv.find((p) => p.index === e.swingIndex);
    assert.ok(s.confirmedIndex <= e.index, 'event uses only confirmed swings');
  }
});

test('structure events on an unfinished last bar are provisional', () => {
  const seq = [10, 11, 12, 15, 13, 12, 11, 12, 13, 16];
  const bars = seq.map((c, i) => bar(i, c - 0.3, c + 0.5, c - 0.5, c));
  const { events } = marketStructure(bars, { left: 2, right: 2, lastBarClosed: false });
  const last = events[events.length - 1];
  assert.equal(last.index, bars.length - 1);
  assert.equal(last.provisional, true);
});

test('fair value gap detection and fill tracking', () => {
  const bars = [bar(0, 10, 11, 9.5, 10.8), bar(1, 11, 14, 10.9, 13.8), bar(2, 13.9, 15, 12, 14.5), bar(3, 14.5, 14.6, 10.5, 11)];
  const g = fairValueGaps(bars, { lastBarClosed: true });
  assert.equal(g.length, 1);
  assert.equal(g[0].direction, 'bull');
  assert.equal(g[0].bottom, 11);
  assert.equal(g[0].top, 12);
  assert.equal(g[0].confirmedIndex, 2);
  assert.equal(g[0].filledIndex, 3);
});

test('order block is the last opposite candle before a bullish break', () => {
  const seq = [10, 11, 12, 15, 13, 12, 11, 12, 13, 16];
  const bars = seq.map((c, i) => bar(i, i === 6 ? 11.6 : c - 0.3, c + 0.5, c - 0.5, c));
  const { events } = marketStructure(bars, { left: 2, right: 2, lastBarClosed: true });
  const obs = orderBlocks(bars, events);
  assert.ok(obs.length >= 1);
  const ob = obs.find((o) => o.direction === 'bull');
  assert.equal(ob.index, 6);
  assert.ok(ob.confirmedIndex >= ob.index);
});

test('support/resistance levels are classified around last close', () => {
  const bars = makeBars(250, { seed: 5 });
  const levels = supportResistance(bars);
  const lastClose = bars[bars.length - 1].close;
  assert.ok(levels.length > 0);
  for (const l of levels) assert.equal(l.kind, l.price >= lastClose ? 'resistance' : 'support');
});
