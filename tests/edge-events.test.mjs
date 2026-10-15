import test from 'node:test';
import assert from 'node:assert/strict';
import { insiderEvents, filingEvents, edgeEventGroups } from '../packages/pipeline/edge-events.mjs';

const t0 = Date.UTC(2024, 0, 1) / 1000;
const bars = Array.from({ length: 500 }, (_, i) => { const c = 10 + i * 0.01; return { time: t0 + i * 86400, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1e6 }; });
const spy = new Map(bars.map((b, i) => [b.time, { ...b, open: 100, close: 100 + i * 0.001 }]));
const d = (i) => new Date((t0 + i * 86400) * 1000).toISOString().slice(0, 10);
const buy = (name, tx, filed, shares = 20000, price = 10) => ({ name, transactionCode: 'P', change: shares, transactionPrice: price, transactionDate: d(tx), filingDate: d(filed) });

test('insider cluster dates from the filing that made it public, not the trade date', () => {
  const rows = [buy('Jane Doe', 200, 202), buy('John Roe', 201, 205), buy('Jane Doe', 210, 212)];
  const ev = insiderEvents(bars, rows, spy);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].filed, d(205)); // second buyer public on day 205 → cluster (2 buyers, $400k)
  assert.equal(ev[0].date, d(206));
  assert.equal(ev[0].buyers, 2);
  assert.ok(ev[0].results[20].ret > 0 && ev[0].results[20].r === null);
  // a fund buying is not an insider cluster
  assert.equal(insiderEvents(bars, [buy('Big Capital Partners LLC', 200, 202, 1e6)], spy).length, 0);
});

test('offering and shelf filings are separate events with a 60-day cooldown; illiquid names skipped', () => {
  const filings = [{ form: '424B5', filingDate: d(200) }, { form: '424B5', filingDate: d(220) }, { form: '424B5', filingDate: d(300) }, { form: 'S-3', filingDate: d(210) }, { form: '424B2', filingDate: d(250) }];
  const ev = filingEvents(bars, filings, spy);
  assert.deepEqual(ev.filter((e) => e.kind === 'offering').map((e) => e.filed), [d(200), d(300)]);
  assert.deepEqual(ev.filter((e) => e.kind === 'shelf').map((e) => e.filed), [d(210)]);
  assert.equal(filingEvents(bars.map((b) => ({ ...b, volume: 1 })), filings, spy).length, 0);
  const g = edgeEventGroups(ev);
  assert.equal(g.offering424B.length, 2);
  assert.equal(g.insiderCluster.length, 0);
});
