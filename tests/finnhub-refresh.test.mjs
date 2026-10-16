import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshAfterEarnings } from '../packages/pipeline/finnhub.mjs';

const rec = (filed, fetchedAt) => ({ fetchedAt, facts: { revenueQuarterly: [{ end: '2026-03-31', value: 1, filed: '2026-05-08' }, { end: '2026-06-30', value: 1, filed }] } });
const now = Date.parse('2026-10-16T22:00:00Z');

test('companies that reported but whose cached record predates the report are refetched first', () => {
  const records = new Map([
    ['NEW', rec('2026-08-07', '2026-10-01T00:00:00Z')],   // reported 10-10, no newer filing → due
    ['DONE', rec('2026-10-12', '2026-10-13T00:00:00Z')],  // 10-Q already in the record
    ['RECENT', rec('2026-08-07', '2026-10-15T23:00:00Z')], // tried yesterday → wait for retry window
    ['OLD', rec('2026-08-07', '2026-10-01T00:00:00Z')],   // reported long ago → normal refresh
    ['NONE', rec('2026-08-07', '2026-10-01T00:00:00Z')],  // not in the calendar
  ]);
  const reported = new Map([['NEW', { date: '2026-10-10' }], ['DONE', { date: '2026-10-09' }], ['RECENT', { date: '2026-10-11' }], ['OLD', { date: '2026-08-01' }]]);
  assert.deepEqual(refreshAfterEarnings(records, reported, '2026-10-16', { now }), ['NEW']);
  // a future date (calendar estimate) is not a report yet
  assert.deepEqual(refreshAfterEarnings(records, new Map([['NEW', { date: '2026-10-20' }]]), '2026-10-16', { now }), []);
});
