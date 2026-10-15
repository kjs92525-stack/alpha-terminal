import test from 'node:test';
import assert from 'node:assert/strict';
import { findBreakoutEvents, simulate, runBreakoutBacktest, summarize } from '../packages/pipeline/backtest.mjs';
import { detectSetup } from '../packages/analysis/setups.mjs';

// same deterministic decline → long base → volume breakout path as setups.test, plus a tail
function basePath({ after = [] } = {}) {
  let s = 3;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const bars = [];
  let t = Date.UTC(2021, 0, 4) / 1000;
  const push = (close, range, volume, open) => {
    const o = open ?? close * (1 + (rnd() - 0.5) * range * 0.5);
    bars.push({ time: t, open: o, high: Math.max(o, close) * (1 + range * rnd() * 0.5), low: Math.min(o, close) * (1 - range * rnd() * 0.5), close, volume });
    t += 86400;
  };
  for (let i = 0; i < 260; i++) push(100 * Math.pow(0.4, i / 260), 0.04, 2e6);
  for (let i = 0; i < 280; i++) {
    const lowFloor = 38 + (i / 280) * 8;
    const amp = (52 - lowFloor) * (0.5 + 0.5 * Math.sin(i / 9));
    push(Math.min(51.5, lowFloor + amp), 0.035 * (1 - i / 400), 1.5e6 * (1 - i / 500));
  }
  push(55, 0.03, 6e6);
  for (const px of after) push(px, 0.01, 2e6, px);
  return bars;
}
const spyFor = (bars) => bars.map((b, i) => ({ ...b, open: 100 + i * 0.01, close: 100 + i * 0.01 }));

test('finds the breakout event exactly where the live detector says BREAKOUT', () => {
  const bars = basePath({ after: Array(130).fill(56) });
  const evs = findBreakoutEvents(bars);
  assert.equal(evs.length, 1);
  const i = evs[0].index;
  assert.equal(i, 540);
  assert.equal(detectSetup(bars.slice(0, i + 1)).stage, 'BREAKOUT'); // point-in-time agreement
});

test('events do not depend on future bars (no look-ahead)', () => {
  const up = basePath({ after: Array(130).fill(70) });
  const down = basePath({ after: Array(130).fill(30) });
  assert.deepEqual(findBreakoutEvents(up).map((e) => e.index), findBreakoutEvents(down).map((e) => e.index));
});

test('simulate: winner holds to horizon, loser exits at the stop (gap fills at the open)', () => {
  const win = basePath({ after: [56, ...Array(129).fill(62)] });
  const tw = simulate(win, findBreakoutEvents(win)[0], new Map(spyFor(win).map((b) => [b.time, b])));
  assert.equal(tw.results[20].stopped, false);
  assert.ok(tw.results[20].ret > 0);
  assert.ok(tw.results[20].spy > 0);

  const lose = basePath({ after: [55, ...Array(129).fill(20)] }); // gaps far below any stop
  const tl = simulate(lose, findBreakoutEvents(lose)[0], new Map(spyFor(lose).map((b) => [b.time, b])));
  assert.equal(tl.results[20].stopped, true);
  assert.ok(Math.abs(tl.results[20].ret - (20 / tl.entry - 1)) < 1e-9, 'gap below stop fills at the open, not the stop');
  assert.ok(tl.entry > tl.stop);
});

test('report structure, groups, case study and honest limits', () => {
  const bars = basePath({ after: Array(130).fill(60) });
  const rep = runBreakoutBacktest({ PLTR: bars, FLAT: bars.map((b) => ({ ...b })) }, spyFor(bars));
  assert.equal(rep.trades, 2);
  assert.equal(rep.report.all['20d'].n, 2);
  assert.ok(rep.report.trendTemplateOk && rep.report.longBase9mPlus);
  assert.equal(rep.caseStudies.PLTR.length, 1);
  assert.ok(rep.limits.length >= 3);
  assert.deepEqual(summarize([], 20), { n: 0 });
});

test('floor turn: first turn in the lower half of a long base, point-in-time, stop under the swing low', async () => {
  const { findFloorTurnEvents, simulateFloorTurn } = await import('../packages/pipeline/backtest.mjs');
  const make = (tail) => {
    const bars = basePath().slice(0, 540);
    let t = bars.at(-1).time;
    const push = (c, v, o = c) => { t += 86400; bars.push({ time: t, open: o, high: Math.max(o, c) * 1.005, low: Math.min(o, c) * 0.995, close: c, volume: v }); };
    for (let i = 0; i < 60; i++) push(43 + i * 0.01, 1e6);
    push(45.5, 4e6, 43.8);
    for (const c of tail) push(c, 1.5e6);
    return bars;
  };
  const up = make(Array.from({ length: 130 }, (_, i) => 46 + i * 0.05)), down = make([46, ...Array(129).fill(30)]);
  const a = findFloorTurnEvents(up), b = findFloorTurnEvents(down);
  assert.equal(a.length, 1);
  assert.equal(a[0].index, 600);
  assert.equal(b[0].index, a[0].index); // future bars do not change the signal
  assert.ok(a[0].posInBase <= 0.5 && a[0].stop < 43);
  const spy = new Map(spyFor(up).map((x) => [x.time, x]));
  const win = simulateFloorTurn(up, a[0], spy), loss = simulateFloorTurn(down, b[0], new Map(spyFor(down).map((x) => [x.time, x])));
  assert.ok(win.toPivot > 0.1 && win.results[60].ret > 0 && !win.results[60].stopped);
  assert.ok(loss.results[20].stopped && loss.results[20].ret < 0);
});
