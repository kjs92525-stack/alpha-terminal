// ALPHA TERMINAL — "long base → breakout" setup detection.
//
// Looks for the chart the user trades: a stock that spent 6–18 months building a
// base (bottoming, higher lows, contracting volatility, drying volume) and is now
// breaking out of it on volume, with a defined entry, stop and measured target.
// Every check uses bars up to and including the evaluated bar only.
//
// Literature: Weinstein stage analysis (stage 1 base → stage 2 advance),
// O'Neil/Minervini base breakouts, trend template, volatility contraction.

import { sma, atr, marketStructure, orderBlocks } from './indicators.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

export const SETUP_RULES = {
  baseWindows: [126, 189, 252, 378], // ~6, 9, 12, 18 months
  maxDepth: 0.5, // base high-to-low depth
  minDepth: 0.12, // shallower than this is a flag/tight range, not a base
  breakoutVolMult: 1.4, // breakout bar volume vs 50-day average
  lookbackBreakout: 10, // bars after a breakout still treated as actionable
  maxExtension: 0.12, // above pivot beyond this = extended, do not chase
  nearPivot: 0.06, // within 6% below pivot = setting up
  minBelowPeak: 0.2, // base ceiling must sit >= 20% under the earlier peak — a bottom, not a high
  peakLookbackDays: 365 * 5,
  maxAboveLow: 0.3, // base low within 30% of the multi-year low — the actual bottom, not a pause after a rally
  lowLookbackDays: 365 * 3,
};

/** Minervini-style trend template (8 checks). */
export function trendTemplate(bars) {
  const c = bars.map((b) => b.close);
  const n = c.length;
  if (n < 220) return { passed: 0, total: 8, checks: {}, ok: false };
  const s50 = sma(c, 50)[n - 1];
  const s150 = sma(c, 150)[n - 1];
  const s200 = sma(c, 200);
  const s200Now = s200[n - 1];
  const s200Prev = s200[n - 22];
  const yr = bars.slice(-252);
  const hi = Math.max(...yr.map((b) => b.high));
  const lo = Math.min(...yr.map((b) => b.low));
  const p = c[n - 1];
  const checks = {
    above150and200: p > s150 && p > s200Now,
    ma150over200: s150 > s200Now,
    ma200rising: isNum(s200Prev) && s200Now > s200Prev,
    ma50over150: s50 > s150,
    above50: p > s50,
    up30fromLow: p >= lo * 1.3,
    within25ofHigh: p >= hi * 0.75,
    rsPositive: true, // filled by caller with relative strength
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return { passed, total: 8, checks, ok: passed >= 7 };
}

/** Relative strength line vs a benchmark aligned by bar time. */
export function relativeStrength(bars, bench) {
  const bmap = new Map(bench.map((b) => [b.time, b.close]));
  const rs = [];
  for (const b of bars) { const x = bmap.get(b.time); if (x) rs.push({ time: b.time, v: b.close / x }); }
  if (rs.length < 130) return { rsNewHigh: false, rs3m: null, rs12m: null };
  const vals = rs.map((r) => r.v);
  const last = vals.length - 1;
  const yrMax = Math.max(...vals.slice(-252, -5));
  const recentMax = Math.max(...vals.slice(-5));
  return {
    rsNewHigh: recentMax >= yrMax,
    rs3m: vals[last] / vals[Math.max(0, last - 63)] - 1,
    rs12m: vals[last] / vals[Math.max(0, last - 252)] - 1,
  };
}

function baseStats(bars, endIdx, W) {
  const start = endIdx - W + 1;
  if (start < 0) return null;
  const seg = bars.slice(start, endIdx + 1);
  let hi = -Infinity;
  let lo = Infinity;
  let hiIdx = 0;
  let loIdx = 0;
  seg.forEach((b, i) => { if (b.high > hi) { hi = b.high; hiIdx = i; } if (b.low < lo) { lo = b.low; loIdx = i; } });
  const third = Math.floor(W / 3);
  const lowFirst = Math.min(...seg.slice(0, third).map((b) => b.low));
  const lowLast = Math.min(...seg.slice(-third).map((b) => b.low));
  const range = (arr) => mean(arr.map((b) => (b.high - b.low) / b.close));
  const volFirst = mean(seg.slice(0, third).map((b) => b.volume));
  const volLast = mean(seg.slice(-Math.min(20, third)).map((b) => b.volume));
  return {
    window: W, start, end: endIdx, high: hi, low: lo, depth: 1 - lo / hi,
    highAgeBars: W - 1 - hiIdx, lowAgeBars: W - 1 - loIdx,
    higherLows: lowLast > lowFirst * 1.03,
    contraction: range(seg.slice(-20)) < range(seg.slice(0, third)) * 0.8,
    volumeDryUp: isNum(volFirst) && volFirst > 0 ? volLast < volFirst * 0.85 : false,
  };
}

/**
 * Highest high before `beforeTime` within the lookback, from daily bars and (optionally)
 * long monthly history. null when there is no earlier history (e.g. a recent IPO).
 */
export function priorPeak(bars, startIdx, monthly = null, lookbackDays = SETUP_RULES.peakLookbackDays) {
  const t = bars[startIdx]?.time;
  if (t === undefined) return null;
  const from = t - lookbackDays * 86400;
  let peak = null;
  for (let i = 0; i < startIdx; i++) if (bars[i].time >= from && (peak === null || bars[i].high > peak)) peak = bars[i].high;
  // monthly bars: only months that ended before the window started
  for (const m of monthly ?? []) if (m.time >= from && m.time + 31 * 86400 <= t && (peak === null || m.high > peak)) peak = m.high;
  return peak;
}

/** Lowest low within the lookback before `startIdx` (daily + monthly history); null without history. */
export function priorLow(bars, startIdx, monthly = null, lookbackDays = SETUP_RULES.lowLookbackDays) {
  const t = bars[startIdx]?.time;
  if (t === undefined) return null;
  const from = t - lookbackDays * 86400;
  let low = null;
  for (let i = 0; i < startIdx; i++) if (bars[i].time >= from && (low === null || bars[i].low < low)) low = bars[i].low;
  for (const m of monthly ?? []) if (m.time >= from && m.time + 31 * 86400 <= t && (low === null || m.low < low)) low = m.low;
  return low;
}

/**
 * Best (longest qualifying) base ending at endIdx. A base is a BOTTOM: the stock fell from an
 * earlier peak and moves sideways well below it. Ranges near all-time highs are not bases here.
 */
export function findBase(bars, endIdx, rules = SETUP_RULES, monthly = null) {
  let best = null;
  for (const W of rules.baseWindows) {
    const s = baseStats(bars, endIdx, W);
    if (!s) continue;
    if (s.depth > rules.maxDepth || s.depth < rules.minDepth) continue;
    const peak = priorPeak(bars, s.start, monthly, rules.peakLookbackDays);
    if (peak !== null && s.high > peak * (1 - rules.minBelowPeak)) continue;
    // e.g. ROKU Oct-2026: 104–160 range after tripling from ~50 is a pause in an advance, not a bottom
    const floor = priorLow(bars, s.start, monthly, rules.lowLookbackDays);
    if (floor !== null && s.low > Math.min(floor, s.low) * (1 + rules.maxAboveLow)) continue;
    s.priorPeak = peak;
    s.multiYearLow = floor === null ? s.low : Math.min(floor, s.low);
    // a window that starts in the middle of the prior decline would take a point on the way
    // down as the 'ceiling'; require the bars just before the window to sit at/below it.
    const pre = bars.slice(Math.max(0, s.start - 20), s.start);
    if (pre.length && Math.max(...pre.map((x) => x.high)) > s.high * 1.03) continue;
    // the low must not be at the very end (that's a breakdown, not a base)
    if (s.lowAgeBars < 15) continue;
    // the pivot (base high) should be at least a few weeks old so there is a real ceiling
    if (s.highAgeBars < 10) continue;
    const quality = (s.higherLows ? 1 : 0) + (s.contraction ? 1 : 0) + (s.volumeDryUp ? 1 : 0);
    if (!best || W > best.window || quality > best.quality) best = { ...s, quality };
  }
  return best;
}

/**
 * Classify the latest bar against its base.
 * stage: BREAKOUT (today), POST_BREAKOUT (≤10 bars ago, not extended), EXTENDED,
 *        NEAR_PIVOT (≤6% below pivot), IN_BASE, NONE.
 */
export function detectSetup(bars, rules = SETUP_RULES, monthly = null) {
  const n = bars.length;
  if (n < 160) return { stage: 'NONE', reason: 'insufficient history' };
  const vol50 = sma(bars.map((b) => b.volume), 50);
  const last = bars[n - 1];
  // breakout within the last N bars: bar k closes above the base that ended at k-1
  for (let k = 0; k <= rules.lookbackBreakout; k++) {
    const i = n - 1 - k;
    const base = findBase(bars, i - 1, rules, monthly);
    if (!base) continue;
    const bar = bars[i];
    const volMult = isNum(vol50[i - 1]) && vol50[i - 1] > 0 ? bar.volume / vol50[i - 1] : null;
    if (bar.close > base.high && bars[i - 1].close <= base.high && volMult !== null && volMult >= rules.breakoutVolMult) {
      const ext = last.close / base.high - 1;
      const stage = k === 0 ? 'BREAKOUT' : ext > rules.maxExtension ? 'EXTENDED' : last.close < base.high * 0.97 ? 'FAILED' : 'POST_BREAKOUT';
      return { stage, base, pivot: base.high, breakoutIndex: i, barsSinceBreakout: k, breakoutVolMult: volMult, extension: ext };
    }
  }
  const base = findBase(bars, n - 1, rules, monthly);
  if (!base) return { stage: 'NONE' };
  const gap = 1 - last.close / base.high;
  if (gap >= 0 && gap <= rules.nearPivot) return { stage: 'NEAR_PIVOT', base, pivot: base.high, distanceToPivot: gap };
  return { stage: 'IN_BASE', base, pivot: base.high, distanceToPivot: gap };
}

/**
 * Entry / stop / target. Stop prefers the nearest structural support below entry:
 * an unmitigated bullish order block, the base's rising low (last third), then the base low.
 */
export function tradePlan(bars, setup) {
  if (!setup?.base) return null;
  const n = bars.length;
  const a = atr(bars, 14)[n - 1] ?? 0;
  const entry = setup.stage === 'POST_BREAKOUT' || setup.stage === 'EXTENDED' ? Math.max(setup.pivot, bars[n - 1].close * 0.98) : setup.pivot;
  const structure = marketStructure(bars, { lastBarClosed: true });
  const obs = orderBlocks(bars, structure.events).filter((o) => o.direction === 'bull' && o.mitigatedIndex === null && o.top < entry);
  const ob = obs.sort((x, y) => y.top - x.top)[0] ?? null;
  const third = Math.floor(setup.base.window / 3);
  const risingLow = Math.min(...bars.slice(setup.base.end - third + 1, setup.base.end + 1).map((b) => b.low));
  const candidates = [
    ob ? { price: ob.bottom, kind: '오더블록 하단' } : null,
    { price: risingLow, kind: '바닥 마지막 저점' },
    { price: setup.base.low, kind: '바닥 최저점' },
  ].filter((c) => c && c.price < entry - a * 0.5);
  const stop = candidates.sort((x, y) => y.price - x.price)[0] ?? { price: entry - 2 * a, kind: 'ATR×2' };
  const target = entry + (setup.base.high - setup.base.low); // measured move = base height
  const risk = (entry - stop.price) / entry;
  const $ = (v) => `$${v.toFixed(2)}`;
  const how = setup.stage === 'NEAR_PIVOT' || setup.stage === 'IN_BASE'
    ? `돌파가 ${$(setup.pivot)}를 거래량 실어 종가로 넘기면 매수 (넘기 전엔 대기) · 손절 ${$(stop.price)}`
    : setup.stage === 'EXTENDED'
      ? `추격 금지 — 돌파가 ${$(setup.pivot)} 부근까지 되돌림 시 매수 검토 · 손절 ${$(stop.price)}`
      : `돌파가 ${$(setup.pivot)}~${$(setup.pivot * 1.05)} 구간에서 매수 (5% 이상 위면 추격 금지) · 손절 ${$(stop.price)}`;
  return {
    entry, stop: stop.price, stopKind: stop.kind, target, riskPct: risk, how,
    entryType: setup.stage === 'NEAR_PIVOT' || setup.stage === 'IN_BASE' ? 'buy-stop' : 'limit',
    rMultiple: entry > stop.price ? (target - entry) / (entry - stop.price) : null,
    orderBlock: ob ? { top: ob.top, bottom: ob.bottom } : null,
    note: risk > 0.12 ? '손절폭이 넓음 — 비중 축소 또는 되돌림 진입 고려' : null,
  };
}

/** One-call evaluation used by the pipeline and the backtest. */
export function evaluateChart(bars, bench, monthly = null) {
  const setup = detectSetup(bars, SETUP_RULES, monthly);
  const tt = trendTemplate(bars);
  const rs = bench ? relativeStrength(bars, bench) : { rsNewHigh: false, rs3m: null, rs12m: null };
  if (tt.checks) { tt.checks.rsPositive = isNum(rs.rs3m) ? rs.rs3m > 0 : false; tt.passed = Object.values(tt.checks).filter(Boolean).length; tt.ok = tt.passed >= 7; }
  const plan = tradePlan(bars, setup);
  // chart score: stage 40, base quality 20, trend template 25, RS 15
  const stagePts = { BREAKOUT: 40, POST_BREAKOUT: 34, NEAR_PIVOT: 28, EXTENDED: 12, IN_BASE: 10, FAILED: 0, NONE: 0 }[setup.stage] ?? 0;
  const basePts = setup.base ? Math.round((setup.base.quality / 3) * 14 + Math.min(1, setup.base.window / 252) * 6) : 0;
  const ttPts = Math.round((tt.passed / 8) * 25);
  const rsPts = (rs.rsNewHigh ? 10 : 0) + (isNum(rs.rs3m) && rs.rs3m > 0 ? 5 : 0);
  return { setup, trend: tt, rs, plan, chartScore: stagePts + basePts + ttPts + rsPts };
}
