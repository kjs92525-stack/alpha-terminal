// Independent, absolute score. No normalization against the momentum scanner.
// This is a research priority, not an upside estimate or probability.
import { financialReview } from './financial-review.mjs';
import { quarterlyYoY } from './story.mjs';
export const EARLY_MODEL = 'early-alpha-v2';
export const EARLY_RULES = Object.freeze({ minCap: 1e8, maxCap: 2e9, minPrice: 1, minAdv: 5e5, minBars: 126, maxRet63: 0.5, maxRet21: 0.3, minDrawdown: 0.2, minScore: 40 });
const DAY = 86400000;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const date = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const validUrl = (s) => { try { return ['https:', 'http:'].includes(new URL(s).protocol) ? s : null; } catch { return null; } };
const pointVisible = (p, cutoff) => p && num(p.value) && Date.parse(p.filed) <= cutoff && Date.parse(p.end) <= cutoff;

export function earlyMarket(bars, asOf) {
  const cutoff = Date.parse(asOf) / 1000;
  const b = bars.filter((x) => x.time <= cutoff).sort((a, c) => a.time - c.time);
  const price = b.at(-1)?.close;
  const ret = (n) => b.length > n && b.at(-n - 1).close > 0 ? price / b.at(-n - 1).close - 1 : null;
  const high = b.length ? Math.max(...b.slice(-252).map((x) => x.high)) : null;
  return { bars: b, price: price ?? null, ret21: ret(21), ret63: ret(63), drawdown: high > 0 ? 1 - price / high : null,
    adv20: mean(b.slice(-20).map((x) => x.close * x.volume)), lastDate: b.length ? date(b.at(-1).time) : null };
}

// Companyfacts summaries are not a historical database: reject late-filed points
// rather than silently using restatements or a subsequently reported quarter.
export function earlyFacts(company, asOf) {
  const cutoff = Date.parse(asOf) + DAY - 1;
  const f = company?.facts ?? {};
  const series = (xs) => [...new Map((xs ?? []).filter((p) => pointVisible(p, cutoff)).sort((a, b) => a.end.localeCompare(b.end) || a.filed.localeCompare(b.filed)).map((p) => [p.end, p])).values()];
  const scalar = (k) => pointVisible(f[k], cutoff) ? f[k] : null;
  const cash = scalar('cash'); const investments = scalar('shortTermInvestments'); const ocf = scalar('operatingCashFlow');
  // Annual/TTM OCF only. Unsupported periods are not converted to runway.
  const liquid = cash ? cash.value + (investments?.end === cash.end ? investments.value : 0) : null;
  const cashFresh = cash && Date.parse(asOf) - Date.parse(cash.end) <= 200 * DAY;
  const ocfFresh = ocf && Date.parse(asOf) - Date.parse(ocf.end) <= 550 * DAY;
  const runway = cashFresh && ocfFresh && liquid !== null && ocf?.value < 0 ? liquid / -ocf.value * 12 : null;
  return { revenueQuarterly: series(f.revenueQuarterly), netIncomeQuarterly: series(f.netIncomeQuarterly),
    revenue: scalar('revenue'), cashFlowFresh: Boolean(ocfFresh), shares: scalar('sharesOutstanding'), cash, ocf, runway,
    sharesYoY: scalar('sharesOutstanding') && num(f.sharesYoY) ? f.sharesYoY : null };
}

export function earlyEligibility(row, company, bars, asOf, rules = EARLY_RULES) {
  const m = earlyMarket(bars, asOf); const f = earlyFacts(company, asOf);
  // Shares multiplied by adjustment=all close can mismatch after a split.
  // Expose the estimation; do not use an undated vendor market cap.
  const sharesFresh = f.shares && Date.parse(asOf) - Date.parse(f.shares.end) <= 180 * DAY;
  const cutoff = Date.parse(asOf) + DAY - 1;
  const collected = Date.parse(company?.fetchedAt);
  const profileShares = company?.facts?.sharesOutstanding;
  const profileFresh = company?.source === 'Finnhub' && profileShares?.form === 'profile'
    && num(profileShares.value) && Number.isFinite(collected) && collected <= cutoff && cutoff - collected <= 45 * DAY;
  const cap = sharesFresh ? f.shares.value * m.price : profileFresh ? profileShares.value * m.price : null;
  const capBasis = sharesFresh ? 'reported' : profileFresh ? 'vendor_profile' : 'missing';
  const capMethod = capBasis === 'vendor_profile'
    ? `Finnhub 프로필 주식 수 × 기준 종가 (수집 ${company.fetchedAt}, 보고일 미확인·최대 45일 지연)`
    : '최근 보고 주식 수 × 조정 종가 (분할·최근 발행 시 오차 가능)';
  const excluded = [];
  if (!num(cap)) excluded.push('시가총액 데이터 부족 또는 주식 수 180일 이상 경과');
  else if (cap < rules.minCap || cap > rules.maxCap) excluded.push('시가총액 $100M–$2B 범위 밖');
  if (!(m.price >= rules.minPrice)) excluded.push('주가 $1 미만');
  if (!(m.adv20 >= rules.minAdv)) excluded.push('20일 평균 거래대금 $500K 미만');
  if (m.bars.length < rules.minBars) excluded.push('가격 이력 126거래일 미만');
  if (!m.lastDate || Date.parse(asOf) - Date.parse(m.lastDate) > 4 * DAY) excluded.push('시세 누락·거래정지 가능성');
  if (m.ret63 > rules.maxRet63 || m.ret21 > rules.maxRet21) excluded.push('이미 급등: 3개월 +50% 또는 1개월 +30% 초과');
  if (!(m.drawdown >= rules.minDrawdown)) excluded.push('52주 고점 대비 하락폭 20% 미만');
  if (row.sector === 'Blank Check') excluded.push('SPAC 제외');
  return { market: m, facts: f, cap, capBasis, capMethod, excluded };
}

export function scoreEarlyAlpha({ row, company, bars, news = [], newsStatus = 'not_checked', asOf }) {
  const { market: m, facts: f, cap, capBasis, capMethod, excluded } = earlyEligibility(row, company, bars, asOf);
  const cutoff = Date.parse(asOf) + DAY - 1;
  const source = company?.source ?? 'SEC';
  const factUrl = company?.cik ? `https://www.sec.gov/edgar/browse/?CIK=${Number(company.cik)}` : `https://finnhub.io/`;
  const reasons = []; const warnings = [];
  if (capBasis === 'vendor_profile') warnings.push('시가총액은 수집 시점 프로필 추정치 — 보고 주식 수와 최근 발행 규모 원문 확인 필요');
  const components = { growth: 0, profitability: 0, catalyst: 0, neglect: 0, value: 0, base: 0, penalty: 0 };
  const evidence = [];
  const add = (factor, points, text, pointsUsed = []) => {
    components[factor] += points; reasons.push({ factor, points, text });
    for (const p of pointsUsed) evidence.push({ kind: 'financial', title: text, url: validUrl((company?.filings ?? []).find((x) => x.filingDate === p.filed && /^(10-Q|10-K|20-F|40-F)/.test(x.form))?.url) ?? factUrl, publishedAt: p.filed, period: p.end, value: p.value, source, confidence: 'reported' });
  };
  const review = financialReview(row.ticker ?? row.symbol, asOf, f.revenueQuarterly.at(-1)?.end);
  const yoy = quarterlyYoY(f.revenueQuarterly).slice(-3);
  if (yoy.length >= 2) {
    const last = yoy.at(-1).yoy; const prior = yoy.at(-2).yoy;
    if (last >= 0.15) add('growth', review ? Math.min(10, review.growthCap) : 10, `분기 매출 YoY +${(last * 100).toFixed(1)}%`, f.revenueQuarterly.filter((p) => Math.abs(Date.parse(p.end) - Date.parse(yoy.at(-1).end)) <= 20 * DAY || Math.abs(Date.parse(p.end) - (Date.parse(yoy.at(-1).end) - 365 * DAY)) <= 20 * DAY));
    if (last > 0 && last - prior >= 0.05 && Date.parse(yoy.at(-1).end)-Date.parse(yoy.at(-2).end) <= 110*DAY) add('growth', review ? Math.max(0, review.growthCap - 10) : 20, `매출 성장 가속 ${(prior * 100).toFixed(1)}% → ${(last * 100).toFixed(1)}%`, f.revenueQuarterly.filter((p) => yoy.slice(-2).some((q) => Math.abs(Date.parse(p.end)-Date.parse(q.end))<=20*DAY || Math.abs(Date.parse(p.end)-(Date.parse(q.end)-365*DAY))<=20*DAY)));
  } else warnings.push('전년 동기 매출 비교 데이터 부족');
  const ni = f.netIncomeQuarterly; const latest = ni.at(-1);
  const profitReview = financialReview(row.ticker ?? row.symbol, asOf, latest?.end);
  const old = latest && ni.find((p) => Math.abs(Date.parse(p.end) - (Date.parse(latest.end) - 365 * DAY)) <= 20 * DAY);
  if (latest && old) {
    if (latest.value > 0 && old.value <= 0) add('profitability', profitReview ? Math.min(25, profitReview.profitCap) : 10, '전년 동기 대비 분기 흑자 전환', [old, latest]);
    else if (latest.value < 0 && old.value < 0 && latest.value > old.value * 0.65) add('profitability', profitReview ? Math.min(15, profitReview.profitCap) : 10, '전년 동기 대비 순손실 35% 이상 축소', [old, latest]);
    else if (old.value > 0 && latest.value > old.value * 1.3) add('profitability', profitReview ? Math.min(10, profitReview.profitCap) : 10, '분기 순이익 30% 이상 성장', [old, latest]);
  } else warnings.push('전년 동기 수익성 비교 데이터 부족');
  if (review) { warnings.push(review.quality); evidence.push({kind:'quality_review',title:review.quality,url:review.source,publishedAt:review.publishedAt,period:review.period,source:'회사 발표·SEC 원문 검토',confidence:'primary_review'}); }
  else warnings.push('순이익의 일회성 요인·본업 이익은 원문 미검증 — 수익성 가점 최대 10점');
  const seen = new Set();
  const recentNews = news.filter((n) => {
    const t = Date.parse(n.time); const key = n.url || String(n.headline).toLowerCase().replace(/\W/g, '');
    if (!Number.isFinite(t) || t > cutoff || cutoff - t > 90 * DAY || seen.has(key)) return false;
    seen.add(key); return true;
  });
  let catalyst = 0;
  for (const n of recentNews) {
    const h = n.headline ?? '';
    const nonbinding = /\b(LOI|MOU|letter of intent|memorandum of understanding|non[- ]binding|explor\w*|plans? to|expects? to)\b/i.test(h);
    const negative = /\b(not|no|denied|reject\w*|terminat\w*|cancel\w*|fails?|failed|delay\w*|lawsuit)\b/i.test(h);
    const contract = /\b(wins?|awarded|signs?|signed|secures?|secured)\b.*\b(contract|purchase order|supply agreement)\b/i.test(h);
    const commercial = /\b(first commercial|commercial launch|begins? commercial|FDA approves?|FDA approval)\b/i.test(h);
    if (!contract && !commercial && !nonbinding) continue;
    const url = validUrl(n.url);
    const pts = url && !nonbinding && !negative ? 10 : 0;
    catalyst = Math.max(catalyst, pts); // repeated syndicated coverage never compounds
    evidence.push({ kind: nonbinding ? 'nonbinding' : 'catalyst', title: h, url, publishedAt: n.time, source: n.source ?? 'Alpaca news', confidence: 'headline_only' });
  }
  if (catalyst) add('catalyst', catalyst, '계약·상업화·승인 관련 제목 발견 — 원문 검증 필요 (최대 10점)');
  const filings = (company?.filings ?? []).filter((x) => {
    const t = Date.parse(x.acceptedAt ?? x.filingDate);
    return Number.isFinite(t) && t <= cutoff && cutoff - t <= 365 * DAY;
  });
  const dilution = filings.filter((x) => x.category === 'DILUTION' && x.importance !== 'low');
  const distress = filings.filter((x) => x.category === 'DISTRESS' || x.importance === 'critical');
  for (const x of filings.filter((x) => ['DILUTION', 'DISTRESS', 'CONTRACT', 'EARNINGS'].includes(x.category)))
    evidence.push({ kind: 'filing', title: `${x.form} · ${x.label ?? x.category}`, url: validUrl(x.url), publishedAt: x.acceptedAt ?? x.filingDate, source: 'SEC EDGAR', confidence: 'filing_metadata' });
  const riskNews = recentNews.filter((n) => /\b(offering|at-the-market|ATM program|warrants?|convertible notes?|private placement)\b/i.test(n.headline ?? ''));
  for (const n of riskNews) evidence.push({ kind: 'dilution', title: n.headline, url: validUrl(n.url), publishedAt: n.time, source: n.source ?? 'Alpaca news', confidence: 'headline_only' });
  if (review?.issuance && !riskNews.length && !dilution.length) { add('penalty', -15, `원문 확인: 신규 주식 ${review.issuance.toLocaleString('en-US')}주 실제 발행`); evidence.push({kind:'dilution',title:'ATM 실제 발행 원문 확인',url:review.source,publishedAt:review.publishedAt,period:review.period,source:'SEC 10-Q',confidence:'primary_review'}); }
  if (dilution.length || riskNews.length) add('penalty', -15, `12개월 희석 관련 공시 ${dilution.length}건·뉴스 ${riskNews.length}건 (등록은 실제 발행 확정 아님)`);
  if (f.sharesYoY > 0.1) add('penalty', -10, `주식 수 YoY +${(f.sharesYoY * 100).toFixed(1)}%`);
  if (f.runway !== null && f.runway < 12) add('penalty', -15, `연간/TTM 영업현금흐름 기준 런웨이 약 ${f.runway.toFixed(1)}개월`, [f.cash, f.ocf]);
  if (f.runway !== null && f.runway < 6) excluded.push('현금 런웨이 6개월 미만');
  if (distress.length) excluded.push('12개월 내 위험·중대 공시');
  const offeringChecked = newsStatus === 'ok' && source === 'SEC' && company?.fetchedAt && Date.parse(company.fetchedAt) <= cutoff && Date.parse(asOf) - Date.parse(company.fetchedAt) <= 35 * DAY;
  if (!offeringChecked) warnings.push('공시·뉴스 수집 불완전 — ATM/워런트/전환사채 위험 미확인');
  warnings.push('뉴스는 최대 5페이지·250건, 공시는 최근 수집분으로 제한되어 오래된 계약·희석 조건이 누락될 수 있음');
  warnings.push('미행사 워런트 수량·행사가·ATM 잔액·전환 조건은 원문 확인 필요');
  if (f.runway === null && !(f.ocf?.value >= 0)) warnings.push('현금 런웨이 데이터 부족');
  const improving = components.growth >= 15 || components.profitability >= 15;
  if (m.ret63 <= 0.15 && m.drawdown >= 0.3) add('neglect', 15, `고점 대비 -${(m.drawdown * 100).toFixed(1)}%, 3개월 ${(m.ret63 * 100).toFixed(1)}% — 가격 기반 소외 대용지표`);
  if (f.revenue?.value > 0 && cap > 0 && improving && cap / f.revenue.value <= 3) add('value', 10, `매출 대비 시총 ${(cap / f.revenue.value).toFixed(2)}배 (업종별 적정가 아님)`, [f.revenue]);
  const b = m.bars.slice(-63); const recent = b.slice(-21); const earlier = b.slice(0, -21);
  if (b.length === 63 && Math.min(...recent.map((x) => x.low)) >= Math.min(...earlier.map((x) => x.low)) && mean(recent.map((x) => x.volume)) < mean(earlier.map((x) => x.volume))) add('base', 10, '최근 1개월 신저가 없음·거래량 감소 (매집 확정 아님)');
  if (m.ret63 > 0.2) add('penalty', -10, '3개월 +20% 초과 — 선반영 감점');
  if (!improving && !catalyst && !review) excluded.push('실적 변곡점·구체적 촉매 없음');
  const latestReport = [...f.revenueQuarterly, ...ni].sort((a, b) => b.end.localeCompare(a.end))[0];
  if (!latestReport || Date.parse(asOf) - Date.parse(latestReport.end) > 200 * DAY) warnings.push('최근 분기 재무 데이터 부족 또는 200일 이상 경과');
  const score = Math.max(0, Math.min(100, Object.values(components).reduce((a, b) => a + b, 0)));
  const cashSafetyKnown = f.runway !== null || f.cash && Date.parse(asOf)-Date.parse(f.cash.end)<=200*DAY && f.cashFlowFresh && f.ocf?.value >= 0;
  const status = excluded.length ? 'excluded' : score >= EARLY_RULES.minScore && improving && capBasis === 'reported' && cashSafetyKnown && offeringChecked && latestReport && Date.parse(asOf) - Date.parse(latestReport.end) <= 200 * DAY ? 'candidate' : 'watch';
  return { symbol: row.symbol, ticker: row.ticker ?? row.symbol, name: row.name, sector: row.sector, asOf, model: EARLY_MODEL, score, status, components, reasons, warnings, excluded,
    price: m.price, marketCap: cap, capMethod, capBasis, ret63: m.ret63, drawdown: m.drawdown, adv20: m.adv20,
    revenueYoY: yoy, evidence, qualityReview: review ? {period:review.period,publishedAt:review.publishedAt,source:review.source} : null, risk: { level: review?.issuance || dilution.length || riskNews.length || f.runway !== null && f.runway < 12 ? 'high' : offeringChecked ? 'review' : 'unknown', dilutionFilings: dilution.length, runwayMonths: f.runway, sharesYoY: f.sharesYoY, checked: Boolean(offeringChecked) },
    newsStatus, fetchedAt: company?.fetchedAt ?? null };
}
