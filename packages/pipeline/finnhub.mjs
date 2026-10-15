// Finnhub (free plan: 60 calls/min) as the fundamentals source when SEC refuses the runner.
// Three calls per company: /stock/profile2 (industry, shares, market cap) and
// /stock/financials-reported?freq=quarterly and freq=annual (numbers as filed in 10-Q / 10-K).
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
const CASH = ['CashAndCashEquivalentsAtCarryingValue', 'Cash'];
// purchases of property/equipment (reported as a positive outflow); records cached before this field have none
const CAPEX = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements'];

const bare = (concept) => String(concept ?? '').replace(/^[a-z-]+_/i, '');
function pick(section, names) {
  // usually [{ concept, value }]; some filings come as { concept: value }
  const list = Array.isArray(section) ? section : section && typeof section === 'object' ? Object.entries(section).map(([concept, value]) => ({ concept, value })) : [];
  const byName = new Map(list.map((x) => [bare(x.concept), x.value]));
  for (const n of names) { const v = byName.get(n); if (typeof v === 'number' && Number.isFinite(v)) return v; }
  return null;
}
const isoDay = (s) => String(s ?? '').slice(0, 10);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;

/** Keep only what we use from a financials-reported response (small enough to cache). */
export function compactReported(reported, annual = null) {
  const seen = new Set();
  return [...(reported?.data ?? []), ...(annual?.data ?? [])]
    .filter((d) => { const k = `${d.form}|${d.endDate}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .filter((d) => /^(10-Q|10-K|20-F|40-F)/.test(d.form ?? '') && d.endDate)
    .map((d) => ({
      form: d.form, year: d.year ?? null, start: isoDay(d.startDate) || null, end: isoDay(d.endDate), filed: isoDay(d.filedDate) || null,
      rev: pick(d.report?.ic, REVENUE), ni: pick(d.report?.ic, NET_INCOME), ocf: pick(d.report?.cf, OCF), cash: pick(d.report?.bs, CASH), capex: (() => { const v = pick(d.report?.cf, CAPEX); return v === null ? null : Math.abs(v); })(),
    }))
    .sort((a, b) => a.end.localeCompare(b.end));
}

const isAnnual = (form) => /^(10-K|20-F|40-F)/.test(form);

/**
 * Quarterly series for a flow field ('rev' | 'ni' | 'ocf') from compact filings.
 * 10-Qs may report the 3-month period or fiscal year-to-date: YTD values are differenced
 * against the quarters already seen in the same fiscal year. The annual report (10-K) gives
 * the fourth quarter as annual total minus the three quarters inside that fiscal year; if the
 * annual value is clearly a single quarter already, it is used as-is. Underivable values are skipped.
 */
export function quarterlyFlow(rows, field) {
  const out = [];
  const byYear = new Map();
  for (const r of rows) {
    if (isAnnual(r.form) || typeof r[field] !== 'number') continue;
    (byYear.get(r.year) ?? byYear.set(r.year, []).get(r.year)).push(r);
  }
  for (const items of byYear.values()) {
    items.sort((a, b) => a.end.localeCompare(b.end));
    let sum = 0;
    let n = 0;
    for (const it of items) {
      const dur = it.start ? days(it.start, it.end) : 91;
      let q = null;
      if (dur > 0 && dur <= 110) q = it[field];
      else if (Math.abs(dur - 91 * (n + 1)) <= 45) q = it[field] - sum;
      if (q === null) continue;
      out.push({ end: it.end, value: q, filed: it.filed, form: it.form, fy: it.year });
      sum += q;
      n++;
    }
  }
  for (const r of rows) {
    if (!isAnnual(r.form) || typeof r[field] !== 'number' || out.some((q) => q.end === r.end)) continue;
    const prior = out.filter((q) => days(q.end, r.end) > 20 && days(q.end, r.end) < 300).sort((a, b) => a.end.localeCompare(b.end)).slice(-3);
    if (prior.length !== 3) continue;
    const priorSum = prior.reduce((a, q) => a + q.value, 0);
    const v = r[field];
    const duration = r.start ? days(r.start, r.end) : null;
    let q4 = null;
    if (duration !== null && duration > 300 && duration < 400 && prior.every((q) => q.fy === r.year)) q4 = v - priorSum;
    else if (duration !== null && duration > 0 && duration <= 110) q4 = v;
    // Without an explicit period, do not infer duration from magnitude or sign.
    if (q4 === null) continue;
    out.push({ end: r.end, value: q4, filed: r.filed, form: `${r.form} Q4`, fy: r.year });
  }
  return out.sort((a, b) => a.end.localeCompare(b.end));
}

function ttm(series) {
  const s = series.slice(-4);
  if (s.length < 4 || days(s[0].end, s[3].end) > 300) return null;
  return { end: s[3].end, value: s.reduce((a, x) => a + x.value, 0), filed: s[3].filed, form: 'TTM' };
}

/** Compact filings + profile → Fundamentals (sec.mjs shape). */
export function fundamentalsFromCompact(rows, profile) {
  let rev = quarterlyFlow(rows, 'rev');
  const ni = quarterlyFlow(rows, 'ni');
  const ocf = quarterlyFlow(rows, 'ocf');
  const capex = quarterlyFlow(rows, 'capex');
  // a negative derived revenue quarter means the period guess was wrong — don't use the series
  if (rev.some((q) => q.value < 0)) rev = [];
  const cashPts = rows.filter((r) => typeof r.cash === 'number').map((r) => ({ end: r.end, value: r.cash, filed: r.filed, form: r.form }));
  const revTtm = ttm(rev);
  const revTtmPrior = rev.length >= 8 ? ttm(rev.slice(0, -4)) : null;
  const niTtm = ttm(ni);
  const ocfTtm = ttm(ocf);
  const capexTtm = ttm(capex);
  const capexTtmPrior = capex.length >= 8 ? ttm(capex.slice(0, -4)) : null;
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
    capexTtm,
    capexTtmPrior,
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

/** Finnhub financials-reported (quarterly) + profile2 → Fundamentals. */
export const toFundamentals = (reported, profile) => fundamentalsFromCompact(compactReported(reported), profile);

/** One company: profile + quarterly and annual reported financials (3 calls). Symbol in vendor form (BRK.B). */
export async function fetchCompany(client, symbol, now = Date.now()) {
  const sym = encodeURIComponent(symbol);
  const profile = await client.json(`/stock/profile2?symbol=${sym}`);
  const reported = await client.json(`/stock/financials-reported?symbol=${sym}&freq=quarterly`);
  // the quarterly feed has 10-Qs only; fiscal Q4 needs the annual report (10-K)
  const annual = await client.json(`/stock/financials-reported?symbol=${sym}&freq=annual`);
  return {
    symbol, source: 'Finnhub', fetchedAt: new Date(now).toISOString(),
    name: profile?.name ?? null, industry: profile?.finnhubIndustry ?? null, sector: industryToSector(profile?.finnhubIndustry),
    marketCap: typeof profile?.marketCapitalization === 'number' ? profile.marketCapitalization * 1e6 : null,
    cik: reported?.cik ? String(reported.cik).padStart(10, '0') : null,
    profile: { name: profile?.name ?? null, finnhubIndustry: profile?.finnhubIndustry ?? null, shareOutstanding: profile?.shareOutstanding ?? null, marketCapitalization: profile?.marketCapitalization ?? null },
    format: 2,
    reported: compactReported(reported, annual),
    filings: [],
  };
}

/** Cached record → record with facts recomputed from the compact filings (null if too old a format). */
export function withFacts(rec) {
  if (!rec?.reported || rec.format !== 2) return null; // older records lack the annual reports
  return { ...rec, facts: fundamentalsFromCompact(rec.reported, rec.profile) };
}

/**
 * Upcoming earnings dates (free plan: /calendar/earnings, one call for the whole window).
 * Returns Map<vendorSymbol, {date, hour}> — hour is 'bmo' (before open), 'amc' (after close) or ''.
 */
export async function fetchEarningsCalendar(client, from, to) {
  const json = await client.json(`/calendar/earnings?from=${from}&to=${to}`);
  const rows = Array.isArray(json?.earningsCalendar) ? json.earningsCalendar : null;
  if (!rows) throw new Error('earnings calendar schema');
  const out = new Map();
  for (const r of rows) {
    if (!r?.symbol || !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') || r.date < from || r.date > to) continue;
    const sym = String(r.symbol);
    const prev = out.get(sym);
    if (!prev || r.date < prev.date) out.set(sym, { date: r.date, hour: r.hour ?? '' });
  }
  return out;
}

/** Insider transactions, SEC filing list and analyst recommendation trend for one symbol (3 calls). */
export async function fetchEdgeData(client, symbol, asOf) {
  const sym = encodeURIComponent(symbol), from = new Date(Date.parse(asOf) - 200 * 86400000).toISOString().slice(0, 10);
  const out = { insider: null, filings: null, recommendation: null, errors: [] };
  try { const j = await client.json(`/stock/insider-transactions?symbol=${sym}&from=${from}&to=${asOf}`); out.insider = Array.isArray(j?.data) ? j.data : null; if (!out.insider) out.errors.push('insider schema'); } catch (e) { out.errors.push(`insider: ${e.message}`); }
  try { const j = await client.json(`/stock/filings?symbol=${sym}&from=${from}&to=${asOf}`); out.filings = Array.isArray(j) ? j.map((f) => ({ form: f.form, filingDate: String(f.filedDate ?? '').slice(0, 10), url: /^https:\/\/(www\.)?sec\.gov\//.test(f.reportUrl ?? '') ? f.reportUrl : null })) : null; if (!out.filings) out.errors.push('filings schema'); } catch (e) { out.errors.push(`filings: ${e.message}`); }
  try { const j = await client.json(`/stock/recommendation?symbol=${sym}`); out.recommendation = Array.isArray(j) ? j : null; } catch (e) { out.errors.push(`recommendation: ${e.message}`); }
  return out;
}
