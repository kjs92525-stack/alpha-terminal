import test from 'node:test';
import assert from 'node:assert/strict';
import { regularSession, fourHourBars } from '../packages/analysis/intraday.mjs';
import { resampleMonthly } from '../packages/analysis/indicators.mjs';
import { dailyContext, contextRead } from '../scripts/ict-intraday.mjs';

const bar = (iso, c) => ({ time: Date.parse(iso) / 1000, open: c, high: c + 1, low: c - 1, close: c, volume: 100 });

test('regularSession keeps 09:30-16:00 New York only (EST in January)', () => {
  const xs = [bar('2026-01-05T14:25:00Z', 1), bar('2026-01-05T14:30:00Z', 2), bar('2026-01-05T20:55:00Z', 3), bar('2026-01-05T21:00:00Z', 4)];
  assert.deepEqual(regularSession(xs).map((b) => b.close), [2, 3]);
});

test('fourHourBars builds two regular-session blocks per day', () => {
  const hours = [14, 15, 16, 17, 18, 19, 20].map((h, k) => bar(`2026-01-05T${h}:00:00Z`, 10 + k)); // 09:00-15:00 EST
  const out = fourHourBars(hours);
  assert.equal(out.length, 2);
  assert.equal(out[0].open, 10); assert.equal(out[0].close, 13); assert.equal(out[1].close, 16);
  assert.equal(out[0].volume, 400);
});

test('resampleMonthly groups by calendar month', () => {
  const xs = [bar('2026-01-30T00:00:00Z', 5), bar('2026-02-02T00:00:00Z', 7), bar('2026-02-27T00:00:00Z', 9)];
  const m = resampleMonthly(xs);
  assert.equal(m.length, 2);
  assert.deepEqual([m[1].open, m[1].high, m[1].close, m[1].volume], [7, 10, 9, 200]);
});

test('dailyContext / contextRead flag a stretched chart and a wall before the target', () => {
  const b4 = [];
  for (let d = 0; d < 80; d++) { const day = new Date(Date.UTC(2026, 0, 1) + d * 864e5).toISOString().slice(0, 10), c = d < 60 ? 100 : 100 - (d - 59) * 2;
    b4.push({ day, o: c, h: c + 1, l: c - 1, c }, { day, o: c, h: c + 1, l: c - 1, c }); }
  const ctx = dailyContext(b4), last = ctx.get(b4.at(-1).day);
  assert.ok(last.sma50 > last.ema20); // a falling stock: the 50-day sits above
  const r = contextRead(last, 62, 62, 110);
  assert.ok(r.overhead > 62 && r.overhead < 110);
  assert.ok(r.ext < 0);
  assert.equal(contextRead(null, 1, 1, 2), null);
});
