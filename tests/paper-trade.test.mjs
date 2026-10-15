import test from 'node:test';
import assert from 'node:assert/strict';
import { simulatePaperTrade, summarizePaper } from '../packages/analysis/paper-trade.mjs';

const t0 = Date.UTC(2026, 0, 5) / 1000;
// closes list → bars with a small range; overrides per index
const mk = (closes, over = {}) => closes.map((c, i) => ({ time: t0 + i * 86400, open: c, high: c * 1.01, low: c * 0.99, close: c, ...(over[i] ?? {}) }));
const flat = (n, c) => Array(n).fill(c);
const sig = { signalDate: '2026-01-05', entry: 10, stop: 9, target: 13, entryType: 'buy-stop' };

test('buy-stop fills on the trigger, +1R moves stop to entry, +2R sells half, 50-day trail exits the rest', () => {
  // 60 flat days at 9.5 so the 50-day average exists, then the run
  const closes = [...flat(60, 9.5), 10.1, 10.6, 11.2, 12.1, 12.5, 12.4, 11.0, 10.0];
  const bars = mk(closes, { 60: { open: 9.6, high: 10.2, low: 9.55, close: 10.1 } });
  const s = { ...sig, signalDate: '2026-03-05' }; // day index 59
  const r = simulatePaperTrade(s, bars);
  assert.equal(r.fill, 10);
  assert.ok(r.events.some((e) => e.kind === 'breakeven'));
  assert.ok(r.events.some((e) => e.kind === 'partial'));
  assert.equal(r.status, 'closed');
  assert.ok(r.rMultiple > 0.9, String(r.rMultiple));
});

test('gap through the stop exits at the open; an order that never triggers expires; a break before fill cancels', () => {
  const bars = mk([10, 10.2, 10.3, 8.5], { 1: { open: 10.1, high: 10.25, low: 9.95, close: 10.2 }, 3: { open: 8.4, high: 8.6, low: 8.3, close: 8.5 } });
  const r = simulatePaperTrade({ ...sig, signalDate: '2026-01-05' }, bars);
  assert.equal(r.status, 'closed');
  assert.equal(r.exitReason.includes('갭'), true);
  assert.ok(r.rMultiple < -1, 'gap loss is worse than -1R');
  const quiet = mk(flat(15, 9.6));
  assert.equal(simulatePaperTrade({ ...sig, signalDate: '2026-01-04' }, quiet).status, 'expired');
  const broke = mk([9.6, 9.5, 8.8]);
  assert.equal(simulatePaperTrade({ ...sig, signalDate: '2026-01-04' }, broke).status, 'invalidated');
  assert.equal(simulatePaperTrade({ ...sig, signalDate: '2026-01-04' }, mk([9.6, 9.6])).status, 'pending');
});

test('time stop after 40 sessions without progress; limit orders fill at the zone', () => {
  const bars = mk([10, ...flat(45, 10.2)], { 1: { open: 10.0, high: 10.3, low: 9.7, close: 10.2 } });
  const r = simulatePaperTrade({ signalDate: '2026-01-05', entry: 9.8, stop: 9, entryType: 'limit' }, bars);
  assert.equal(r.fill, 9.8);
  assert.equal(r.status, 'closed');
  assert.match(r.exitReason, /시간 손절/);
});

test('summary counts only closed trades for win rate and says when the sample is too small', () => {
  const s = summarizePaper([{ result: { status: 'closed', rMultiple: 2, ret: 0.2, vsSpy: 0.15 } }, { result: { status: 'closed', rMultiple: -1, ret: -0.1, vsSpy: -0.12 } }, { result: { status: 'open', rMultiple: 0.5 } }, { result: { status: 'expired' } }]);
  assert.equal(s.closed, 2); assert.equal(s.open, 1); assert.equal(s.winRate, 0.5); assert.equal(s.totalR, 1); assert.equal(s.enough, false); assert.equal(s.expiredOrInvalidated, 1);
});
