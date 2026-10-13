// ALPHA TERMINAL — SEC EDGAR parsing and event classification.
// Inputs are the official JSON documents from data.sec.gov:
//   /submissions/CIK##########.json  and  /api/xbrl/companyfacts/CIK##########.json

export const padCik = (cik) => String(cik).replace(/\D/g, '').padStart(10, '0');

export function filingUrl(cik, accession, primaryDocument) {
  const folder = accession.replace(/-/g, '');
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(padCik(cik))}/${folder}`;
  return primaryDocument ? `${base}/${primaryDocument}` : `${base}/${accession}-index.htm`;
}

// 8-K item numbers -> meaning. Source: SEC Form 8-K General Instructions.
export const EIGHT_K_ITEMS = {
  '1.01': { label: '중요 계약 체결', category: 'CONTRACT', importance: 'high' },
  '1.02': { label: '중요 계약 해지', category: 'CONTRACT', importance: 'high' },
  '1.03': { label: '파산·법정관리', category: 'DISTRESS', importance: 'critical' },
  '1.05': { label: '중대 사이버보안 사고', category: 'RISK', importance: 'high' },
  '2.01': { label: '자산 인수·처분 완료', category: 'M&A', importance: 'high' },
  '2.02': { label: '실적 발표', category: 'EARNINGS', importance: 'high' },
  '2.03': { label: '직접 금융채무 발생', category: 'FINANCING', importance: 'medium' },
  '2.04': { label: '채무 가속 트리거', category: 'DISTRESS', importance: 'high' },
  '2.05': { label: '구조조정 비용', category: 'RISK', importance: 'medium' },
  '2.06': { label: '자산 손상', category: 'RISK', importance: 'medium' },
  '3.01': { label: '상장폐지·상장요건 미달 통지', category: 'DISTRESS', importance: 'critical' },
  '3.02': { label: '미등록 지분증권 판매', category: 'DILUTION', importance: 'high' },
  '3.03': { label: '주주 권리 변경', category: 'GOVERNANCE', importance: 'medium' },
  '4.01': { label: '감사인 변경', category: 'RISK', importance: 'medium' },
  '4.02': { label: '기존 재무제표 신뢰 불가', category: 'DISTRESS', importance: 'critical' },
  '5.01': { label: '지배권 변경', category: 'M&A', importance: 'high' },
  '5.02': { label: '임원·이사 변동', category: 'GOVERNANCE', importance: 'medium' },
  '5.03': { label: '정관·회계연도 변경', category: 'GOVERNANCE', importance: 'low' },
  '5.07': { label: '주주총회 결과', category: 'GOVERNANCE', importance: 'low' },
  '7.01': { label: 'Reg FD 공개', category: 'DISCLOSURE', importance: 'low' },
  '8.01': { label: '기타 중요 사건', category: 'DISCLOSURE', importance: 'medium' },
  '9.01': { label: '재무제표·첨부서류', category: 'EXHIBIT', importance: 'low' },
};

const FORM_RULES = [
  [/^(S-1|S-3|F-1|F-3|S-1\/A|S-3\/A|F-1\/A|F-3\/A|S-3ASR|F-3ASR)$/, { label: '증권 발행 등록', category: 'DILUTION', importance: 'high' }],
  [/^424B[1-8]$/, { label: '발행 설명서 (오퍼링 가격·규모)', category: 'DILUTION', importance: 'high' }],
  [/^(S-8|S-8 POS)$/, { label: '임직원 주식보상 등록', category: 'DILUTION', importance: 'low' }],
  [/^10-K(\/A)?$/, { label: '연간 보고서', category: 'PERIODIC', importance: 'medium' }],
  [/^10-Q(\/A)?$/, { label: '분기 보고서', category: 'PERIODIC', importance: 'medium' }],
  [/^(20-F|40-F|6-K)(\/A)?$/, { label: '해외기업 정기/수시 보고', category: 'PERIODIC', importance: 'medium' }],
  [/^(SC 13D|SC 13D\/A|SCHEDULE 13D|SCHEDULE 13D\/A)$/, { label: '5% 이상 적극적 지분 보유', category: 'OWNERSHIP', importance: 'high' }],
  [/^(SC 13G|SC 13G\/A|SCHEDULE 13G|SCHEDULE 13G\/A)$/, { label: '5% 이상 소극적 지분 보유', category: 'OWNERSHIP', importance: 'low' }],
  [/^4(\/A)?$/, { label: '내부자 거래 보고', category: 'INSIDER', importance: 'low' }],
  [/^(3|5)(\/A)?$/, { label: '내부자 지분 보고', category: 'INSIDER', importance: 'low' }],
  [/^144$/, { label: '내부자 매도 예정 통지', category: 'INSIDER', importance: 'medium' }],
  [/^(SC TO-T|SC TO-I|SC 14D9|DEFM14A|PREM14A|S-4|S-4\/A|425)$/, { label: '인수합병·공개매수 관련', category: 'M&A', importance: 'high' }],
  [/^(DEF 14A|PRE 14A|DEFA14A)$/, { label: '위임장 설명서', category: 'GOVERNANCE', importance: 'low' }],
  [/^(25|25-NSE)$/, { label: '상장 폐지 통지', category: 'DISTRESS', importance: 'critical' }],
  [/^NT 10-[KQ]$/, { label: '정기보고서 제출 지연', category: 'RISK', importance: 'high' }],
];

const RANK = { low: 1, medium: 2, high: 3, critical: 4 };

export function classifyFiling(form, items = '') {
  const itemList = String(items || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (/^8-K(\/A)?$/.test(form)) {
    const known = itemList.map((i) => ({ item: i, ...(EIGHT_K_ITEMS[i] || { label: `Item ${i}`, category: 'DISCLOSURE', importance: 'low' }) }));
    const meaningful = known.filter((k) => k.item !== '9.01');
    const top = (meaningful.length ? meaningful : known).sort((a, b) => RANK[b.importance] - RANK[a.importance])[0];
    return {
      category: top?.category ?? 'DISCLOSURE',
      importance: top?.importance ?? 'medium',
      label: top ? top.label : '수시 공시 (8-K)',
      itemDetails: known,
    };
  }
  for (const [re, info] of FORM_RULES) if (re.test(form)) return { ...info, itemDetails: [] };
  return { label: form, category: 'OTHER', importance: 'low', itemDetails: [] };
}

/** Flatten `filings.recent` (columnar) into rows with classification and source links. */
export function parseFilings(submissions, { limit = 40, forms } = {}) {
  const r = submissions?.filings?.recent;
  if (!r || !Array.isArray(r.accessionNumber)) return [];
  const cik = submissions.cik;
  const rows = [];
  for (let i = 0; i < r.accessionNumber.length && rows.length < limit; i++) {
    const form = r.form[i];
    if (forms && !forms.includes(form)) continue;
    const accession = r.accessionNumber[i];
    rows.push({
      accession,
      form,
      filingDate: r.filingDate?.[i] ?? null,
      acceptedAt: r.acceptanceDateTime?.[i] ?? null,
      reportDate: r.reportDate?.[i] || null,
      items: r.items?.[i] || '',
      description: r.primaryDocDescription?.[i] || '',
      url: filingUrl(cik, accession, r.primaryDocument?.[i]),
      ...classifyFiling(form, r.items?.[i]),
    });
  }
  return rows;
}

/** Dilution-related filings within `days` of `asOf` (ISO date). */
export function dilutionSignals(filings, asOf, days = 365) {
  const cutoff = new Date(asOf).getTime() - days * 86400000;
  return filings.filter((f) => f.category === 'DILUTION' && f.importance !== 'low' && new Date(f.filingDate).getTime() >= cutoff);
}

// ---------- XBRL company facts ----------

const DAY = 86400000;
const durationDays = (f) => (f.start && f.end ? (new Date(f.end) - new Date(f.start)) / DAY : null);

function unitSeries(facts, taxonomy, concepts, unit) {
  for (const c of concepts) {
    const arr = facts?.facts?.[taxonomy]?.[c]?.units?.[unit];
    if (Array.isArray(arr) && arr.length) return { concept: c, values: arr };
  }
  return null;
}

/** Latest-filed value per period end, sorted by end ascending. */
function dedupeByEnd(values) {
  const map = new Map();
  for (const v of values) {
    const prev = map.get(v.end);
    if (!prev || String(v.filed) > String(prev.filed)) map.set(v.end, v);
  }
  return [...map.values()].sort((a, b) => String(a.end).localeCompare(String(b.end)));
}

const ANNUAL_FORMS = /^(10-K|10-K\/A|20-F|20-F\/A|40-F|40-F\/A)$/;

function annual(series) {
  if (!series) return [];
  return dedupeByEnd(series.values.filter((v) => ANNUAL_FORMS.test(v.form) && (() => { const d = durationDays(v); return d !== null && d > 340 && d < 390; })()))
    .map((v) => ({ end: v.end, value: v.val, filed: v.filed, form: v.form, fy: v.fy }));
}

function quarterly(series) {
  if (!series) return [];
  return dedupeByEnd(series.values.filter((v) => { const d = durationDays(v); return d !== null && d > 80 && d < 100; }))
    .map((v) => ({ end: v.end, value: v.val, filed: v.filed, form: v.form }));
}

function instants(series) {
  if (!series) return [];
  return dedupeByEnd(series.values.filter((v) => !v.start)).map((v) => ({ end: v.end, value: v.val, filed: v.filed, form: v.form }));
}

const last = (a) => (a.length ? a[a.length - 1] : null);

/** Quarterly values merged across alternative concepts (companies switch revenue tags over time). */
function mergedQuarterly(facts, concepts) {
  const byEnd = new Map();
  for (const c of concepts) {
    for (const v of quarterly(unitSeries(facts, 'us-gaap', [c], 'USD'))) if (!byEnd.has(v.end)) byEnd.set(v.end, v);
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/**
 * Summarise fundamentals relevant to screening and event risk.
 * All values carry their period end and filing date so the UI can show provenance.
 */
export function summarizeFacts(facts) {
  const revenue = unitSeries(facts, 'us-gaap', ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'], 'USD');
  const netIncome = unitSeries(facts, 'us-gaap', ['NetIncomeLoss', 'ProfitLoss'], 'USD');
  const ocf = unitSeries(facts, 'us-gaap', ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'], 'USD');
  const cash = unitSeries(facts, 'us-gaap', ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'], 'USD');
  const stInv = unitSeries(facts, 'us-gaap', ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'], 'USD');
  const shares = unitSeries(facts, 'dei', ['EntityCommonStockSharesOutstanding'], 'shares')
    ?? unitSeries(facts, 'us-gaap', ['CommonStockSharesOutstanding'], 'shares');
  const equity = unitSeries(facts, 'us-gaap', ['StockholdersEquity'], 'USD');
  const debt = unitSeries(facts, 'us-gaap', ['LongTermDebt', 'LongTermDebtNoncurrent'], 'USD');

  // Revenue sometimes switches concept across years; merge candidate concepts by end date.
  let revAnnual = [];
  for (const c of ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']) {
    const s = unitSeries(facts, 'us-gaap', [c], 'USD');
    for (const v of annual(s)) if (!revAnnual.some((x) => x.end === v.end)) revAnnual.push(v);
  }
  revAnnual.sort((a, b) => a.end.localeCompare(b.end));
  if (!revAnnual.length) revAnnual = annual(revenue);

  const niAnnual = annual(netIncome);
  const ocfAnnual = annual(ocf);
  const cashLatest = last(instants(cash));
  const stLatest = last(instants(stInv));
  const sharesSeries = instants(shares);
  const sharesLatest = last(sharesSeries);
  const revLast = last(revAnnual);
  const revPrev = revAnnual.length > 1 ? revAnnual[revAnnual.length - 2] : null;
  const niLast = last(niAnnual);
  const ocfLast = last(ocfAnnual);

  const liquid = (cashLatest?.value ?? 0) + (stLatest && cashLatest && stLatest.end === cashLatest.end ? stLatest.value : 0);
  let runwayMonths = null;
  if (ocfLast && ocfLast.value < 0 && cashLatest) runwayMonths = liquid / (-ocfLast.value / 12);

  let sharesYoY = null;
  if (sharesLatest) {
    const target = new Date(sharesLatest.end).getTime() - 365 * DAY;
    const prior = [...sharesSeries].reverse().find((s) => new Date(s.end).getTime() <= target + 45 * DAY && new Date(s.end).getTime() >= target - 120 * DAY);
    if (prior && prior.value > 0) sharesYoY = sharesLatest.value / prior.value - 1;
  }

  return {
    entityName: facts?.entityName ?? null,
    revenue: revLast,
    revenuePrior: revPrev,
    revenueGrowth: revLast && revPrev && revPrev.value > 0 ? revLast.value / revPrev.value - 1 : null,
    revenueQuarterly: mergedQuarterly(facts, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']).slice(-12),
    netIncomeQuarterly: quarterly(netIncome).slice(-12),
    netIncome: niLast,
    netMargin: niLast && revLast && revLast.value > 0 && niLast.end === revLast.end ? niLast.value / revLast.value : null,
    operatingCashFlow: ocfLast,
    cash: cashLatest,
    shortTermInvestments: stLatest,
    liquidAssets: cashLatest ? liquid : null,
    runwayMonths,
    sharesOutstanding: sharesLatest,
    sharesYoY,
    stockholdersEquity: last(instants(equity)),
    longTermDebt: last(instants(debt)),
  };
}

/** Ticker search against https://www.sec.gov/files/company_tickers.json */
export function searchTickers(tickersJson, query, limit = 12) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return [];
  const all = Object.values(tickersJson || {});
  const exact = [];
  const prefix = [];
  const name = [];
  for (const t of all) {
    const tk = String(t.ticker).toUpperCase();
    const title = String(t.title).toUpperCase();
    if (tk === q) exact.push(t);
    else if (tk.startsWith(q)) prefix.push(t);
    else if (q.length >= 3 && title.includes(q)) name.push(t);
  }
  return [...exact, ...prefix, ...name].slice(0, limit).map((t) => ({ ticker: t.ticker, name: t.title, cik: padCik(t.cik_str) }));
}

// ---------- EDGAR "latest filings" Atom feed ----------
// https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=40&output=atom

const decode = (s) => String(s ?? '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function currentFeedUrl(type, count = 40) {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(type)}&company=&dateb=&owner=include&start=0&count=${count}&output=atom`;
}

/** Parse the EDGAR current-events Atom feed into classified filings (filer entries only). */
export function parseCurrentAtom(xml) {
  const out = [];
  const entries = String(xml || '').split(/<entry>/i).slice(1);
  for (const e of entries) {
    const title = decode((e.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]).trim();
    const m = title.match(/^(.+?) - (.+) \((\d{10})\) \((Filer|Subject|Reporting|Filed by)\)$/);
    if (!m) continue;
    const [, form, company, cik, role] = m;
    if (role === 'Reporting') continue; // Form 4 reporting-owner duplicates
    const link = (e.match(/<link[^>]*href="([^"]+)"/i) || [])[1] ?? null;
    const updated = (e.match(/<updated>([^<]+)<\/updated>/i) || [])[1] ?? null;
    const summary = decode((e.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [])[1]);
    const accession = (summary.match(/AccNo:<\/b>\s*([\d-]+)/i) || e.match(/accession-number=([\d-]+)/i) || [])[1] ?? null;
    const filed = (summary.match(/Filed:<\/b>\s*(\d{4}-\d{2}-\d{2})/i) || [])[1] ?? null;
    const items = [...summary.matchAll(/Item (\d\.\d{2})/g)].map((x) => x[1]).join(',');
    out.push({
      accession, form, company: company.trim(), cik, role,
      acceptedAt: updated ? new Date(updated).toISOString() : null, filingDate: filed, items, url: link,
      ...classifyFiling(form, items),
    });
  }
  return out;
}
