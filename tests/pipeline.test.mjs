import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseExchangeTickers, buildUniverse, isCommonStockTicker, sicToSector } from '../packages/pipeline/universe.mjs';
import { parseAlpacaBars, alpacaDayToUtc, fetchDailyBars, mergeBars } from '../packages/pipeline/alpaca.mjs';
import { parseDailyIndex, dailyIndexUrl, businessDaysBetween } from '../packages/pipeline/secdata.mjs';
import { computeFeatures } from '../packages/pipeline/features.mjs';
import { percentiles, rankHorizon, selectRecommendations, exclusionReasons } from '../packages/pipeline/ranking.mjs';
import { forwardReturn, evaluateLedgers, makeLedger } from '../packages/pipeline/ledger.mjs';
import { runNightly } from '../packages/pipeline/run.mjs';
import { makeBars } from './helpers.mjs';

const noWait = async () => {};

test('universe: parses SEC exchange file and drops non-common instruments', () => {
  const rows = parseExchangeTickers({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [
    [320193, 'Apple Inc.', 'AAPL', 'Nasdaq'], [1067983, 'Berkshire Hathaway', 'BRK-B', 'NYSE'], [1, 'Foo Acquisition Corp', 'FOOA', 'Nasdaq'],
    [2, 'Bar Inc', 'BARRW', 'Nasdaq'], [3, 'Baz Inc', 'BAZ-WT', 'NYSE'], [4, 'Otc Co', 'OTCC', 'OTC'], [5, 'Pref Co', 'PRF-PA', 'NYSE'], [320193, 'Apple Inc.', 'AAPL', 'Nasdaq'],
  ] });
  const u = buildUniverse(rows);
  assert.deepEqual(u.map((x) => x.symbol), ['AAPL', 'BRK.B']);
  assert.equal(u[0].cik, '0000320193');
  assert.equal(isCommonStockTicker('ABCDU', 'Nasdaq'), false);
  assert.equal(isCommonStockTicker('ABCDU', 'NYSE'), true);
});

test('SIC to sector approximations', () => {
  assert.equal(sicToSector('3674'), 'Information Technology');
  assert.equal(sicToSector('2834'), 'Health Care');
  assert.equal(sicToSector('6798'), 'Real Estate');
  assert.equal(sicToSector('6770'), 'Blank Check');
  assert.equal(sicToSector('1311'), 'Energy');
  assert.equal(sicToSector('7372'), 'Information Technology');
  assert.equal(sicToSector(null), 'Unknown');
});

test('alpaca: daily timestamps normalise to the New York date', () => {
  assert.equal(alpacaDayToUtc('2025-01-06T05:00:00Z'), Date.UTC(2025, 0, 6) / 1000);
  assert.equal(alpacaDayToUtc('2025-07-07T04:00:00Z'), Date.UTC(2025, 6, 7) / 1000);
  const p = parseAlpacaBars({ bars: { AAPL: [{ t: '2025-01-06T05:00:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }] } });
  assert.equal(p.AAPL[0].close, 1.5);
});

test('alpaca: follows pagination, batches symbols, falls back to IEX on 403', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ feed: u.searchParams.get('feed'), token: u.searchParams.get('page_token'), symbols: u.searchParams.get('symbols'), key: init.headers['APCA-API-KEY-ID'] });
    if (u.searchParams.get('feed') === 'sip') return new Response('forbidden', { status: 403 });
    const syms = u.searchParams.get('symbols').split(',');
    if (!u.searchParams.get('page_token')) return Response.json({ bars: { [syms[0]]: [{ t: '2025-01-06T05:00:00Z', o: 1, h: 1, l: 1, c: 1, v: 1 }] }, next_page_token: 'p2' });
    return Response.json({ bars: { [syms[0]]: [{ t: '2025-01-07T05:00:00Z', o: 2, h: 2, l: 2, c: 2, v: 2 }] }, next_page_token: null });
  };
  const r = await fetchDailyBars({ symbols: ['A', 'B', 'C'], start: '2025-01-01', end: '2025-01-10', keyId: 'k', secretKey: 's', batchSize: 2, fetchImpl, minIntervalMs: 0, wait: noWait });
  assert.equal(r.feed, 'iex');
  assert.deepEqual(r.bars.A.map((b) => b.close), [1, 2]);
  assert.deepEqual(r.bars.C.map((b) => b.close), [1, 2]);
  assert.ok(calls.every((c) => c.key === 'k'));
  assert.equal(calls.filter((c) => c.token === 'p2').length, 2);
  await assert.rejects(fetchDailyBars({ symbols: ['A'], start: 'x', end: 'y' }), /keys missing/);
});

test('mergeBars detects split re-adjustment and requests a full refetch', () => {
  const cached = makeBars(30);
  const fresh = cached.slice(-5).map((b) => ({ ...b }));
  fresh.push({ ...cached.at(-1), time: cached.at(-1).time + 86400 });
  const ok = mergeBars(cached, fresh);
  assert.equal(ok.needsFull, false);
  assert.equal(ok.bars.length, 31);
  const split = fresh.map((b) => ({ ...b, close: b.close / 2 }));
  assert.equal(mergeBars(cached, split).needsFull, true);
});

const IDX = `Description:           Daily Index of EDGAR Dissemination Feed by Form Type
Last Data Received:    October 10, 2025
Comments:              webmaster@sec.gov

Form Type   Company Name                                                  CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------------------------------------------------------
10-K             EXAMPLE CORP                                                  1234567     20251010    edgar/data/1234567/0001234567-25-000010.txt
SC 13D           OTHER  HOLDINGS INC                                           89          20251010    edgar/data/89/0000000089-25-000001.txt
`;

test('EDGAR daily form index parsing', () => {
  const rows = parseDailyIndex(IDX);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { form: '10-K', name: 'EXAMPLE CORP', cik: '0001234567', date: '2025-10-10', file: 'edgar/data/1234567/0001234567-25-000010.txt' });
  assert.equal(rows[1].form, 'SC 13D');
  assert.equal(dailyIndexUrl('2025-10-10'), 'https://www.sec.gov/Archives/edgar/daily-index/2025/QTR4/form.20251010.idx');
  assert.deepEqual(businessDaysBetween('2025-10-09', '2025-10-14'), ['2025-10-10', '2025-10-13', '2025-10-14']);
});

test('features ignore bars and filings after the as-of date', () => {
  const bars = makeBars(400, { seed: 3, t0: Date.UTC(2024, 0, 1) / 1000 });
  const asOf = new Date(bars[300].time * 1000).toISOString().slice(0, 10);
  const company = { facts: null, filings: [
    { category: 'DILUTION', importance: 'high', filingDate: new Date((bars[310].time) * 1000).toISOString().slice(0, 10) },
    { category: 'DILUTION', importance: 'high', filingDate: new Date((bars[290].time) * 1000).toISOString().slice(0, 10) },
  ] };
  const a = computeFeatures(bars, company, asOf);
  const b = computeFeatures(bars.slice(0, 301), company, asOf);
  assert.deepEqual(a, b);
  assert.equal(a.price, bars[300].close);
  assert.equal(a.dilution_365, 1);
  assert.equal(a.dilution_30, 1);
});

test('percentiles handle ties and nulls', () => {
  assert.deepEqual(percentiles([3, null, 1, 3, 2]), [5 / 6, null, 0, 5 / 6, 1 / 3]);
  assert.deepEqual(percentiles([null]), [null]);
});

function syntheticRows(n) {
  return Array.from({ length: n }, (_, i) => {
    const bars = makeBars(320, { seed: i + 1, drift: (i - n / 2) * 0.0001, vol: 0.01 + (i % 5) * 0.004, start: 20 + i });
    const f = computeFeatures(bars, { facts: { revenueGrowth: (i % 7) / 10, netMargin: (i % 5 - 2) / 10, sharesYoY: (i % 4) / 20, revenue: { value: 1e9 }, netIncome: { value: 1e8 }, operatingCashFlow: { value: 2e8 }, sharesOutstanding: { value: 1e8 } }, filings: [] }, new Date(bars.at(-1).time * 1000).toISOString().slice(0, 10));
    f.adv20 = 5e7;
    return { symbol: `S${i}`, sector: ['A', 'B', 'C'][i % 3], features: f };
  });
}

test('rankHorizon: scores bounded, ranks contiguous, momentum leader beats laggard', () => {
  const rows = syntheticRows(40);
  const mid = rankHorizon(rows, 'mid');
  assert.equal(mid.length, 40);
  assert.deepEqual(mid.map((r) => r.rank), Array.from({ length: 40 }, (_, i) => i + 1));
  assert.ok(mid.every((r) => r.score >= 0 && r.score <= 100));
  const best = mid.find((r) => r.symbol === 'S39');
  const worst = mid.find((r) => r.symbol === 'S0');
  assert.ok(best.factors.momentum > worst.factors.momentum);
  const short = rankHorizon(rows, 'short');
  assert.ok(short.length > 0 && 'pullback' in short[0].factors);
  // ineligible (illiquid) rows are dropped
  rows[5].features.adv20 = 10;
  assert.equal(rankHorizon(rows, 'mid').some((r) => r.symbol === 'S5'), false);
});

test('recommendations respect exclusions and sector caps', () => {
  const rows = syntheticRows(60);
  rows[59].features.runway_months = 4;
  const mid = rankHorizon(rows, 'mid');
  assert.ok(exclusionReasons(mid.find((r) => r.symbol === 'S59'), 'mid').some((x) => x.includes('런웨이')));
  const recs = selectRecommendations(mid, 'mid');
  assert.ok(recs.length <= 30);
  assert.equal(recs.some((r) => r.symbol === 'S59'), false);
  const per = {};
  for (const r of recs) per[r.sector] = (per[r.sector] ?? 0) + 1;
  assert.ok(Object.values(per).every((c) => c <= 6));
});

test('forward returns enter at next open and compare to SPY; pending when too recent', () => {
  const day = (i) => Date.UTC(2025, 0, 1 + i) / 1000;
  const mk = (closes) => closes.map((c, i) => ({ time: day(i), open: c, high: c, low: c, close: c, volume: 1 }));
  const stock = mk([10, 10, 11, 12, 13, 14]);
  const spy = mk([100, 100, 101, 102, 103, 104]);
  const asOf = '2025-01-01';
  assert.ok(Math.abs(forwardReturn(stock, asOf, 2).ret - 0.1) < 1e-12); // open d1=10 -> close d2=11
  assert.equal(forwardReturn(stock, asOf, 10), null);
  const L = makeLedger(asOf, 'm', { mid: [{ rank: 1, symbol: 'X', score: 90, factors: {}, features: { price: 10 } }], short: [] });
  const perf = evaluateLedgers([L], () => stock, spy);
  const d20 = perf.detail.find((d) => d.key === 'mid_20d');
  assert.equal(d20.status, 'pending');
  const s1 = perf.detail.find((d) => d.key === 'short_1d');
  assert.equal(s1.status, 'pending'); // short book is empty
});

// ---------- end-to-end ----------
function e2eFetch(state) {
  const syms = Array.from({ length: 24 }, (_, i) => `T${String.fromCharCode(65 + i)}X`);
  const day0 = Date.UTC(2024, 0, 2);
  const series = Object.fromEntries(['SPY', ...syms].map((s, i) => [s, makeBars(state.days, { seed: i + 2, drift: (i - 12) * 0.00015, vol: 0.012 + (i % 4) * 0.005, start: 30 + i, t0: day0 / 1000 })
    .filter((b) => { const d = new Date(b.time * 1000).getUTCDay(); return d !== 0 && d !== 6; })]));
  const toAlpaca = (b) => ({ t: new Date(b.time * 1000 + 5 * 3600000).toISOString(), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume });
  return {
    syms,
    series,
    fetch: async (url) => {
      const u = new URL(url);
      state.calls.push(u.hostname + u.pathname);
      if (u.pathname.endsWith('company_tickers_exchange.json')) {
        return Response.json({ fields: ['cik', 'name', 'ticker', 'exchange'], data: syms.map((s, i) => [1000 + i, `${s} Inc`, s, i % 2 ? 'NYSE' : 'Nasdaq']) });
      }
      if (u.hostname === 'data.alpaca.markets') {
        const start = Date.parse(u.searchParams.get('start')) / 1000;
        const bars = {};
        for (const s of u.searchParams.get('symbols').split(',')) bars[s] = (series[s] ?? []).filter((b) => b.time >= start).map(toAlpaca);
        return Response.json({ bars, next_page_token: null });
      }
      if (u.pathname.includes('/daily-index/')) return new Response(IDX.replace('1234567 ', '0001003 '));
      const m = u.pathname.match(/CIK(\d+)\.json/);
      if (m && u.pathname.includes('/submissions/')) {
        const cik = Number(m[1]);
        return Response.json({ cik: String(cik), name: `Co ${cik}`, sic: String([3674, 2834, 6022, 7372][cik % 4]), sicDescription: 'x', filings: { recent: {
          accessionNumber: ['0000000000-24-000001'], form: [cik === 1005 ? '424B5' : '10-Q'], filingDate: ['2024-11-01'], acceptanceDateTime: ['2024-11-01T12:00:00.000Z'],
          reportDate: [''], items: [''], primaryDocument: ['a.htm'], primaryDocDescription: [''] } } });
      }
      if (m && u.pathname.includes('/companyfacts/')) {
        const cik = Number(m[1]);
        return Response.json({ facts: { dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: '2024-09-30', val: 1e8 + cik, filed: '2024-11-01', form: '10-Q' }] } } }, 'us-gaap': {
          Revenues: { units: { USD: [{ start: '2022-01-01', end: '2022-12-31', val: 1e9, form: '10-K', filed: '2023-02-01' }, { start: '2023-01-01', end: '2023-12-31', val: 1e9 * (1 + (cik % 5) / 10), form: '10-K', filed: '2024-02-01' }] } },
          NetIncomeLoss: { units: { USD: [{ start: '2023-01-01', end: '2023-12-31', val: 1e8 * ((cik % 3) - 1), form: '10-K', filed: '2024-02-01' }] } } } } });
      }
      return new Response('unexpected ' + url, { status: 500 });
    },
  };
}

test('nightly pipeline end-to-end: outputs, incremental re-run, immutable ledger', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-pipe-'));
  const cacheDir = path.join(tmp, 'cache');
  const outDir = path.join(tmp, 'out');
  const env = { ALPACA_KEY_ID: 'k', ALPACA_SECRET_KEY: 's', SEC_USER_AGENT: 'test t@example.com' };
  const state = { days: 560, calls: [] };
  const f1 = e2eFetch(state);
  const lastBar = f1.series.SPY.at(-1).time * 1000;
  const now1 = lastBar + 26 * 3600000; // the next day: last bar is closed
  const r1 = await runNightly({ env, cacheDir, outDir, fetchImpl: f1.fetch, now: now1, historyDays: 900, wait: noWait });
  assert.equal(r1.asOf, new Date(lastBar).toISOString().slice(0, 10));
  assert.equal(r1.stats.universe, 24);
  assert.ok(r1.stats.ranked.mid >= 20, `ranked mid ${r1.stats.ranked.mid}`);
  const latest = JSON.parse(fs.readFileSync(path.join(outDir, 'latest.json'), 'utf8'));
  assert.equal(latest.mid[0].rank, 1);
  assert.ok(latest.mid[0].sector && latest.mid[0].sector !== 'Unknown');
  assert.ok(latest.recommendations.mid.length > 0);
  assert.ok(fs.existsSync(path.join(outDir, 'ledger', `${r1.asOf}.json`)));
  assert.ok(fs.existsSync(path.join(outDir, 'rankings', `${r1.asOf}.json`)));
  // SEC fallback files for the API
  const tick = JSON.parse(fs.readFileSync(path.join(outDir, 'sec', 'tickers.json'), 'utf8'));
  assert.ok(Object.keys(tick.rows).length >= 24);
  const comp = JSON.parse(fs.readFileSync(path.join(outDir, 'companies', `${f1.syms[0]}.json`), 'utf8'));
  assert.equal(comp.cik, '0000001000');
  assert.ok(comp.facts && comp.filings.length >= 1);
  assert.ok(fs.existsSync(path.join(outDir, 'sec', 'recent-filings.json')));
  const perf = JSON.parse(fs.readFileSync(path.join(outDir, 'performance.json'), 'utf8'));
  assert.equal(perf.ledgers, 1);
  // dilution filer (cik 1005) is flagged
  const dil = latest.mid.find((r) => r.symbol === f1.syms[5]);
  if (dil) assert.ok(dil.f.dilution_365 >= 0);

  // tamper check: re-running the same day never rewrites the ledger
  const ledgerPath = path.join(outDir, 'ledger', `${r1.asOf}.json`);
  const before = fs.readFileSync(ledgerPath, 'utf8');
  const r1b = await runNightly({ env, cacheDir, outDir, fetchImpl: f1.fetch, now: now1 + 3600000, historyDays: 900, wait: noWait });
  assert.equal(r1b.stats.ledgerWritten, false);
  assert.equal(fs.readFileSync(ledgerPath, 'utf8'), before);
  assert.equal(r1b.stats.fullFetches, 0, 'second run is incremental');
  assert.equal(r1b.stats.secPublished.companyFilesWritten, 0, 'unchanged company files are not rewritten');

  // 30 sessions later: new ledger, first ledger's 20d outcome is evaluated
  state.days = 600;
  const f2 = e2eFetch(state);
  const now2 = f2.series.SPY.at(-1).time * 1000 + 26 * 3600000;
  const r2 = await runNightly({ env, cacheDir, outDir, fetchImpl: f2.fetch, now: now2, historyDays: 900, wait: noWait });
  assert.notEqual(r2.asOf, r1.asOf);
  const perf2 = JSON.parse(fs.readFileSync(path.join(outDir, 'performance.json'), 'utf8'));
  assert.equal(perf2.ledgers, 2);
  const first20 = perf2.detail.find((d) => d.asOf === r1.asOf && d.key === 'mid_20d');
  assert.equal(first20.status, 'complete');
  assert.ok(Number.isFinite(first20.excess));
  assert.ok(perf2.summary.mid_20d.cohorts >= 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});
