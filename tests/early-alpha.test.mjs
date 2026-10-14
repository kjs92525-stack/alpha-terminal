import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { earlyEligibility, scoreEarlyAlpha, earlyFacts, EARLY_MODEL } from '../packages/analysis/early-alpha.mjs';
import { earlyOutcome, publishEarlyAlpha, runEarlyAlpha, fetchEarlyNews } from '../packages/pipeline/early-alpha.mjs';
const DAY = 86400000;
const asOf = '2026-10-12';
const end = Date.parse(asOf) / 1000;
const bars = Array.from({ length: 260 }, (_, i) => ({ time: end - (259 - i) * 86400, open: 10, close: 10, high: i < 180 ? 20 : 10.1, low: 9.5, volume: i >= 239 ? 100000 : 200000 }));
const point = (end, value, filed = end) => ({ end, value, filed, form: '10-Q' });
const company = {
  cik: '0000001234', source: 'SEC', fetchedAt: '2026-10-12T22:00:00Z', filings: [], facts: {
    sharesOutstanding: point('2026-09-30', 50000000, '2026-10-10'), sharesYoY: 0,
    revenue: point('2026-06-30', 200000000, '2026-08-01'),
    cash: point('2026-06-30', 100000000, '2026-08-01'), operatingCashFlow: point('2026-06-30', -20000000, '2026-08-01'),
    revenueQuarterly: [point('2025-03-31', 30e6), point('2025-06-30', 30e6), point('2026-03-31', 33e6), point('2026-06-30', 45e6)],
    netIncomeQuarterly: [point('2025-06-30', -10e6), point('2026-06-30', 2e6)],
  },
};
const row = { symbol: 'EARL', ticker: 'EARL', name: 'Early company', sector: 'Industrials' };
const score = (options = {}) => scoreEarlyAlpha({ row, company, bars, asOf, newsStatus: 'ok', ...options });

test('independent early business inflection scores, evidence, cap and transparency', () => {
  const r = score();
  assert.equal(r.model, EARLY_MODEL);
  assert.equal(r.status, 'candidate');
  assert.equal(r.marketCap, 500e6);
  assert.equal(r.components.growth, 30); assert.equal(r.components.profitability, 25);
  assert.equal(r.components.neglect, 15); assert.equal(r.components.value, 10); assert.equal(r.components.base, 10);
  assert.equal(r.score, 90);
  assert.ok(r.evidence.every((e) => e.url && e.publishedAt));
  assert.equal(r.risk.runwayMonths, 60);
  assert.ok(r.warnings.some((w) => /ATM/.test(w)));
});

test('already-rallied pullbacks, microcaps, SPACs, illiquidity and stale prices excluded', () => {
  const rallied = bars.map((b, i) => ({ ...b, close: i < 239 ? 10 : 18, high: 30 }));
  assert.ok(score({ bars: rallied }).excluded.some((s) => /급등/.test(s)));
  assert.equal(score({ bars: rallied }).status, 'excluded');
  assert.equal(score({ row: { ...row, sector: 'Blank Check' } }).status, 'excluded');
  assert.equal(score({ bars: bars.map((b) => ({ ...b, volume: 1 })) }).status, 'excluded');
  assert.ok(earlyEligibility(row, { ...company, facts: { ...company.facts, sharesOutstanding: point('2026-09-30', 1e6) } }, bars, asOf).excluded.some((s) => /범위/.test(s)));
  assert.equal(score({ bars: bars.slice(0, -10) }).status, 'excluded');
});

test('future bars, filed facts, news, and accepted filings do not leak into score', () => {
  const future = '2026-10-13';
  const c = structuredClone(company);
  c.facts.revenueQuarterly.push(point('2026-09-30', 1000e6, future));
  c.facts.netIncomeQuarterly.push(point('2026-09-30', 100e6, future));
  c.filings.push({ category: 'DILUTION', importance: 'high', filingDate: asOf, acceptedAt: `${future}T01:00:00Z` });
  const r = score({ company: c, bars: [...bars, { ...bars[0], time: end + 86400, close: 1000 }], news: [{ time: future, headline: 'Company wins supply contract', url: 'https://example.com/future' }] });
  assert.deepEqual(r, score());
  assert.equal(earlyFacts({ facts: { sharesOutstanding: point('2026-09-30', 1e8, future) } }, asOf).shares, null);
});

test('LOI, MOU, cancelled, planned, invalid-link and duplicated catalysts cannot inflate score', () => {
  const news = (headline, url = 'https://example.com/press') => ({ headline, url, time: asOf });
  for (const h of ['Company signs non-binding LOI for supply contract', 'Company plans to launch first commercial product', 'Company wins contract cancelled by customer', 'Company wins no contract']) {
    assert.equal(score({ news: [news(h)] }).components.catalyst, 0, h);
  }
  assert.equal(score({ news: [news('Company wins supply contract', 'javascript:alert(1)')] }).components.catalyst, 0);
  const item = news('Company wins supply contract');
  assert.equal(score({ news: [item, item, { ...item, url: 'https://example.com/syndicated' }] }).components.catalyst, 10);
  assert.equal(score({ news: [item] }).score, 100);
  assert.ok(score({ news: [item] }).evidence.some((e) => e.confidence === 'headline_only'));
});

test('shelf is flagged without treating it as completed issuance; severe runway/distress excluded', () => {
  const c = structuredClone(company);
  c.filings = [{ category: 'DILUTION', importance: 'high', form: 'S-3', filingDate: '2026-09-15', url: 'https://www.sec.gov/test' }];
  const r = score({ company: c });
  assert.equal(r.risk.level, 'high'); assert.equal(r.components.penalty, -15);
  assert.ok(r.reasons.some((s) => /발행 확정 아님/.test(s.text)));
  c.facts.cash.value = 1e6;
  assert.equal(score({ company: c }).status, 'excluded');
  c.filings = [{ category: 'DISTRESS', importance: 'critical', filingDate: asOf }];
  assert.equal(score({ company: c }).status, 'excluded');
});

test('missing quarter, missing filings and failed news are explicit watch, never safe defaults', () => {
  assert.equal(score({ newsStatus: 'error' }).status, 'watch');
  assert.equal(score({ company: { ...company, source: 'Finnhub' } }).risk.checked, false);
  assert.equal(score({ company: { ...company, facts: {} } }).status, 'excluded');
  assert.equal(score({ company: { ...company, facts: { ...company.facts, netIncomeQuarterly: [], revenueQuarterly: [] } } }).status, 'excluded');
});

const sessions = Array.from({ length: 150 }, (_, i) => ({ time: end + i * 86400, open: i === 1 ? 10 : 11, close: i === 0 ? 10 : 12, high: 13, low: 8, volume: 1 }));
const spy = sessions.map((b) => ({ ...b, open: 100, close: 110 }));
test('tracking enters next open, counts benchmark sessions, MFE/MAE, pending and missing', () => {
  const r = earlyOutcome({ symbol: 'EARL', asOf }, () => sessions, spy, '2027-03-01', 21);
  assert.equal(r.entryDate, '2026-10-13'); assert.equal(r.exitDate, '2026-11-02');
  assert.ok(Math.abs(r.return - 0.2) < 1e-12); assert.ok(Math.abs(r.excess - 0.1) < 1e-12);
  assert.ok(Math.abs(r.mfe - 0.3) < 1e-12); assert.ok(Math.abs(r.mae + 0.2) < 1e-12);
  assert.equal(earlyOutcome({ symbol: 'EARL', asOf }, () => sessions, spy, asOf, 21).status, 'pending');
  assert.equal(earlyOutcome({ symbol: 'EARL', asOf }, () => sessions.filter((_, i) => i !== 10), spy, '2027-03-01', 21).status, 'missing');
});

test('daily immutable snapshots, first discovery, no duplicated cohorts; missing retained in denominator', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'early-ledger-'));
  try {
    const args = { outDir: dir, asOf, generatedAt: `${asOf}T22:00:00Z`, getBars: () => sessions, spyBars: spy };
    const day1 = publishEarlyAlpha({ ...args, candidates: [score()] });
    assert.equal(day1.candidates[0].isNew, true);
    const file = path.join(dir, 'early-alpha', 'ledger', `${asOf}.json`); const before = fs.readFileSync(file, 'utf8');
    const rerun = publishEarlyAlpha({ ...args, candidates: [{ ...score(), score: 1 }] });
    assert.equal(fs.readFileSync(file, 'utf8'), before); assert.equal(rerun.candidates[0].score, 90);
    const day2 = publishEarlyAlpha({ ...args, asOf: '2027-03-01', getBars: () => [], candidates: [score()] });
    assert.equal(day2.candidates[0].isNew, false); assert.equal(day2.candidates[0].firstSeen, asOf);
    assert.equal(day2.performance.discoveries.length, 1);
    assert.equal(day2.performance.summary[21].total, 1); assert.equal(day2.performance.summary[21].missing, 1);
    assert.equal(day2.performance.summary[21].meanReturn, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('independent pipeline news budget, failure state and no setup prerequisite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'early-run-'));
  try {
    const rows = [row, { ...row, symbol: 'ZZZ' }];
    let calls = 0;
    const r = await runEarlyAlpha({ rows, companyBy: new Map(rows.map((r) => [r.symbol, company])), getBars: () => bars, spyBars: bars, asOf, now: Date.parse(asOf), outDir: dir,
      env: { ALPACA_KEY_ID: 'test', ALPACA_SECRET_KEY: 'test', EARLY_NEWS_MAX: '1' }, wait: async () => {},
      fetchImpl: async () => { calls++; return Response.json({ news: [], next_page_token: null }); } });
    assert.equal(calls, 1); assert.equal(r.stats.newsRequests, 1); assert.equal(r.candidates.length, 2);
    assert.equal(r.candidates.find((r) => r.symbol === 'EARL').status, 'candidate');
    assert.equal(r.candidates.find((r) => r.symbol === 'ZZZ').status, 'watch');
    const fail = await runEarlyAlpha({ rows, companyBy: new Map(rows.map((r) => [r.symbol, company])), getBars: () => bars, spyBars: bars, asOf: '2026-10-13', now: Date.parse(asOf) + DAY, outDir: dir,
      env: { ALPACA_KEY_ID: 'test', ALPACA_SECRET_KEY: 'test', EARLY_NEWS_MAX: '1' }, wait: async () => {}, fetchImpl: async () => new Response('', { status: 401 }) });
    assert.equal(fail.stats.newsFailures, 1);
    assert.ok(fail.candidates.every((r) => r.status !== 'candidate'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('news pagination is bounded and its end excludes future coverage; incomplete scan stays watch', async () => {
  let calls = 0;
  const r = await fetchEarlyNews({ symbol: 'EARL', asOf, env: {}, wait: async () => {}, fetchImpl: async (url) => {
    calls++;
    const u = new URL(url);
    assert.equal(u.searchParams.get('end'), '2026-10-12T23:59:59.999Z');
    assert.equal(u.searchParams.get('limit'), '50', 'Alpaca News maximum page size is 50');
    if (calls > 1) assert.equal(u.searchParams.get('page_token'), `page${calls}`);
    return Response.json({ news: [{ created_at: asOf, headline: 'Company wins supply contract', url: 'https://example.com/news' }], next_page_token: `page${calls + 1}` });
  } });
  assert.equal(calls, 5); assert.equal(r.status, 'truncated');
  assert.equal(score({ news: r.news, newsStatus: r.status }).status, 'watch');
});

test('unknown or stale cash safety cannot be promoted to candidate', () => {
  const c = structuredClone(company); delete c.facts.cash; delete c.facts.operatingCashFlow;
  assert.equal(score({ company: c }).status, 'watch');
  c.facts.cash = point('2023-12-31', 1e9, '2024-02-01'); c.facts.operatingCashFlow = point('2023-12-31', 1e9, '2024-02-01');
  assert.equal(score({ company: c }).status, 'watch');
});


test('dated Finnhub profile size can screen watch candidates when SEC is unavailable', () => {
  const c = structuredClone(company); c.source = 'Finnhub';
  c.facts.sharesOutstanding = { value: 50e6, form: 'profile', filed: null, end: '2099-01-01' };
  const r = score({ company: c });
  assert.equal(r.marketCap, 500e6); assert.equal(r.capBasis, 'vendor_profile');
  assert.equal(r.status, 'watch'); assert.equal(r.risk.checked, false);
  assert.ok(r.warnings.some((w) => /프로필 추정치/.test(w)));
  // Collection time, not the regenerated profile end date, controls visibility.
  c.fetchedAt = '2026-10-13T01:00:00Z';
  assert.equal(score({ company: c }).status, 'excluded');
  c.fetchedAt = '2026-08-01T01:00:00Z';
  assert.equal(score({ company: c }).status, 'excluded');
});


test('successful same-day news retry enriches evidence without rewriting scores or discovery history', () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'early-news-retry-'));
 try {
  const args = { outDir: dir, asOf, generatedAt: asOf, getBars: () => bars, spyBars: bars };
  const frozen = score({ newsStatus: 'error' });
  publishEarlyAlpha({ ...args, candidates: [frozen], stats: { newsRequests: 1, newsFailures: 1 } });
  const file = path.join(dir, 'early-alpha', 'ledger', `${asOf}.json`); const before = fs.readFileSync(file, 'utf8');
  const fresh = score({ news: [{ time: asOf, headline: 'Company wins supply contract', url: 'https://example.com/contract' }] });
  const latest = publishEarlyAlpha({ ...args, candidates: [fresh], stats: { newsRequests: 1, newsFailures: 0 } });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(latest.candidates[0].score, frozen.score); assert.equal(latest.candidates[0].status, 'watch');
  assert.equal(latest.candidates[0].enrichmentStatus, 'ok');
  assert.ok(latest.candidates[0].evidence.some((e) => e.kind === 'catalyst'));
  assert.equal(latest.enrichment.newsFailures, 0); assert.equal(latest.stats.newsFailures, 1);
  assert.equal(latest.performance.discoveries.length, 0);
 } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});
