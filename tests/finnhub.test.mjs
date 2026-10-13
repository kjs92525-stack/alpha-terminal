import test from 'node:test';
import assert from 'node:assert/strict';
import { quarterlyFlow, toFundamentals, industryToSector, fetchCompany, makeFinnhubClient } from '../packages/pipeline/finnhub.mjs';

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
  const filings = [...ytdYear(2024, [100, 110, 120, 130]), ...ytdYear(2025, [150, 170, 190, 210])]
    .map((f) => ({ ...f, startDate: f.startDate.slice(0, 10), endDate: f.endDate.slice(0, 10), filedDate: f.filedDate.slice(0, 10) }));
  const q = quarterlyFlow(filings, 'ic', ['Revenues']);
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
