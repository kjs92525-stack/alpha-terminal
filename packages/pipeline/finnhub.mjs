// Finnhub (free plan: 60 calls/min) as the fundamentals source when SEC refuses the runner.
// Two calls per company: /stock/profile2 (industry, shares, market cap) and
// /stock/financials-reported?freq=quarterly (numbers as filed with the SEC in 10-Q/10-K).
// Output uses the same shape as sec.mjs summarizeFacts(), so features, rankings and story
// signals work unchanged. Docs: https://finnhub.io/docs/api

import { fetchRetry, throttle } from './http.mjs';

const BASE = 'https://finnhub.io/api/v1';
const DAY = 86400000;

export function makeFinnhubClient({ apiKey, fetchImpl = fetch, wait, minIntervalMs = 1100 } = {}) {
  if (!apiKey) throw new Error('FINNHUB_API_KEY missing');
  const gate = throttle(minIntervalMs);
  const headers = { 'X-Finnhub-Token': apiKey, Accept: 'application/json' };
  return {
    calls: 0,
    async json(pathAndQuery) {
      await gate();
      this.calls++;
      const res = await fetchRetry(`${BASE}${pathAndQuery}`, { headers }, { fetchImpl, wait, retries: 3, baseDelayMs: 2000 });
      if (res.status === 401 || res.status === 403) {
        const err = new Error(`Finnhub HTTP ${res.status} (키 확인 필요 또는 무료 플랜 미지원)`);
        err.fatal = res.status === 401;
        throw err;
      }
      if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
      return res.json();
    },
  };
}

const SECTOR_RULES = [
  [/pharma|biotech|health|medical|life sciences/i, 'Health Care'],
  [/semiconductor|technology|software|it services|electronic|computer|internet/i, 'Information Technology'],
  [/bank|financial|insurance|capital markets|asset management|credit/i, 'Financials'],
  [/real estate|reit/i, 'Real Estate'],
  [/media|telecom|communication|entertainment/i, 'Communication Services'],
  [/utilit/i, 'Utilities'],
  [/energy|oil|gas|coal/i, 'Energy'],
  [/chemical|metal|mining|materials|packaging|paper|forest/i, 'Materials'],
  [/food|beverage|tobacco|household products|personal products|consumer staples/i, 'Consumer Staples'],
  [/retail|auto|hotel|restaurant|leisure|textile|apparel|consumer|homebuild|household durables|distributors/i, 'Consumer Discretionary'],
  [/aerospace|defense|machinery|industrial|construction|airline|logistics|transport|marine|trading companies|commercial services|professional services|building|electrical equipment/i, 'Industrials'],
];
export function industryToSector(industry) {
  if (!industry) return 'Unknown';
  for (const [re, s] of SECTOR_RULES) if (re.test(industry)) return s;
  return 'Other';
}

const REVENUE = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense'];
const NET_INCOME = ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'];
const OCF = ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'];
const CASH = ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'];

const bare = (concept) => String(concept ?? '').replace(/^[a-z-]+_/i, '');
function pick(section, names) {
  const byName = new Map((section ?? []).map((x) => [bare(x.concept), x.value]));
  for (const n of names) { const v = byName.get(n); if (typeof v === 'number' && Number.isFinite(v)) return v; }
  return null;
}
const isoDay = (s) => String(s ?? '').slice(0, 10);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;

/**
 * Quarterly series for a flow concept. Filings may report the 3-month period or the
 * fiscal year-to-date (and 10-Ks the full year); YTD values are differenced against the
 * quarters already seen in the same fiscal year. A value that cannot be derived is skipped.
 */
export function quarterlyFlow(filings, section, names) {
  const byYear = new Map();
  for (const f of filings) {
    const v = pick(f.report?.[section], names);
    if (v === null) continue;
    (byYear.get(f.year) ?? byYear.set(f.year, []).get(f.year)).push({ ...f, v });
  }
  const out = [];
  for (const items of byYear.values()) {
    items.sort((a, b) => a.endDate.localeCompare(b.endDate));
    let sum = 0;
    let n = 0;
    for (const it of items) {
      const dur = days(it.startDate, it.endDate);
      let q = null;
      if (dur > 0 && dur <= 110) q = it.v;
      else if (Math.abs(dur - 91 * (n + 1)) <= 45) q = it.v - sum; // YTD covering the quarters already seen
      if (q === null) continue;
      out.push({ end: it.endDate, value: q, filed: it.filedDate, form: it.form, fy: it.year });
      sum += q;
      n++;
    }
  }
  return out.sort((a, b) => a.end.localeCompare(b.end));
}

function ttm(series) {
  const s = series.slice(-4);
  if (s.length < 4 || days(s[0].end, s[3].end) > 300) return null;
  return { end: s[3].end, value: s.reduce((a, x) => a + x.value, 0), filed: s[3].filed, form: 'TTM' };
}

/** Finnhub financials-reported (quarterly) + profile2 → Fundamentals (sec.mjs shape). */
export function toFundamentals(reported, profile) {
  const filings = (reported?.data ?? [])
    .filter((d) => /^(10-Q|10-K|20-F|40-F)/.test(d.form ?? '') && d.endDate && d.startDate)
    .map((d) => ({ ...d, endDate: isoDay(d.endDate), startDate: isoDay(d.startDate), filedDate: isoDay(d.filedDate) }));
  let rev = quarterlyFlow(filings, 'ic', REVENUE);
  const ni = quarterlyFlow(filings, 'ic', NET_INCOME);
  const ocf = quarterlyFlow(filings, 'cf', OCF);
  // a negative derived revenue quarter means the period guess was wrong — don't use the series
  if (rev.some((q) => q.value < 0)) rev = [];
  const cashPts = filings.map((f) => ({ end: f.endDate, value: pick(f.report?.bs, CASH), filed: f.filedDate, form: f.form })).filter((p) => p.value !== null).sort((a, b) => a.end.localeCompare(b.end));
  const revTtm = ttm(rev);
  const revTtmPrior = rev.length >= 8 ? ttm(rev.slice(0, -4)) : null;
  const niTtm = ttm(ni);
  const ocfTtm = ttm(ocf);
  const cash = cashPts.at(-1) ?? null;
  const sharesM = profile?.shareOutstanding;
  const shares = typeof sharesM === 'number' && sharesM > 0 ? { end: new Date().toISOString().slice(0, 10), value: sharesM * 1e6, filed: null, form: 'profile' } : null;
  return {
    entityName: profile?.name ?? null,
    revenue: revTtm,
    revenuePrior: revTtmPrior,
    revenueGrowth: revTtm && revTtmPrior && revTtmPrior.value > 0 ? revTtm.value / revTtmPrior.value - 1 : null,
    revenueQuarterly: rev.slice(-12),
    netIncomeQuarterly: ni.slice(-12),
    netIncome: niTtm,
    netMargin: niTtm && revTtm && revTtm.value > 0 ? niTtm.value / revTtm.value : null,
    operatingCashFlow: ocfTtm,
    cash,
    shortTermInvestments: null,
    liquidAssets: cash?.value ?? null,
    runwayMonths: ocfTtm && ocfTtm.value < 0 && cash ? cash.value / (-ocfTtm.value / 12) : null,
    sharesOutstanding: shares,
    sharesYoY: null,
    stockholdersEquity: null,
    longTermDebt: null,
  };
}

/** One company: profile + quarterly reported financials. Symbol in vendor form (BRK.B). */
export async function fetchCompany(client, symbol, now = Date.now()) {
  const sym = encodeURIComponent(symbol);
  const profile = await client.json(`/stock/profile2?symbol=${sym}`);
  const reported = await client.json(`/stock/financials-reported?symbol=${sym}&freq=quarterly`);
  return {
    symbol, source: 'Finnhub', fetchedAt: new Date(now).toISOString(),
    name: profile?.name ?? null, industry: profile?.finnhubIndustry ?? null, sector: industryToSector(profile?.finnhubIndustry),
    marketCap: typeof profile?.marketCapitalization === 'number' ? profile.marketCapitalization * 1e6 : null,
    cik: reported?.cik ? String(reported.cik).padStart(10, '0') : null,
    facts: toFundamentals(reported, profile),
    filings: [],
  };
}
