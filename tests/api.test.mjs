// Offline end-to-end test of the API handler with upstream fetch mocked.
// Upstream payloads are synthetic but follow the official response formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../apps/api/src/handler.ts';
import { makeBars } from './helpers.mjs';

const bars = makeBars(400, { seed: 21, drift: 0.001, t0: Date.UTC(2024, 0, 2) / 1000 });
const csv = 'Date,Open,High,Low,Close,Volume\n' + bars.map((b) => `${new Date(b.time * 1000).toISOString().slice(0, 10)},${b.open},${b.high},${b.low},${b.close},${b.volume}`).join('\n');

const tickers = { 0: { cik_str: 1234567, ticker: 'TEST', title: 'Test Co' } };
const submissions = {
  cik: '1234567', name: 'TEST CO', tickers: ['TEST'], sicDescription: 'Services',
  filings: { recent: {
    accessionNumber: ['0001234567-25-000002', '0001234567-25-000001'], form: ['8-K', 'S-3'],
    filingDate: ['2025-01-10', '2024-12-01'], acceptanceDateTime: ['2025-01-10T21:05:00.000Z', '2024-12-01T12:00:00.000Z'],
    reportDate: ['2025-01-10', ''], items: ['2.02,9.01', ''], primaryDocument: ['a.htm', 'b.htm'], primaryDocDescription: ['8-K', 'S-3'],
  } },
};
const facts = { entityName: 'TEST CO', facts: { dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2025-01-31', val: 5e7, filed: '2025-02-01', form: '10-K' }] } } }, 'us-gaap': {
  Revenues: { units: { USD: [
    { start: '2023-01-01', end: '2023-12-31', val: 8e7, form: '10-K', filed: '2024-02-01' },
    { start: '2024-01-01', end: '2024-12-31', val: 1e8, form: '10-K', filed: '2025-02-01' }] } },
} } };

const calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ u, ua: init?.headers?.['User-Agent'] });
  if (u.includes('company_tickers.json')) return Response.json(tickers);
  if (u.includes('/submissions/CIK0001234567')) return Response.json(submissions);
  if (u.includes('/companyfacts/CIK0001234567')) return Response.json(facts);
  if (u.includes('/submissions/') || u.includes('/companyfacts/')) return new Response('nf', { status: 404 });
  if (u.includes('stooq.com') && u.includes('s=test.us')) return new Response(csv, { headers: { 'Content-Type': 'text/csv' } });
  if (u.includes('stooq.com')) return new Response('No data');
  if (u.includes('yahoo')) return new Response('blocked', { status: 429 });
  if (u.includes('api.fda.gov')) return Response.json({ results: [{ application_number: 'NDA000001', sponsor_name: 'TEST', openfda: { brand_name: ['TESTDRUG'] }, submissions: [{ submission_type: 'ORIG', submission_number: '1', submission_status: 'AP', submission_status_date: '20240115' }] }] });
  return new Response('unexpected', { status: 500 });
};

const env = { SEC_USER_AGENT: 'AlphaTerminal-test test@example.com', PRICE_PROVIDERS: 'stooq,yahoo', ALLOWED_ORIGIN: '*' };
const get = async (path, e = env) => { const r = await handle(new Request('https://x.test' + path), e); return { status: r.status, body: await r.json(), headers: r.headers }; };

test('health reports configuration without secrets', async () => {
  const r = await get('/api/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.secConfigured, true);
  assert.equal(JSON.stringify(r.body).includes('test@example.com'), false);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
});

test('SEC routes refuse to run without a User-Agent', async () => {
  const r = await get('/api/v1/sec/filings/320193', {});
  assert.equal(r.status, 503);
});

test('filings by ticker resolve via SEC map and send the User-Agent', async () => {
  const r = await get('/api/v1/sec/filings/TEST?limit=5');
  assert.equal(r.status, 200);
  assert.equal(r.body.cik, '0001234567');
  assert.equal(r.body.filings[0].category, 'EARNINGS');
  assert.ok(r.body.fetchedAt);
  assert.ok(calls.filter((c) => c.u.includes('sec.gov')).every((c) => c.ua === env.SEC_USER_AGENT));
});

test('bars endpoint returns provider metadata and closed-bar flag', async () => {
  const r = await get('/api/v1/bars/TEST?tf=1D');
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'Stooq EOD');
  assert.equal(r.body.bars.length, 400);
  assert.equal(r.body.lastBarClosed, true);
  const w = await get('/api/v1/bars/TEST?tf=1W');
  assert.ok(w.body.bars.length < 100);
});

test('bars endpoint validates input and surfaces provider failures', async () => {
  assert.equal((await get('/api/v1/bars/bad$sym')).status, 400);
  assert.equal((await get('/api/v1/bars/TEST?tf=3D')).status, 400);
  const r = await get('/api/v1/bars/NODATA');
  assert.equal(r.status, 502);
  assert.match(r.body.detail, /stooq/);
  assert.match(r.body.detail, /yahoo/);
});

test('analyze combines prices, SEC filings and XBRL facts with sources', async () => {
  const r = await get('/api/v1/analyze/TEST');
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Test Co');
  assert.ok(r.body.score.score >= 0 && r.body.score.score <= 100);
  assert.equal(r.body.score.metrics.dilutionFilings365d, 1); // S-3 filed within 365d of the last bar
  assert.ok(Math.abs(r.body.fundamentals.revenueGrowth - 0.25) < 1e-9);
  assert.ok(r.body.sources.prices.fetchedAt && r.body.sources.filings.fetchedAt);
  assert.deepEqual(r.body.warnings, []);
});

test('screen ranks symbols and isolates per-symbol errors', async () => {
  const r = await get('/api/v1/screen?symbols=TEST,NODATA');
  assert.equal(r.status, 200);
  assert.equal(r.body.results[0].symbol, 'TEST');
  assert.equal(r.body.results[0].rank, 1);
  assert.ok(r.body.results[1].error);
});

test('fda endpoint normalises submission dates', async () => {
  const r = await get('/api/v1/fda?q=test');
  assert.equal(r.body.results[0].statusDate, '2024-01-15');
  assert.equal((await get('/api/v1/fda?q=%22')).status, 400);
});

test('unknown routes 404', async () => {
  assert.equal((await get('/api/v1/nope')).status, 404);
});
