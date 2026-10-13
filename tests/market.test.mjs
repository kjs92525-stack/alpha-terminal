import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStooqCsv, parseYahooChart, isDailyBarClosed } from '../packages/analysis/market.mjs';

test('stooq csv parsing (format fixture)', () => {
  const csv = 'Date,Open,High,Low,Close,Volume\n2025-01-03,10,11,9,10.5,1000\n2025-01-02,9,10,8,9.5,900\n2025-01-06,bad,1,1,1,1\n';
  const bars = parseStooqCsv(csv);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].time, Date.UTC(2025, 0, 2) / 1000);
  assert.equal(bars[1].close, 10.5);
  assert.deepEqual(parseStooqCsv('No data'), []);
});

test('yahoo chart parsing normalises daily timestamps and skips null rows', () => {
  const json = { chart: { result: [{
    meta: { symbol: 'TEST', currency: 'USD', gmtoffset: -18000, exchangeTimezoneName: 'America/New_York', regularMarketTime: 1736197200 },
    timestamp: [1736173800, 1736260200, 1736346600],
    indicators: { quote: [{ open: [1, 2, null], high: [1.5, 2.5, null], low: [0.5, 1.5, null], close: [1.2, 2.2, null], volume: [10, 20, null] }] },
  }] } };
  const { bars, meta } = parseYahooChart(json, { daily: true });
  assert.equal(bars.length, 2);
  assert.equal(bars[0].time, Date.UTC(2025, 0, 6) / 1000);
  assert.equal(meta.currency, 'USD');
  assert.deepEqual(parseYahooChart({}).bars, []);
});

test('daily bar closed check uses 16:00 America/New_York', () => {
  const bar = Date.UTC(2025, 5, 10) / 1000;
  assert.equal(isDailyBarClosed(bar, Date.UTC(2025, 5, 10, 19, 0)), false); // 15:00 ET
  assert.equal(isDailyBarClosed(bar, Date.UTC(2025, 5, 10, 20, 30)), true); // 16:30 ET
  assert.equal(isDailyBarClosed(bar, Date.UTC(2025, 5, 10, 20, 10)), false); // 16:10 ET: final bar not in the free feed yet
  assert.equal(isDailyBarClosed(bar, Date.UTC(2025, 5, 12, 12, 0)), true);
});
