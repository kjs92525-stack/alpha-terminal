import test from 'node:test';
import assert from 'node:assert/strict';
import { quarterlyFlow, compactReported, toFundamentals, industryToSector, fetchCompany, makeFinnhubClient, withFacts } from '../packages/pipeline/finnhub.mjs';

const ic = (rev, ni) => ({ ic: [{ concept: 'us-gaap_Revenues', value: rev }, { concept: 'us-gaap_NetIncomeLoss', value: ni }], bs: [{ concept: 'us-gaap_CashAndCashEquivalentsAtCarryingValue', value: 500 }], cf: [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', value: -40 }] });

// fiscal year = calendar year; 10-Qs report year-to-date, the 10-K the full year
function ytdYear(year, q) {
  // q: quarterly revenue [q1..q4], NI the same /10
  const out = [];
  let cum = 0;
  for (let k = 0; k < 4; k++) {
    cum += q[k];
    const end = ['03-31', '06-30', '09-30', '12-31'][k];
    out.push({ form: k === 3 ? '10-K' : '10-Q', year, quarter: k === 3 ? 0 : k + 1, startDate: `${year}-01-01 00:00:00`, endDate: `${year}-${end} 00:00:00`, filedDate: `${year}-${end} 00:00:00`, report: ic(cum, cum / 10) });
  }
  return out;
}

test('YTD and full-year filings become quarterly values', () => {
  const rows = compactReported({ data: [...ytdYear(2024, [100, 110, 120, 130]), ...ytdYear(2025, [150, 170, 190, 210])] });
  const q = quarterlyFlow(rows, 'rev');
  assert.deepEqual(q.map((x) => x.value), [100, 110, 120, 130, 150, 170, 190, 210]);
});

test('3-month filings are used as-is; fundamentals have TTM, growth, margin, runway', () => {
  const data = [];
  for (const [i, end] of ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'].entries()) {
    const start = new Date(Date.parse(end) - 90 * 86400000).toISOString().slice(0, 10);
    data.push({ form: '10-Q', year: 2024 + Math.floor(i / 4), startDate: `${start} 00:00:00`, endDate: `${end} 00:00:00`, filedDate: end, report: ic(100 + i * 20, i < 6 ? -10 : 15) });
  }
  const f = toFundamentals({ data }, { name: 'Demo', shareOutstanding: 50, finnhubIndustry: 'Semiconductors' });
  assert.equal(f.revenueQuarterly.length, 8);
  assert.equal(f.revenue.value, 180 + 200 + 220 + 240);
  assert.ok(Math.abs(f.revenueGrowth - (840 / (100 + 120 + 140 + 160) - 1)) < 1e-9);
  assert.equal(f.netIncomeQuarterly.at(-1).value, 15);
  assert.equal(f.sharesOutstanding.value, 50e6);
  assert.ok(f.runwayMonths > 0, 'negative operating cash flow gives a runway');
  assert.equal(industryToSector('Semiconductors'), 'Information Technology');
  assert.equal(industryToSector('Biotechnology'), 'Health Care');
  assert.equal(industryToSector(null), 'Unknown');
});

test('a derived negative revenue quarter discards the series (period guess was wrong)', () => {
  const data = [
    { form: '10-Q', year: 2025, startDate: '2025-01-01', endDate: '2025-03-31', filedDate: '2025-04-30', report: ic(100, 1) },
    { form: '10-Q', year: 2025, startDate: '2025-01-01', endDate: '2025-06-30', filedDate: '2025-07-30', report: ic(80, 1) },
  ];
  assert.deepEqual(toFundamentals({ data }, {}).revenueQuarterly, []);
});

test('client sends the key as a header and stops on 401', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push([url, init.headers['X-Finnhub-Token']]); return new Response('{}', { status: 401 }); };
  const c = makeFinnhubClient({ apiKey: 'KEY', fetchImpl, wait: async () => {}, minIntervalMs: 0 });
  await assert.rejects(fetchCompany(c, 'BRK.B'), (e) => e.fatal === true);
  assert.equal(seen[0][1], 'KEY');
  assert.ok(!seen[0][0].includes('KEY'), 'key not in the URL');
  assert.ok(seen[0][0].includes('symbol=BRK.B'));
});

test('fiscal Q4 comes from the annual report minus the three 10-Q quarters (NVDA-like, 3-month 10-Qs)', () => {
  const data = [];
  const qtr = (start, end, form, rev, ni, year) => data.push({ form, year, startDate: start, endDate: end, filedDate: end, report: ic(rev, ni) });
  qtr('2025-01-27', '2025-04-27', '10-Q', 44.06, 18.77, 2026);
  qtr('2025-04-28', '2025-07-27', '10-Q', 46.74, 26.42, 2026);
  qtr('2025-07-28', '2025-10-26', '10-Q', 57.01, 31.91, 2026);
  qtr('2025-01-27', '2026-01-25', '10-K', 215.94, 120.07, 2026); // full fiscal year
  qtr('2026-01-26', '2026-04-26', '10-Q', 81.61, 58.32, 2027);
  const rows = compactReported({ data });
  const rev = quarterlyFlow(rows, 'rev');
  assert.deepEqual(rev.map((q) => q.end), ['2025-04-27', '2025-07-27', '2025-10-26', '2026-01-25', '2026-04-26']);
  assert.ok(Math.abs(rev[3].value - (215.94 - 44.06 - 46.74 - 57.01)) < 1e-9);
  assert.match(rev[3].form, /Q4/);
  const f = toFundamentals({ data }, {});
  assert.ok(f.revenue && Math.abs(f.revenue.value - (46.74 + 57.01 + 68.13 + 81.61)) < 1e-6, 'TTM uses the derived Q4');
  // annual report that already holds a single quarter is used as-is
  const one = compactReported({ data: [...data.slice(0, 3), { form: '10-K', year: 2026, startDate: '2025-10-27', endDate: '2026-01-25', filedDate: '2026-02-20', report: ic(68.13, 31.0) }] });
  assert.equal(quarterlyFlow(one, 'rev').at(-1).value, 68.13);
});

test('cached record keeps compact filings and facts are rebuilt from them', async () => {
  const fetchImpl = async (url) => Response.json(url.includes('profile2') ? { name: 'Demo', finnhubIndustry: 'Software', shareOutstanding: 10 } : { cik: '123', data: ytdYear(2025, [10, 11, 12, 13]) });
  const c = makeFinnhubClient({ apiKey: 'k', fetchImpl, wait: async () => {}, minIntervalMs: 0 });
  const raw = await fetchCompany(c, 'DEMO');
  assert.ok(Array.isArray(raw.reported) && !('facts' in raw));
  assert.ok(JSON.stringify(raw).length < 5000, 'small cache record');
  const rec = withFacts(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(rec.facts.revenueQuarterly.map((q) => q.value), [10, 11, 12, 13]);
  assert.equal(rec.sector, 'Information Technology');
  assert.equal(withFacts({ facts: {} }), null, 'old-format record is refetched');
});
