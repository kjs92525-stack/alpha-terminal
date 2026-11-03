import test from 'node:test';
import assert from 'node:assert/strict';
import { extendWithFallback, fetchIndexFallback } from '../packages/pipeline/market-brief.mjs';

const t = (d) => Date.parse(d) / 1000;
const fred = [['2026-10-27', 100], ['2026-10-28', 101], ['2026-10-29', 102]].map(([d, close]) => ({ time: t(d), close }));

test('late FRED series is extended with agreeing fallback closes, rejected when they disagree', () => {
  const ok = { bars: [...fred.slice(1), { time: t('2026-10-30'), close: 103 }, { time: t('2026-11-02'), close: 104 }], source: 'Yahoo Finance' };
  const x = extendWithFallback(fred, ok);
  assert.equal(x.added, 2);
  assert.equal(x.bars.at(-1).close, 104);
  const bad = { bars: [{ time: t('2026-10-29'), close: 110 }, { time: t('2026-10-30'), close: 111 }] };
  assert.equal(extendWithFallback(fred, bad).added, 0, 'more than 0.5% apart on an overlapping day');
  assert.equal(extendWithFallback(fred, { bars: [{ time: t('2026-10-30'), close: 103 }] }).added, 0, 'no overlap to check against');
});

test('fallback tries Yahoo then Stooq and keeps only dates up to asOf', async () => {
  const stooq = 'Date,Open,High,Low,Close,Volume\n2026-10-30,1,1,1,18.5,0\n2026-11-02,1,1,1,19.1,0\n2026-11-03,1,1,1,20,0\n';
  const fetchImpl = async (url) => (String(url).includes('yahoo') ? new Response('no', { status: 429 }) : new Response(stooq));
  const r = await fetchIndexFallback('VIX', { asOf: '2026-11-02', fetchImpl });
  assert.equal(r.source, 'Stooq');
  assert.equal(r.bars.at(-1).close, 19.1);
});
