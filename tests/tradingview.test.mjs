// TradingView webhook: auth, parsing, dedupe, background enrichment, Telegram, listing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../apps/api/src/handler.ts';
import { normalizeTvSymbol, buildEnrichment, telegramText } from '../apps/api/src/tradingview.ts';
import { makeBars } from './helpers.mjs';

class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, v); }
  async list({ prefix, limit }) { return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name })) }; }
}

const today = new Date().toISOString().slice(0, 10);
const bars = makeBars(300, { seed: 8, t0: Math.floor(Date.now() / 1000 / 86400) * 86400 - 320 * 86400 });
const csv = 'Date,Open,High,Low,Close,Volume\n' + bars.map((b) => `${new Date(b.time * 1000).toISOString().slice(0, 10)},${b.open},${b.high},${b.low},${b.close},${b.volume}`).join('\n');
const submissions = { cik: '1', name: 'TEST CO', tickers: ['TEST'], filings: { recent: {
  accessionNumber: ['0000000001-26-000001'], form: ['424B5'], filingDate: [today], acceptanceDateTime: [`${today}T12:00:00.000Z`],
  reportDate: [''], items: [''], primaryDocument: ['p.htm'], primaryDocDescription: ['424B5'] } } };

let telegram = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.telegram.org')) { telegram.push(JSON.parse(init.body)); return Response.json({ ok: true }); }
  if (u.includes('company_tickers')) return Response.json({ 0: { cik_str: 1, ticker: 'TEST', title: 'Test Co' } });
  if (u.includes('/submissions/')) return Response.json(submissions);
  if (u.includes('/companyfacts/')) return new Response('nf', { status: 404 });
  if (u.includes('stooq.com')) return new Response(u.includes('s=test.us') ? csv : 'No data');
  return new Response('x', { status: 500 });
};

const mkEnv = () => ({ SEC_USER_AGENT: 'ua test@example.com', TV_WEBHOOK_SECRET: 's3cret', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '42', ALERTS: new FakeKV() });
const post = async (env, body, query = '', ctx) => {
  const r = await handle(new Request(`https://x.test/api/v1/tv/webhook${query}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), env, ctx);
  return { status: r.status, body: await r.json() };
};

test('symbol normalisation', () => {
  assert.equal(normalizeTvSymbol('NASDAQ:aapl'), 'AAPL');
  assert.equal(normalizeTvSymbol('BRK.B'), 'BRK.B');
  assert.equal(normalizeTvSymbol('BINANCE:BTC/USDT'), null);
});

test('rejects missing or wrong secret, and refuses when not configured', async () => {
  assert.equal((await post(mkEnv(), { symbol: 'TEST' })).status, 401);
  assert.equal((await post(mkEnv(), { secret: 'nope', symbol: 'TEST' })).status, 401);
  assert.equal((await post({}, { secret: 'x', symbol: 'TEST' })).status, 503);
  const r = await handle(new Request('https://x.test/api/v1/tv/webhook'), mkEnv());
  assert.equal(r.status, 405);
});

test('accepts JSON alert, enriches in background, sends Telegram, stores, dedupes', async () => {
  telegram = [];
  const env = mkEnv();
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const body = { secret: 's3cret', symbol: 'NASDAQ:TEST', signal: 'BOS_BULL', interval: '60', price: 12.3, level: 12.1, bar_time: 1760000000000 };
  const r = await post(env, body, '', ctx);
  assert.equal(r.status, 200);
  assert.equal(r.body.symbol, 'TEST');
  assert.equal(r.body.duplicate, false);
  assert.equal(pending.length, 1, 'enrichment deferred so TradingView gets a fast response');
  await Promise.all(pending);
  assert.equal(telegram.length, 1);
  assert.equal(telegram[0].chat_id, '42');
  assert.match(telegram[0].text, /TEST/);
  assert.match(telegram[0].text, /희석 공시 424B5/);
  assert.doesNotMatch(telegram[0].text, /s3cret/);
  const again = await post(env, body, '', ctx);
  assert.equal(again.body.duplicate, true);
  // listing requires the key
  const denied = await handle(new Request('https://x.test/api/v1/tv/alerts'), env);
  assert.equal(denied.status, 401);
  const list = await (await handle(new Request('https://x.test/api/v1/tv/alerts', { headers: { 'X-Alpha-Key': 's3cret' } }), env)).json();
  assert.equal(list.alerts.length, 1);
  assert.equal(list.alerts[0].telegram, 'sent');
  assert.ok(list.alerts[0].enrichment.flags.some((f) => f.text.includes('424B5')));
  assert.equal(JSON.stringify(list).includes('s3cret'), false, 'secret is never stored');
});

test('plain-text alert with key in URL', async () => {
  const env = mkEnv();
  const r = await post(env, 'TEST crossed above VWAP', '?key=s3cret');
  assert.equal(r.status, 200);
  assert.equal(r.body.symbol, 'TEST');
});

test('enrichment failure is reported, not fatal', async () => {
  telegram = [];
  const env = { ...mkEnv(), SEC_USER_AGENT: 'ua x@y.z' };
  const r = await post(env, { secret: 's3cret', symbol: 'NOPE', signal: 'X' });
  assert.equal(r.status, 200);
  assert.match(telegram[0].text, /맥락 분석 실패/);
});

test('enrichment flags map to filings and metrics', () => {
  const now = Date.parse('2026-10-12T00:00:00Z');
  const e = buildEnrichment({
    name: 'X', score: { score: 40, rating: '중립', riskLevel: 'HIGH', metrics: { price: 5, runwayMonths: 7, dilutionFilings365d: 1 }, scenarios: { nearestSupport: 4.5, nearestResistance: 5.5 } },
    filings: [
      { form: 'S-3', filingDate: '2026-09-01', category: 'DILUTION', importance: 'high', label: '증권 발행 등록', url: 'u1' },
      { form: '8-K', filingDate: '2026-10-10', category: 'EARNINGS', importance: 'high', label: '실적 발표', url: 'u2' },
      { form: 'S-3', filingDate: '2025-01-01', category: 'DILUTION', importance: 'high', label: 'old', url: 'u3' },
    ],
  }, now);
  const texts = e.flags.map((f) => f.text).join('\n');
  assert.match(texts, /S-3 \(2026-09-01\)/);
  assert.doesNotMatch(texts, /old/);
  assert.match(texts, /런웨이 약 7개월/);
  assert.match(texts, /실적 발표 직후/);
  assert.match(texts, /HIGH/);
  assert.match(telegramText({ symbol: 'X', signal: '<b>', interval: null, price: 1, level: null, message: null, enrichment: e }), /&lt;b&gt;/);
});

test('flags a price mismatch between the alert and ALPHA data', () => {
  const a = { name: 'X', score: { score: 50, rating: '중립', riskLevel: 'LOW', metrics: { price: 100, runwayMonths: null, dilutionFilings365d: 0 }, scenarios: null }, filings: [] };
  assert.match(buildEnrichment(a, Date.now(), 8.2).flags[0].text, /가격 불일치/);
  assert.equal(buildEnrichment(a, Date.now(), 101).flags.length, 0);
});
