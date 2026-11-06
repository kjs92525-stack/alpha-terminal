import test from 'node:test';
import assert from 'node:assert/strict';
import { toFourHour, tradesFor, summarize } from '../scripts/ict-intraday.mjs';
import { parseAlpacaBars } from '../packages/pipeline/alpaca.mjs';

test('hourly Alpaca bars keep their hour and fold into two regular-session 4-hour bars a day', () => {
  const hours = ['13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '22:00']; // 09:00-16:00 EDT plus one after-hours bar
  const json = { bars: { X: hours.map((h, k) => ({ t: `2026-07-01T${h}:00Z`, o: 10 + k, h: 11 + k, l: 9 + k, c: 10.5 + k, v: 100 })) } };
  const raw = parseAlpacaBars(json, true).X;
  assert.equal(new Set(raw.map((b) => b.time)).size, hours.length, 'intraday timestamps are not collapsed to the day');
  const four = toFourHour(raw);
  assert.equal(four.length, 2);
  assert.equal(four[0].o, 10); assert.equal(four[0].c, 13.5); assert.equal(four[0].v, 400);  // 09-12 ET
  assert.equal(four[1].c, 16.5); assert.equal(four[1].h, 17);                                // 13-15 ET, 16:00+ dropped
});

test('a structure shift on 4-hour bars becomes one trade with an R result', () => {
  const bars = []; let c = 50;
  for (let i = 0; i < 260; i++) { const o = c; c = c * (1 + 0.0012 + Math.sin(i / 2) * 0.012); bars.push({ day: `d${String(Math.floor(i / 2)).padStart(4, '0')}`, o, h: Math.max(o, c) * 1.006, l: Math.min(o, c) * 0.994, c, v: 1e6 }); }
  const C = bars.at(-1).c; let prev = C;
  const add = (x, { h, l, v = 1e6 } = {}) => { bars.push({ day: 'd9000', o: prev, h: h ?? Math.max(prev, x * C) * 1.003, l: l ?? Math.min(prev, x * C) * 0.997, c: x * C, v }); prev = x * C; };
  add(0.98); add(0.96); add(0.95, { l: 0.94 * C }); add(0.97); add(0.975, { h: 0.985 * C }); add(0.965); add(0.955); add(0.945, { l: 0.925 * C, v: 2e6 }); add(0.96);
  bars.push({ day: 'd9001', o: 0.965 * C, h: C, l: 0.962 * C, c: 0.995 * C, v: 2.5e6 }); prev = 0.995 * C;
  for (let k = 0; k < 10; k++) add(0.995 + k * 0.01);
  const tr = tradesFor(bars, { entry: 'market', fixedR: 2 }); // the 60-bar high is too close for a liquidity target here
  assert.ok(tr.length >= 1);
  const s = summarize(tr, 'd9001');
  assert.equal(s.all.n, tr.length);
});

test('live 4-hour signals carry a plan and a status, and finished results are kept when merged', async () => {
  const { signalsFor } = await import('../scripts/ict-intraday.mjs');
  const { mergeSignals, liveStats } = await import('../scripts/ict4h-live.mjs');
  const bars = []; let c = 50;
  for (let i = 0; i < 300; i++) { const o = c; c = c * (1 + 0.0015 + Math.sin(i / 2) * 0.012); bars.push({ t: `2026-01-01T${String(i).padStart(5, '0')}`, day: `d${String(Math.floor(i / 2)).padStart(4, '0')}`, o, h: Math.max(o, c) * 1.006, l: Math.min(o, c) * 0.994, c, v: 1e6 }); }
  const sig = signalsFor(bars);
  for (const s of sig) {
    assert.ok(s.limit > s.stop && s.target > s.limit, 'plan levels in order');
    assert.ok(['waiting', 'expired', 'cancelled', 'open', 'won', 'lost', 'timeout'].includes(s.status));
    if (['won', 'lost', 'timeout'].includes(s.status)) assert.equal(typeof s.R, 'number');
  }
  const a = { symbol: 'X', t: '2026-11-01T14', status: 'won', R: 2, firstSeen: '2026-11-01' };
  const merged = mergeSignals([a], [{ ...a, status: 'open', R: undefined, firstSeen: '2026-11-05' }], 9999, Date.parse('2026-11-06'));
  assert.equal(merged[0].status, 'won', 'a finished signal is not reopened');
  assert.equal(liveStats(merged).n, 1);
});
