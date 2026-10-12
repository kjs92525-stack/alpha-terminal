// News tagging, EDGAR current feed parsing, and the /news, /movers, /sec/latest, Alpaca-bars API paths.
// Upstream payloads are synthetic fixtures shaped like the documented responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeadline } from '../packages/analysis/news.mjs';
import { parseCurrentAtom, currentFeedUrl } from '../packages/analysis/sec.mjs';
import { parseSnapshots } from '../apps/api/src/feeds.ts';
import { handle } from '../apps/api/src/handler.ts';

test('headline classifier: tags, sentiment and importance are keyword-traceable', () => {
  const a = classifyHeadline('Crispex Genomics Raises Full-Year Guidance After Strong Quarter');
  assert.ok(a.tags.includes('GUIDANCE'));
  assert.equal(a.sentiment, 'positive');
  assert.deepEqual(a.matched.positive.sort(), ['raises', 'strong']);
  const b = classifyHeadline('Opharma Announces $50 Million Registered Direct Offering With Warrants');
  assert.ok(b.tags.includes('OFFERING'));
  assert.equal(b.sentiment, 'negative');
  assert.ok(b.importance >= 4);
  const c = classifyHeadline('FDA Approves Vitalis Therapy for Rare Disease');
  assert.ok(c.tags.includes('FDA'));
  assert.equal(c.importance, 5);
  assert.equal(classifyHeadline('Company to present at conference').sentiment, 'neutral');
});

const ATOM = `<?xml version="1.0" encoding="ISO-8859-1" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Latest Filings</title>
<entry>
<title>8-K - Example Therapeutics, Inc. (0001234567) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1234567/000123456726000010/0001234567-26-000010-index.htm"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-10-12 &lt;b&gt;AccNo:&lt;/b&gt; 0001234567-26-000010 &lt;b&gt;Size:&lt;/b&gt; 300 KB&lt;br&gt;Item 1.01: Entry into a Material Definitive Agreement&lt;br&gt;Item 9.01: Financial Statements and Exhibits</summary>
<updated>2026-10-12T16:31:05-04:00</updated>
<category scheme="https://www.sec.gov/" label="form type" term="8-K"/>
<id>urn:tag:sec.gov,2008:accession-number=0001234567-26-000010</id>
</entry>
<entry>
<title>4 - Doe Jane (0009999999) (Reporting)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/x"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-10-12</summary>
<updated>2026-10-12T16:00:00-04:00</updated>
</entry>
<entry>
<title>424B5 - Small Cap Co (0000000042) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/y"/>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-10-12 &lt;b&gt;AccNo:&lt;/b&gt; 0000000042-26-000001</summary>
<updated>2026-10-12T08:00:00-04:00</updated>
</entry>
</feed>`;

test('EDGAR current feed: filer entries parsed and classified, reporting owners skipped', () => {
  const rows = parseCurrentAtom(ATOM);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].form, '8-K');
  assert.equal(rows[0].cik, '0001234567');
  assert.equal(rows[0].items, '1.01,9.01');
  assert.equal(rows[0].category, 'CONTRACT');
  assert.equal(rows[0].acceptedAt, '2026-10-12T20:31:05.000Z');
  assert.equal(rows[0].accession, '0001234567-26-000010');
  assert.equal(rows[1].category, 'DILUTION');
  assert.match(currentFeedUrl('SC 13D'), /type=SC%2013D/);
});

test('snapshot parsing supports both response shapes', () => {
  const s = { latestTrade: { p: 110, t: 't' }, dailyBar: { o: 101, h: 112, l: 99, c: 109, v: 5, t: 'd' }, prevDailyBar: { c: 100 } };
  assert.ok(Math.abs(parseSnapshots({ AAA: s }).AAA.changePct - 0.1) < 1e-12);
  assert.equal(parseSnapshots({ snapshots: { BBB: s } }).BBB.dayHigh, 112);
});

const calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ u, key: init?.headers?.['APCA-API-KEY-ID'], ua: init?.headers?.['User-Agent'] });
  if (u.includes('/v1beta1/news')) return Response.json({ news: [
    { id: 1, headline: 'Acme Beats Estimates, Raises Guidance', summary: '', url: 'https://n/1', source: 'benzinga', author: 'x', created_at: '2026-10-12T14:39:00Z', symbols: ['ACME'] },
    { id: 2, headline: 'Biox Announces Proposed Public Offering', summary: '', url: 'https://n/2', source: 'benzinga', author: 'y', created_at: '2026-10-12T14:20:00Z', symbols: ['BIOX'] },
  ] });
  if (u.includes('/v2/stocks/snapshots')) return Response.json({
    ACME: { latestTrade: { p: 55, t: 't' }, dailyBar: { o: 51, h: 56, l: 50, c: 55, v: 1e6, t: 'd' }, prevDailyBar: { c: 50 } },
    BIOX: { latestTrade: { p: 2, t: 't' }, dailyBar: { o: 2.5, h: 2.6, l: 1.9, c: 2, v: 2e6, t: 'd' }, prevDailyBar: { c: 2.5 } },
    ONXZ: { latestTrade: { p: 315, t: 't' }, dailyBar: { o: 260, h: 322, l: 263, c: 315, v: 9e6, t: 'd' }, prevDailyBar: { c: 252 } },
  });
  if (u.includes('/screener/stocks/movers')) return Response.json({ gainers: [{ symbol: 'PENNY', percent_change: 300, change: 0.6, price: 0.8 }, { symbol: 'ONXZ', percent_change: 24.91, change: 62.8, price: 315.38 }], losers: [{ symbol: 'BIOX', percent_change: -20, change: -0.5, price: 2 }], last_updated: '2026-10-12T14:40:00Z' });
  if (u.includes('browse-edgar')) return new Response(ATOM, { headers: { 'Content-Type': 'application/atom+xml' } });
  if (u.includes('company_tickers.json')) return Response.json({ 0: { cik_str: 1234567, ticker: 'EXTX', title: 'Example Therapeutics' } });
  if (u.includes('/v2/stocks/bars')) {
    const tf = new URL(u).searchParams.get('timeframe');
    const sym = new URL(u).searchParams.get('symbols');
    if (tf === '1Day') return Response.json({ bars: { [sym]: Array.from({ length: 30 }, (_, i) => ({ t: new Date(Date.UTC(2025, 0, 2 + i, 5)).toISOString(), o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1000 })) }, next_page_token: null });
    return Response.json({ bars: { [sym]: Array.from({ length: 20 }, (_, i) => ({ t: new Date(Date.UTC(2025, 0, 2, 14, 30 + i * 5)).toISOString(), o: 10, h: 11, l: 9, c: 10.5, v: 100 })) } });
  }
  return new Response('unexpected ' + u, { status: 500 });
};

const env = { ALPACA_KEY_ID: 'kid', ALPACA_SECRET_KEY: 'sec', SEC_USER_AGENT: 'ua t@example.com' };
const get = async (path, e = env) => { const r = await handle(new Request('https://x.test' + path), e); return { status: r.status, body: await r.json() }; };

test('/api/v1/news classifies headlines and attaches quotes', async () => {
  const r = await get('/api/v1/news?limit=10');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2);
  assert.equal(r.body.items[0].sentiment, 'positive');
  assert.ok(r.body.items[1].tags.includes('OFFERING'));
  assert.ok(Math.abs(r.body.quotes.ACME.changePct - 0.1) < 1e-12);
  assert.ok(calls.filter((c) => c.u.includes('alpaca')).every((c) => c.key === 'kid'));
  assert.equal((await get('/api/v1/news', { SEC_USER_AGENT: 'x' })).status, 503);
});

test('/api/v1/movers filters by min price and adds day range', async () => {
  const r = await get('/api/v1/movers?top=5&minPrice=1');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.gainers.map((g) => g.symbol), ['ONXZ']);
  assert.ok(Math.abs(r.body.gainers[0].changePct - (315 / 252 - 1)) < 1e-9, 'change uses snapshot price vs prev close');
  assert.equal(r.body.gainers[0].price, 315);
  assert.equal(r.body.gainers[0].dayHigh, 322);
  assert.equal(r.body.losers[0].symbol, 'BIOX');
});

test('/api/v1/sec/latest merges feeds, dedupes, maps CIK to ticker', async () => {
  const r = await get('/api/v1/sec/latest?limit=20');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2, 'same accession from several type feeds counted once');
  assert.equal(r.body.items[0].ticker, 'EXTX');
  assert.ok(calls.filter((c) => c.u.includes('browse-edgar')).every((c) => c.ua === 'ua t@example.com'));
});

test('Alpaca becomes the first price provider when keys are set', async () => {
  const d = await get('/api/v1/bars/ACME?tf=1D', { ...env, PRICE_PROVIDERS: 'stooq' });
  assert.equal(d.status, 200);
  assert.match(d.body.source, /Alpaca/);
  assert.equal(d.body.bars.length, 30);
  const i = await get('/api/v1/bars/ACME?tf=5m', env);
  assert.equal(i.status, 200);
  assert.match(i.body.source, /15분 지연/);
  const h = await get('/api/v1/health');
  assert.equal(h.body.alpaca, true);
  assert.equal(h.body.priceProviders[0], 'alpaca');
});
