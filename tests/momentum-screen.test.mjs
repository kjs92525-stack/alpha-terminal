import test from 'node:test';
import assert from 'node:assert/strict';
import { indicators, chartPass, screenAll, tradeSignals, MOMO_RULES } from '../scripts/momentum-screen.mjs';

const day = (i) => `d${String(i).padStart(4, '0')}`;
/** a steady riser (drift per day) with a small wave, liquid */
const series = (n, drift, wave = 0.004, v = (i) => 2e6) => { const out = []; let c = 50; for (let i = 0; i < n; i++) { const o = c; c = c * (1 + drift + Math.sin(i / 3) * wave); out.push({ day: day(i), o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: v(i) }); } return out; };

test('momentum screen: a liquid riser near its high with rising volume passes, a faller does not', () => {
  const up = series(300, 0.0025, 0.004, (i) => (i > 270 ? 3e6 : 2e6)), down = series(300, -0.002);
  const xu = indicators(up), xd = indicators(down), i = 299;
  const a = chartPass(up[i], xu[i]), b = chartPass(down[i], xd[i]);
  assert.equal(a.liquid, true); assert.equal(a.trend, true); assert.ok(a.nearHigh > 0.95); assert.ok(a.volRatio >= MOMO_RULES.volRatio);
  assert.equal(b.pass, false, 'below a falling 50-day average');
  // the rank is across the universe: with 9 fallers the riser is the strongest
  const data = new Map([['UP', up], ...Array.from({ length: 9 }, (_, k) => [`D${k}`, series(300, -0.001 - k * 0.0002)])]);
  const { passes } = screenAll(data);
  for (const rows of passes.values()) for (const r of rows) assert.equal(r.sym, 'UP');
});

test('momentum screen trades: next-day open entry, ATR stop, R target, one trade per stock at a time', () => {
  const bars = series(200, 0.004, 0.002), xs = indicators(bars);
  const sig = [100, 101, 102, 150];
  const tr = tradeSignals(bars, xs, sig, { entry: 'open', stopAtr: 1.5, targetR: 3, maxHold: 20 });
  assert.ok(tr.length >= 2 && tr.length <= 3, 'signals during an open trade are skipped');
  const t = tr[0];
  assert.equal(t.entryT, bars[101].day); assert.equal(t.entryPx, bars[101].o);
  assert.ok(Math.abs((t.entryPx - t.stopPx) - 1.5 * xs[100].atr) < 1e-9, 'stop 1.5 ATR under the entry');
  assert.ok(t.exitT > t.entryT && t.held <= 20);
  if (t.kind === 'target') assert.ok(t.R > 2.5);
  // a pullback limit that never comes back to the 20-day average is not filled
  const none = tradeSignals(series(200, 0.01, 0), indicators(series(200, 0.01, 0)), [100], { entry: 'pullback', stopAtr: 1.5, targetR: 3, maxHold: 20 });
  assert.equal(none.length, 0);
});
