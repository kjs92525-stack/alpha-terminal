// Per-symbol features as of a given close. Uses only bars with time <= asOf and
// filings with filingDate <= asOf (no look-ahead).

import { sma, ema, rsi, atr } from '../analysis/indicators.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

function retN(c, n, skip = 0) {
  const e = c.length - 1 - skip;
  const s = e - n;
  return s >= 0 && c[s] > 0 ? c[e] / c[s] - 1 : null;
}

function annVol(c, n) {
  if (c.length < n + 1) return null;
  const r = [];
  for (let i = c.length - n; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  const m = mean(r);
  return Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252);
}

function maxDD(c) {
  let peak = -Infinity;
  let dd = 0;
  for (const v of c) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }
  return dd;
}

const DAY = 86400000;

export function computeFeatures(allBars, company, asOfIso) {
  const asOfSec = Date.parse(`${asOfIso}T00:00:00Z`) / 1000;
  const bars = allBars.filter((b) => b.time <= asOfSec);
  const n = bars.length;
  if (!n) return null;
  const last = bars[n - 1];
  const c = bars.map((b) => b.close);
  const price = last.close;
  const lastDate = new Date(last.time * 1000).toISOString().slice(0, 10);
  const yr = bars.slice(-252);
  const high52 = Math.max(...yr.map((b) => b.high));
  const s50 = sma(c, 50)[n - 1];
  const s200 = sma(c, 200)[n - 1];
  const e20 = ema(c, 20)[n - 1];
  const a14 = atr(bars, 14)[n - 1];
  const v5 = mean(bars.slice(-5).map((b) => b.volume));
  const v60 = mean(bars.slice(-60).map((b) => b.volume));
  const prior20High = n > 21 ? Math.max(...bars.slice(-21, -1).map((b) => b.high)) : null;

  const f = company?.facts ?? null;
  const shares = f?.sharesOutstanding?.value ?? null;
  const mcap = isNum(shares) ? shares * price : null;
  const rev = f?.revenue?.value ?? null;
  const ni = f?.netIncome?.value ?? null;
  const ocf = f?.operatingCashFlow?.value ?? null;

  const asOfMs = Date.parse(`${asOfIso}T00:00:00Z`);
  const visible = (company?.filings ?? []).filter((x) => x.filingDate && Date.parse(x.filingDate) <= asOfMs);
  const within = (x, days) => asOfMs - Date.parse(x.filingDate) <= days * DAY;
  const dilution365 = visible.filter((x) => x.category === 'DILUTION' && x.importance !== 'low' && within(x, 365)).length;
  const dilution30 = visible.filter((x) => x.category === 'DILUTION' && x.importance !== 'low' && within(x, 30)).length;
  const distress180 = visible.filter((x) => (x.category === 'DISTRESS' || x.importance === 'critical') && within(x, 180)).length;
  const recentEvents = [...new Set(visible.filter((x) => within(x, 3) && ['EARNINGS', 'CONTRACT', 'M&A', 'DILUTION', 'DISTRESS'].includes(x.category)).map((x) => x.category))];

  return {
    lastDate,
    bars: n,
    price,
    adv20: mean(bars.slice(-20).map((b) => b.close * b.volume)),
    mcap,
    // --- mid/long-term ---
    mom_12_1: retN(c, 231, 21),
    mom_6_1: retN(c, 105, 21),
    high52_prox: high52 > 0 ? price / high52 : null,
    trend_200: isNum(s200) ? price / s200 - 1 : null,
    ma_50_200: isNum(s50) && isNum(s200) ? s50 / s200 - 1 : null,
    vol_60: annVol(c, 60),
    max_dd_1y: maxDD(yr.map((b) => b.close)),
    rev_growth: f?.revenueGrowth ?? null,
    net_margin: f?.netMargin ?? null,
    ocf_margin: isNum(ocf) && rev > 0 ? ocf / rev : null,
    sales_yield: isNum(mcap) && mcap > 0 && isNum(rev) ? rev / mcap : null,
    earn_yield: isNum(mcap) && mcap > 0 && isNum(ni) ? ni / mcap : null,
    cf_yield: isNum(mcap) && mcap > 0 && isNum(ocf) ? ocf / mcap : null,
    shares_yoy: f?.sharesYoY ?? null,
    runway_months: f?.runwayMonths ?? null,
    dilution_365: dilution365,
    dilution_30: dilution30,
    distress_180: distress180,
    // --- short-term ---
    ret_5: retN(c, 5),
    ret_1: retN(c, 1),
    rsi_14: rsi(c, 14)[n - 1],
    dist_ema20: isNum(e20) ? price / e20 - 1 : null,
    rel_vol: isNum(v5) && v60 ? v5 / v60 : null,
    breakout_20: isNum(prior20High) ? (price > prior20High ? 1 : 0) : null,
    atr_pct: isNum(a14) ? a14 / price : null,
    recent_events: recentEvents,
  };
}
