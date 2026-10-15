import test from 'node:test';
import assert from 'node:assert/strict';
import { insiderSignal, dilutionSignal, analystTrend } from '../packages/analysis/edge-signals.mjs';

test('insider cluster: several open-market buys count; sales, grants and old buys do not', () => {
  const rows = [
    { name: 'CEO A', transactionCode: 'P', change: 20000, transactionPrice: 5, transactionDate: '2026-10-01' },
    { name: 'CFO B', transactionCode: 'P', change: 5000, transactionPrice: 5, transactionDate: '2026-09-20' },
    { name: 'Dir C', transactionCode: 'A', change: 100000, transactionPrice: 0, transactionDate: '2026-10-02' },
    { name: 'Dir D', transactionCode: 'S', change: -1000, transactionPrice: 6, transactionDate: '2026-10-03' },
    { name: 'Old E', transactionCode: 'P', change: 90000, transactionPrice: 5, transactionDate: '2026-01-01' },
    { name: 'Future F', transactionCode: 'P', change: 90000, transactionPrice: 5, transactionDate: '2026-12-01' },
  ];
  const s = insiderSignal(rows, '2026-10-14');
  assert.equal(s.buyers, 2);
  assert.equal(s.buyValue, 125000);
  assert.equal(s.cluster, true);
  assert.equal(s.sellValue, 6000);
  assert.equal(insiderSignal([rows[1]], '2026-10-14').cluster, false, 'one small buy is not a cluster');
  assert.equal(insiderSignal(null, '2026-10-14'), null, 'not collected stays unknown');
});

test('dilution: shelf and offering documents in the last 180 days', () => {
  const d = dilutionSignal([{ form: 'S-3', filingDate: '2026-08-01' }, { form: '424B5', filingDate: '2026-10-02' }, { form: '10-Q', filingDate: '2026-08-05' }, { form: 'S-1', filingDate: '2025-01-01' }], '2026-10-14');
  assert.equal(d.count, 2);
  assert.ok(d.shelf && d.offering);
  assert.equal(d.recent[0].form, '424B5');
  assert.equal(dilutionSignal([], '2026-10-14').count, 0);
});

test('analyst trend: change in buy share over three months', () => {
  const rows = [
    { period: '2026-10-01', strongBuy: 3, buy: 5, hold: 2, sell: 0, strongSell: 0 },
    { period: '2026-09-01', strongBuy: 2, buy: 4, hold: 4 },
    { period: '2026-08-01', strongBuy: 2, buy: 3, hold: 5 },
    { period: '2026-07-01', strongBuy: 1, buy: 3, hold: 6 },
  ];
  const t = analystTrend(rows);
  assert.equal(t.analysts, 10);
  assert.ok(Math.abs(t.bullShare - 0.8) < 1e-9);
  assert.ok(Math.abs(t.change3m - 0.4) < 1e-9);
  assert.equal(t.direction, 'up');
  assert.equal(analystTrend([rows[0]]).direction, 'unknown');
  assert.equal(analystTrend([]), null);
});
