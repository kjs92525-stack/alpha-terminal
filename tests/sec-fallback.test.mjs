// SEC answers 403 to Cloudflare Workers in production. The API must keep working:
// price analysis always, SEC data from the nightly snapshot on the data branch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../apps/api/src/handler.ts';
import { makeBars } from './helpers.mjs';

const SNAP = 'https://snap.test/data';
const bars = makeBars(320, { seed: 5, t0: Date.UTC(2024, 0, 2) / 1000 });
const csv = 'Date,Open,High,Low,Close,Volume\n' + bars.map((b) => `${new Date(b.time * 1000).toISOString().slice(0, 10)},${b.open},${b.high},${b.low},${b.close},${b.volume}`).join('\n');
const company = {
  symbol: 'TEST', cik: '0000001234', name: 'Test Co (snapshot)', sic: '7372', sicDescription: 'Software', fetchedAt: '2026-10-12T23:00:00.000Z',
  filings: [{ accession: 'a1', form: '424B5', filingDate: '2026-10-10', acceptedAt: '2026-10-10T12:00:00.000Z', items: '', url: 'https://www.sec.gov/x', label: '발행 설명서', category: 'DILUTION', importance: 'high' }],
  facts: { revenueGrowth: 0.2, netMargin: 0.1, sharesOutstanding: { value: 1e8, end: '2026-06-30', filed: '2026-08-01', form: '10-Q' }, revenue: { value: 5e8, end: '2025-12-31', filed: '2026-02-01', form: '10-K' } },
};
let snapshotUp = true;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('sec.gov')) return new Response('Forbidden', { status: 403 });
  if (u.startsWith(SNAP)) {
    if (!snapshotUp) return new Response('nf', { status: 404 });
    if (u.endsWith('/sec/tickers.json')) return Response.json({ rows: { TEST: ['0000001234', 'Test Co'] } });
    if (u.endsWith('/companies/TEST.json')) return Response.json(company);
    if (u.endsWith('/sec/recent-filings.json')) return Response.json({ generatedAt: '2026-10-12T23:00:00.000Z', items: [{ ...company.filings[0], company: 'Test Co', cik: '0000001234', ticker: 'TEST' }] });
    return new Response('nf', { status: 404 });
  }
  if (u.includes('stooq.com')) return new Response(csv);
  return new Response('x', { status: 500 });
};

const env = { SEC_USER_AGENT: 'AlphaTerminal/0.6 test@example.com', SNAPSHOT_BASE_URL: SNAP, PRICE_PROVIDERS: 'stooq' };
const get = async (p) => { const r = await handle(new Request('https://x.test' + p), env); return { status: r.status, body: await r.json() }; };

test('analyze falls back to the nightly SEC snapshot when SEC returns 403', async () => {
  snapshotUp = true;
  const r = await get('/api/v1/analyze/TEST');
  assert.equal(r.status, 200);
  assert.equal(r.body.cik, '0000001234');
  assert.equal(r.body.filings[0].form, '424B5');
  assert.match(r.body.sources.filings.name, /야간 수집본/);
  assert.match(r.body.sources.fundamentals.name, /야간 수집본/);
  assert.ok(r.body.warnings.some((w) => w.includes('야간 수집본')));
  assert.equal(r.body.score.metrics.dilutionFilings365d, 0, 'filing dated after the last bar is not counted (no look-ahead)');
});

test('filings and latest-filings routes use the snapshot when SEC refuses', async () => {
  snapshotUp = true;
  const f = await get('/api/v1/sec/filings/TEST');
  assert.equal(f.status, 200);
  assert.match(f.body.source, /야간 수집본/);
  const l = await get('/api/v1/sec/latest');
  assert.equal(l.status, 200);
  assert.match(l.body.source, /실시간 아님/);
  assert.equal(l.body.items[0].ticker, 'TEST');
});

test('with SEC blocked and no snapshot, analysis still returns price-based scores', async () => {
  snapshotUp = false;
  const r = await handle(new Request('https://x.test/api/v1/analyze/ZZZ'), { ...env });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.cik, null);
  assert.ok(body.score.score !== null);
  assert.ok(body.warnings.some((w) => w.includes('재무·공시') ), 'states that SEC data is excluded');
  const l = await get('/api/v1/sec/latest');
  assert.equal(l.status, 502);
  assert.match(l.body.error, /거부/);
});
