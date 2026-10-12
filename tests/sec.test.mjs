import test from 'node:test';
import assert from 'node:assert/strict';
import { padCik, filingUrl, classifyFiling, parseFilings, dilutionSignals, summarizeFacts, searchTickers } from '../packages/analysis/sec.mjs';

// Structure mirrors data.sec.gov submissions JSON; values are synthetic test fixtures.
const submissions = {
  cik: '1234567', name: 'TEST CO',
  filings: { recent: {
    accessionNumber: ['0001234567-25-000010', '0001234567-25-000009', '0001234567-25-000008', '0001234567-25-000007', '0001234567-25-000006'],
    form: ['8-K', '424B5', '10-Q', '8-K', '4'],
    filingDate: ['2025-06-10', '2025-05-20', '2025-05-10', '2025-04-01', '2025-03-15'],
    acceptanceDateTime: ['2025-06-10T16:05:12.000Z', '2025-05-20T09:00:00.000Z', '2025-05-10T17:30:00.000Z', '2025-04-01T08:00:00.000Z', '2025-03-15T18:00:00.000Z'],
    reportDate: ['2025-06-10', '', '2025-03-31', '2025-04-01', '2025-03-13'],
    items: ['2.02,9.01', '', '', '1.01,3.02,9.01', ''],
    primaryDocument: ['ex99.htm', 'prospectus.htm', 'q1.htm', 'agreement.htm', 'xslF345X05/form4.xml'],
    primaryDocDescription: ['8-K', '424B5', '10-Q', '8-K', '4'],
  } },
};

test('padCik and filing URLs follow EDGAR conventions', () => {
  assert.equal(padCik(320193), '0000320193');
  assert.equal(filingUrl('0000320193', '0000320193-25-000001', 'a.htm'), 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000001/a.htm');
});

test('8-K items are classified by the most important item', () => {
  assert.equal(classifyFiling('8-K', '2.02,9.01').category, 'EARNINGS');
  const c = classifyFiling('8-K', '1.01,3.02,9.01');
  assert.equal(c.importance, 'high');
  assert.equal(c.items.length, 3);
  assert.equal(classifyFiling('8-K', '4.02').importance, 'critical');
  assert.equal(classifyFiling('424B5').category, 'DILUTION');
  assert.equal(classifyFiling('S-3').category, 'DILUTION');
  assert.equal(classifyFiling('10-K').category, 'PERIODIC');
  assert.equal(classifyFiling('SC 13D').category, 'OWNERSHIP');
});

test('parseFilings flattens columnar data and keeps acceptance timestamps', () => {
  const rows = parseFilings(submissions, { limit: 10 });
  assert.equal(rows.length, 5);
  assert.equal(rows[0].category, 'EARNINGS');
  assert.equal(rows[0].acceptedAt, '2025-06-10T16:05:12.000Z');
  assert.ok(rows[1].url.endsWith('/000123456725000009/prospectus.htm'));
  const d = dilutionSignals(rows, '2025-06-30', 365);
  assert.deepEqual(d.map((r) => r.form), ['424B5']);
  assert.equal(parseFilings(submissions, { forms: ['10-Q'] }).length, 1);
});

// Structure mirrors data.sec.gov companyfacts JSON; values are synthetic.
const facts = {
  entityName: 'TEST CO',
  facts: {
    dei: { EntityCommonStockSharesOutstanding: { units: { shares: [
      { end: '2024-04-30', val: 100e6, filed: '2024-05-10', form: '10-Q' },
      { end: '2025-04-30', val: 130e6, filed: '2025-05-10', form: '10-Q' },
    ] } } },
    'us-gaap': {
      Revenues: { units: { USD: [
        { start: '2023-01-01', end: '2023-12-31', val: 80e6, fy: 2023, fp: 'FY', form: '10-K', filed: '2024-02-20' },
        { start: '2024-01-01', end: '2024-12-31', val: 100e6, fy: 2024, fp: 'FY', form: '10-K', filed: '2025-02-20' },
        { start: '2025-01-01', end: '2025-03-31', val: 30e6, fy: 2025, fp: 'Q1', form: '10-Q', filed: '2025-05-10' },
      ] } },
      NetIncomeLoss: { units: { USD: [
        { start: '2024-01-01', end: '2024-12-31', val: -20e6, fy: 2024, fp: 'FY', form: '10-K', filed: '2025-02-20' },
      ] } },
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
        { start: '2024-01-01', end: '2024-12-31', val: -24e6, fy: 2024, fp: 'FY', form: '10-K', filed: '2025-02-20' },
      ] } },
      CashAndCashEquivalentsAtCarryingValue: { units: { USD: [
        { end: '2024-12-31', val: 40e6, fy: 2024, fp: 'FY', form: '10-K', filed: '2025-02-20' },
        { end: '2025-03-31', val: 36e6, fy: 2025, fp: 'Q1', form: '10-Q', filed: '2025-05-10' },
      ] } },
    },
  },
};

test('summarizeFacts derives growth, margin, runway and dilution with provenance', () => {
  const f = summarizeFacts(facts);
  assert.ok(Math.abs(f.revenueGrowth - 0.25) < 1e-12);
  assert.ok(Math.abs(f.netMargin + 0.2) < 1e-12);
  assert.equal(f.cash.end, '2025-03-31');
  assert.ok(Math.abs(f.runwayMonths - 18) < 1e-9); // 36M / (24M/12)
  assert.ok(Math.abs(f.sharesYoY - 0.3) < 1e-12);
  assert.equal(f.revenue.filed, '2025-02-20');
  assert.equal(f.revenueQuarterly.length, 1);
});

test('summarizeFacts tolerates empty input', () => {
  const f = summarizeFacts({});
  assert.equal(f.revenue, null);
  assert.equal(f.runwayMonths, null);
});

test('ticker search ranks exact, prefix, then name matches', () => {
  const tickers = { 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 1, ticker: 'AAP', title: 'Advance Auto Parts' }, 2: { cik_str: 2, ticker: 'APLE', title: 'Apple Hospitality REIT' } };
  const r = searchTickers(tickers, 'aap');
  assert.equal(r[0].ticker, 'AAP');
  assert.equal(r[1].ticker, 'AAPL');
  assert.equal(searchTickers(tickers, 'apple').length, 2);
  assert.equal(r[1].cik, '0000320193');
});
