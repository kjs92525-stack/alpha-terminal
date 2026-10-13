// Cross-sectional ranking. Each feature is converted to a percentile among eligible
// stocks (direction-adjusted), features roll up into factors, factors into a 0–100 score.
//
// MODEL STATUS: v1 weights are documented priors from the factor literature
// (momentum, quality, value, low-risk; short-term trend + pullback + flow).
// They are NOT yet fitted or validated on this data — P3 backtests will test them
// and the performance ledger tracks them live from day one.

export const MODEL_VERSION = 'xs-v1-prior';

export const MID_FACTORS = {
  momentum: { weight: 0.30, features: [['mom_12_1', 1], ['mom_6_1', 1], ['high52_prox', 1]] },
  quality: { weight: 0.25, features: [['net_margin', 1], ['ocf_margin', 1], ['rev_growth', 1], ['shares_yoy', -1]] },
  value: { weight: 0.20, features: [['sales_yield', 1], ['earn_yield', 1], ['cf_yield', 1]] },
  lowrisk: { weight: 0.15, features: [['vol_60', -1], ['max_dd_1y', 1]] },
  trend: { weight: 0.10, features: [['trend_200', 1], ['ma_50_200', 1]] },
};

export const SHORT_FACTORS = {
  trend: { weight: 0.35, features: [['trend_200', 1], ['mom_6_1', 1]] },
  pullback: { weight: 0.25, features: [['ret_5', -1], ['dist_ema20', -1]] },
  flow: { weight: 0.20, features: [['rel_vol', 1]] },
  breakout: { weight: 0.20, features: [['breakout_20', 1], ['high52_prox', 1]] },
};

export const ELIGIBILITY = {
  mid: { minPrice: 2, minAdv: 1e6, minBars: 260 },
  short: { minPrice: 2, minAdv: 1e6, minBars: 60 },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Percentile ranks in [0,1] with average ranks for ties; null stays null. */
export function percentiles(values) {
  const idx = values.map((v, i) => [v, i]).filter(([v]) => isNum(v)).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length).fill(null);
  const n = idx.length;
  if (!n) return out;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
    const p = n === 1 ? 0.5 : ((i + j) / 2) / (n - 1);
    for (let k = i; k <= j; k++) out[idx[k][1]] = p;
    i = j + 1;
  }
  return out;
}

export function eligible(f, horizon) {
  const e = ELIGIBILITY[horizon];
  return Boolean(f) && f.price >= e.minPrice && (f.adv20 ?? 0) >= e.minAdv && f.bars >= e.minBars;
}

/**
 * rows: [{ symbol, features, ... }]. Returns new rows with { score, coverage, factors, rank, percentile } for the horizon.
 */
export function rankHorizon(rows, horizon, { minCoverage = 0.6 } = {}) {
  const spec = horizon === 'mid' ? MID_FACTORS : SHORT_FACTORS;
  const pool = rows.filter((r) => eligible(r.features, horizon));
  const featNames = [...new Set(Object.values(spec).flatMap((f) => f.features.map(([n]) => n)))];
  const pct = {};
  for (const name of featNames) pct[name] = percentiles(pool.map((r) => r.features[name]));
  const totalW = Object.values(spec).reduce((s, f) => s + f.weight, 0);
  const scored = pool.map((r, i) => {
    const factors = {};
    let sum = 0;
    let w = 0;
    for (const [fname, f] of Object.entries(spec)) {
      const parts = f.features.map(([n, dir]) => { const p = pct[n][i]; return p === null ? null : dir > 0 ? p : 1 - p; }).filter((p) => p !== null);
      const v = parts.length ? parts.reduce((s, p) => s + p, 0) / parts.length : null;
      factors[fname] = v === null ? null : Math.round(v * 100);
      if (v !== null) { sum += v * f.weight; w += f.weight; }
    }
    const coverage = w / totalW;
    return { ...r, horizon, factors, coverage: Math.round(coverage * 100), score: coverage >= minCoverage ? Math.round((sum / w) * 1000) / 10 : null };
  });
  const ok = scored.filter((r) => r.score !== null).sort((a, b) => b.score - a.score);
  const n = ok.length;
  ok.forEach((r, i) => { r.rank = i + 1; r.percentile = n > 1 ? Math.round(((n - 1 - i) / (n - 1)) * 100) : 100; });
  return ok;
}

export const REC_FILTERS = {
  mid: { minPrice: 5, minAdv: 1e7, maxSharesYoY: 0.1, minRunway: 12, count: 30, sectorCap: 6 },
  short: { minPrice: 5, minAdv: 2e7, maxSharesYoY: 0.25, minRunway: 6, count: 20, sectorCap: 5 },
};

/** Why a ranked stock is excluded from recommendations (empty = passes). */
export function exclusionReasons(r, horizon) {
  const f = r.features;
  const c = REC_FILTERS[horizon];
  const out = [];
  if (f.price < c.minPrice) out.push(`가격 < $${c.minPrice}`);
  if ((f.adv20 ?? 0) < c.minAdv) out.push(`거래대금 < $${c.minAdv / 1e6}M`);
  if (isNum(f.shares_yoy) && f.shares_yoy > c.maxSharesYoY) out.push(`주식수 1년 +${(f.shares_yoy * 100).toFixed(0)}%`);
  if (isNum(f.runway_months) && f.runway_months < c.minRunway) out.push(`런웨이 ${f.runway_months.toFixed(0)}개월`);
  if (f.distress_180 > 0) out.push('최근 180일 위험 공시');
  if (horizon === 'short' && f.dilution_30 > 0) out.push('최근 30일 희석 공시');
  if (r.sector === 'Blank Check') out.push('SPAC');
  return out;
}

/** Top-N recommendations with a per-sector cap for diversification. */
export function selectRecommendations(ranked, horizon) {
  const c = REC_FILTERS[horizon];
  const perSector = {};
  const out = [];
  for (const r of ranked) {
    if (out.length >= c.count) break;
    if (exclusionReasons(r, horizon).length) continue;
    const s = r.sector ?? 'Unknown';
    if ((perSector[s] ?? 0) >= c.sectorCap) continue;
    perSector[s] = (perSector[s] ?? 0) + 1;
    out.push(r);
  }
  return out;
}
