// ALPHA TERMINAL — transparent rule-based multi-factor scoring.
//
// This is a deterministic quant model, not a prediction engine. Scores are
// relative attractiveness ratings (0–100) built from documented thresholds.
// Nothing here is a probability, and scenario ranges are historical-volatility
// bands, not forecasts.

import { sma, rsi, atr, supportResistance } from './indicators.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const ramp = (x, lo, hi) => (isNum(x) ? Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100)) : null);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const avgDefined = (a) => mean(a.filter(isNum));

function stdev(a) {
  const m = mean(a);
  if (m === null || a.length < 2) return null;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

function ret(closes, n, skip = 0) {
  const end = closes.length - 1 - skip;
  const start = end - n;
  if (start < 0) return null;
  return closes[end] / closes[start] - 1;
}

function annualVol(closes, n) {
  if (closes.length < n + 1) return null;
  const r = [];
  for (let i = closes.length - n; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const s = stdev(r);
  return s === null ? null : s * Math.sqrt(252);
}

function maxDrawdown(closes) {
  let peak = -Infinity;
  let dd = 0;
  for (const c of closes) { peak = Math.max(peak, c); dd = Math.min(dd, c / peak - 1); }
  return dd;
}

/** Raw metrics from daily bars plus optional SEC fundamentals summary and classified filings. */
export function computeMetrics(bars, fundamentals = null, filings = [], asOf = null) {
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const price = n ? closes[n - 1] : null;
  const s50 = sma(closes, 50)[n - 1];
  const s200 = sma(closes, 200)[n - 1];
  const r14 = rsi(closes, 14)[n - 1];
  const a14 = atr(bars, 14)[n - 1];
  const yr = bars.slice(-252);
  const high52 = yr.length ? Math.max(...yr.map((b) => b.high)) : null;
  const low52 = yr.length ? Math.min(...yr.map((b) => b.low)) : null;
  const dv = bars.slice(-20).map((b) => b.close * b.volume);
  const v5 = mean(bars.slice(-5).map((b) => b.volume));
  const v60 = mean(bars.slice(-60).map((b) => b.volume));

  const shares = fundamentals?.sharesOutstanding?.value ?? null;
  const marketCap = isNum(shares) && isNum(price) ? shares * price : null;
  const revenue = fundamentals?.revenue?.value ?? null;
  const ni = fundamentals?.netIncome?.value ?? null;
  const ref = asOf ?? (n ? new Date(bars[n - 1].time * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const cutoff = new Date(ref).getTime() - 365 * 86400000;
  const dilutionFilings = (filings || []).filter((f) => f.category === 'DILUTION' && f.importance !== 'low' && new Date(f.filingDate).getTime() >= cutoff);

  return {
    asOf: ref,
    bars: n,
    price,
    ret1m: ret(closes, 21),
    ret3m: ret(closes, 63),
    ret6m: ret(closes, 126),
    ret12m1: ret(closes, 231, 21),
    high52,
    low52,
    distHigh52: isNum(high52) && isNum(price) ? price / high52 - 1 : null,
    sma50: isNum(s50) ? s50 : null,
    sma200: isNum(s200) ? s200 : null,
    rsi14: isNum(r14) ? r14 : null,
    atrPct: isNum(a14) && price ? a14 / price : null,
    vol20: annualVol(closes, 20),
    vol60: annualVol(closes, 60),
    maxDD1y: yr.length ? maxDrawdown(yr.map((b) => b.close)) : null,
    adv20Usd: dv.length ? mean(dv) : null,
    relVolume: isNum(v5) && v60 ? v5 / v60 : null,
    marketCap,
    priceToSales: isNum(marketCap) && revenue > 0 ? marketCap / revenue : null,
    priceToEarnings: isNum(marketCap) && ni > 0 ? marketCap / ni : null,
    revenueGrowth: fundamentals?.revenueGrowth ?? null,
    netMargin: fundamentals?.netMargin ?? null,
    operatingCashFlow: fundamentals?.operatingCashFlow?.value ?? null,
    runwayMonths: fundamentals?.runwayMonths ?? null,
    sharesYoY: fundamentals?.sharesYoY ?? null,
    dilutionFilings365d: dilutionFilings.length,
    hasFundamentals: Boolean(fundamentals && (revenue !== null || shares !== null)),
  };
}

export function sizeBucket(marketCap) {
  if (!isNum(marketCap)) return 'unknown';
  if (marketCap >= 200e9) return 'mega';
  if (marketCap >= 10e9) return 'large';
  if (marketCap >= 2e9) return 'mid';
  if (marketCap >= 300e6) return 'small';
  return 'micro';
}

export function styleBucket(m) {
  if (isNum(m.revenueGrowth) && m.revenueGrowth >= 0.15) return 'growth';
  if (isNum(m.priceToSales) && m.priceToSales >= 10) return 'growth';
  if (isNum(m.priceToEarnings) && m.priceToEarnings <= 18) return 'value';
  if (isNum(m.priceToSales) && m.priceToSales <= 1.5) return 'value';
  return 'blend';
}

export const FACTOR_WEIGHTS = { momentum: 0.22, trend: 0.18, quality: 0.2, valuation: 0.15, liquidity: 0.1, stability: 0.15 };

export function factorScores(m) {
  const momentum = avgDefined([ramp(m.ret3m, -0.25, 0.35), ramp(m.ret12m1, -0.4, 0.8), ramp(m.distHigh52, -0.5, 0)]);

  let trend = null;
  if (isNum(m.sma50) && isNum(m.price)) {
    trend = 0;
    if (m.price > m.sma50) trend += 30;
    if (isNum(m.sma200)) { if (m.price > m.sma200) trend += 30; if (m.sma50 > m.sma200) trend += 25; } else trend += 27;
    if (isNum(m.rsi14)) trend += m.rsi14 > 75 ? 5 : m.rsi14 >= 50 ? 15 : m.rsi14 >= 40 ? 7 : 0;
  }

  let runwayScore = null;
  if (isNum(m.operatingCashFlow)) runwayScore = m.operatingCashFlow >= 0 ? 100 : ramp(m.runwayMonths, 6, 36) ?? 0;
  const quality = avgDefined([
    ramp(m.revenueGrowth, -0.1, 0.4),
    ramp(m.netMargin, -0.3, 0.25),
    runwayScore,
    isNum(m.sharesYoY) ? ramp(-m.sharesYoY, -0.3, 0) : null,
  ]);

  const valuation = avgDefined([
    isNum(m.priceToSales) ? ramp(-Math.log10(m.priceToSales), -Math.log10(40), 0) : null,
    isNum(m.priceToEarnings) ? ramp(-m.priceToEarnings, -60, -8) : null,
  ]);

  const liquidity = isNum(m.adv20Usd) && m.adv20Usd > 0 ? ramp(Math.log10(m.adv20Usd), 6, 9) : null;

  const riskParts = [
    ramp(m.vol60 ?? m.vol20, 0.2, 1.2),
    isNum(m.maxDD1y) ? ramp(-m.maxDD1y, 0.1, 0.7) : null,
    isNum(m.adv20Usd) && m.adv20Usd > 0 ? 100 - ramp(Math.log10(m.adv20Usd), 6, 9) : null,
    isNum(m.runwayMonths) ? 100 - ramp(m.runwayMonths, 6, 36) : null,
    m.dilutionFilings365d > 0 ? Math.min(100, 40 + 20 * m.dilutionFilings365d) : null,
  ];
  const risk = avgDefined(riskParts);
  const stability = isNum(risk) ? 100 - risk : null;

  return { momentum, trend, quality, valuation, liquidity, stability, risk };
}

export function compositeScore(f) {
  let sum = 0;
  let w = 0;
  for (const [k, wt] of Object.entries(FACTOR_WEIGHTS)) {
    if (isNum(f[k])) { sum += f[k] * wt; w += wt; }
  }
  return { score: w > 0 ? Math.round(sum / w) : null, coverage: Math.round((w / Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0)) * 100) };
}

export function riskLevel(risk) {
  if (!isNum(risk)) return 'UNKNOWN';
  if (risk >= 65) return 'HIGH';
  if (risk >= 40) return 'MODERATE';
  return 'LOW';
}

export function ratingLabel(score) {
  if (!isNum(score)) return '데이터 부족';
  if (score >= 70) return '우선 관찰';
  if (score >= 55) return '관찰 후보';
  if (score >= 40) return '중립';
  return '주의';
}

const pct = (v, d = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;

/** Human-readable evidence, each line traceable to a metric. */
export function evidence(m) {
  const out = [];
  const add = (sign, factor, text) => out.push({ sign, factor, text });
  if (isNum(m.ret3m)) add(m.ret3m >= 0 ? '+' : '-', 'momentum', `3개월 수익률 ${pct(m.ret3m)}`);
  if (isNum(m.ret12m1)) add(m.ret12m1 >= 0 ? '+' : '-', 'momentum', `12-1개월 모멘텀 ${pct(m.ret12m1)}`);
  if (isNum(m.distHigh52)) add(m.distHigh52 > -0.1 ? '+' : '-', 'momentum', `52주 고점 대비 ${pct(m.distHigh52)}`);
  if (isNum(m.sma50) && isNum(m.price)) add(m.price > m.sma50 ? '+' : '-', 'trend', `종가 ${m.price > m.sma50 ? '>' : '<'} 50일 이평 (${m.sma50.toFixed(2)})`);
  if (isNum(m.sma200) && isNum(m.price)) add(m.price > m.sma200 ? '+' : '-', 'trend', `종가 ${m.price > m.sma200 ? '>' : '<'} 200일 이평 (${m.sma200.toFixed(2)})`);
  if (isNum(m.rsi14)) add(m.rsi14 > 75 || m.rsi14 < 35 ? '-' : '+', 'trend', `RSI(14) ${m.rsi14.toFixed(1)}${m.rsi14 > 75 ? ' — 과열' : m.rsi14 < 30 ? ' — 과매도' : ''}`);
  if (isNum(m.revenueGrowth)) add(m.revenueGrowth >= 0 ? '+' : '-', 'quality', `연간 매출 성장률 ${pct(m.revenueGrowth)} (SEC XBRL, 최근 회계연도)`);
  if (isNum(m.netMargin)) add(m.netMargin >= 0 ? '+' : '-', 'quality', `순이익률 ${pct(m.netMargin)}`);
  if (isNum(m.runwayMonths)) add(m.runwayMonths >= 18 ? '+' : '-', 'quality', `현금 런웨이 약 ${m.runwayMonths.toFixed(0)}개월 (연간 영업현금흐름 기준)`);
  if (isNum(m.sharesYoY)) add(m.sharesYoY <= 0.03 ? '+' : '-', 'quality', `유통주식수 1년 변화 ${pct(m.sharesYoY)}`);
  if (m.dilutionFilings365d > 0) add('-', 'risk', `최근 1년 희석 관련 공시 ${m.dilutionFilings365d}건 (S-1/S-3/424B/8-K 3.02)`);
  if (isNum(m.priceToSales)) add(m.priceToSales <= 5 ? '+' : '-', 'valuation', `P/S ${m.priceToSales.toFixed(1)}배`);
  if (isNum(m.priceToEarnings)) add(m.priceToEarnings <= 25 ? '+' : '-', 'valuation', `P/E ${m.priceToEarnings.toFixed(1)}배`);
  if (isNum(m.adv20Usd)) add(m.adv20Usd >= 2e7 ? '+' : '-', 'liquidity', `20일 평균 거래대금 $${(m.adv20Usd / 1e6).toFixed(1)}M`);
  if (isNum(m.vol60 ?? m.vol20)) add((m.vol60 ?? m.vol20) <= 0.5 ? '+' : '-', 'risk', `연환산 변동성 ${((m.vol60 ?? m.vol20) * 100).toFixed(0)}%`);
  return out;
}

/**
 * Bull / base / bear scenarios. Ranges are ±1σ one-month bands from realised
 * volatility; triggers come from confirmed support/resistance levels.
 */
export function scenarios(bars, m) {
  if (!bars.length || !isNum(m.price)) return null;
  const vol = m.vol60 ?? m.vol20;
  if (!isNum(vol)) return null;
  const sigma = vol * Math.sqrt(21 / 252);
  const levels = supportResistance(bars);
  const res = levels.filter((l) => l.kind === 'resistance').sort((a, b) => a.price - b.price)[0] ?? null;
  const sup = levels.filter((l) => l.kind === 'support').sort((a, b) => b.price - a.price)[0] ?? null;
  const p = m.price;
  return {
    horizon: '1개월',
    method: '60일 실현변동성 기반 ±1σ 범위 (예측·확률 아님)',
    sigmaPct: sigma,
    bull: {
      range: [p, p * (1 + sigma)],
      trigger: res ? `저항 ${res.price.toFixed(2)} 상향 돌파 후 종가 유지` : '최근 고점 상향 돌파',
    },
    base: { range: [p * (1 - sigma / 2), p * (1 + sigma / 2)], trigger: '지지·저항 사이 박스권 유지' },
    bear: {
      range: [p * (1 - sigma), p],
      trigger: sup ? `지지 ${sup.price.toFixed(2)} 하향 이탈 시 시나리오 무효화` : '최근 저점 하향 이탈',
    },
    nearestResistance: res?.price ?? null,
    nearestSupport: sup?.price ?? null,
  };
}

export function scoreStock(bars, fundamentals = null, filings = [], asOf = null) {
  const metrics = computeMetrics(bars, fundamentals, filings, asOf);
  const factors = factorScores(metrics);
  const { score, coverage } = compositeScore(factors);
  return {
    score,
    coverage,
    rating: ratingLabel(score),
    riskLevel: riskLevel(factors.risk),
    size: sizeBucket(metrics.marketCap),
    style: styleBucket(metrics),
    factors,
    metrics,
    evidence: evidence(metrics),
    scenarios: scenarios(bars, metrics),
    model: 'ALPHA-QUANT v0.3 (rule-based, deterministic)',
  };
}

/** Rank a universe and attach cross-sectional percentile of the composite score. */
export function rankUniverse(results) {
  const scored = results.filter((r) => isNum(r.score)).sort((a, b) => b.score - a.score);
  const n = scored.length;
  scored.forEach((r, i) => { r.rank = i + 1; r.percentile = n > 1 ? Math.round(((n - 1 - i) / (n - 1)) * 100) : 100; });
  return [...scored, ...results.filter((r) => !isNum(r.score))];
}
