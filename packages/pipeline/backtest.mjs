// Historical test of the base-breakout setup (chart rules only).
//
// For every stock and every day, finds the bars where detectSetup() would have said
// BREAKOUT using only data up to that bar, then simulates the trade the scanner
// proposes: buy next session's open, stop at the plan's structural stop (gaps fill at
// the open), otherwise exit at the close after h sessions. Results vs SPY.
//
// Honest limits, reported in the output:
//  - story signals are NOT tested (no point-in-time news/fundamentals history yet);
//  - universe = currently listed stocks (survivorship bias flatters results);
//  - no commissions/slippage beyond stop gaps.

import fs from 'node:fs';
import path from 'node:path';
import { sma } from '../analysis/indicators.mjs';
import { findBase, tradePlan, trendTemplate, relativeStrength, SETUP_RULES } from '../analysis/setups.mjs';

const HORIZONS = [20, 60, 120];

function rollingMax(values, w) {
  const out = new Array(values.length).fill(null);
  const dq = [];
  for (let i = 0; i < values.length; i++) {
    while (dq.length && values[dq[dq.length - 1]] <= values[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - w) dq.shift();
    if (i >= w - 1) out[i] = values[dq[0]];
  }
  return out;
}

/** Breakout events for one symbol using only data available at each bar. */
export function findBreakoutEvents(bars, rules = SETUP_RULES) {
  const n = bars.length;
  const highs = bars.map((b) => b.high);
  const max126 = rollingMax(highs, 126);
  const vol50 = sma(bars.map((b) => b.volume), 50);
  const events = [];
  let cooldownUntil = -1;
  for (let i = 300; i < n; i++) {
    if (i < cooldownUntil) continue;
    // cheap prefilter: any qualifying base (>=126 bars) has a high >= the 126-bar max
    if (max126[i - 1] === null || bars[i].close <= max126[i - 1]) continue;
    if (!(vol50[i - 1] > 0) || bars[i].volume / vol50[i - 1] < rules.breakoutVolMult) continue;
    const base = findBase(bars, i - 1, rules);
    if (!base || bars[i].close <= base.high || bars[i - 1].close > base.high) continue;
    events.push({ index: i, base, volMult: bars[i].volume / vol50[i - 1] });
    cooldownUntil = i + 40; // one event per breakout leg
  }
  return events;
}

/** Simulate one trade from a breakout event. */
export function simulate(bars, ev, spyByTime) {
  const slice = bars.slice(0, ev.index + 1);
  const setup = { stage: 'BREAKOUT', base: ev.base, pivot: ev.base.high };
  const plan = tradePlan(slice, setup);
  const entryIdx = ev.index + 1;
  if (!plan || entryIdx >= bars.length) return null;
  const entry = bars[entryIdx].open;
  const stop = plan.stop;
  if (!(entry > stop)) return null;
  const tt = trendTemplate(slice);
  const out = { time: bars[ev.index].time, entry, stop, riskPct: (entry - stop) / entry, baseMonths: Math.round(ev.base.window / 21), depth: ev.base.depth, quality: ev.base.quality, volMult: ev.volMult, trendOk: tt.passed >= 6, results: {} };
  const spyEntry = spyByTime.get(bars[entryIdx].time)?.open;
  for (const h of HORIZONS) {
    const last = entryIdx + h - 1;
    if (last >= bars.length) { out.results[h] = null; continue; }
    let exit = bars[last].close;
    let stopped = false;
    for (let j = entryIdx; j <= last; j++) {
      const b = bars[j];
      if (b.low <= stop) { exit = Math.min(b.open, stop); stopped = true; break; } // gap below stop fills at the open
    }
    const ret = exit / entry - 1;
    const spyExit = spyByTime.get(bars[last].time)?.close;
    out.results[h] = { ret, r: ret / ((entry - stop) / entry), stopped, spy: spyEntry && spyExit ? spyExit / spyEntry - 1 : null };
  }
  return out;
}

const pct = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

export function summarize(trades, h) {
  const rs = trades.map((t) => t.results[h]).filter(Boolean);
  if (!rs.length) return { n: 0 };
  const rets = rs.map((r) => r.ret);
  const excess = rs.filter((r) => r.spy !== null).map((r) => r.ret - r.spy);
  return {
    n: rs.length,
    winRate: rs.filter((r) => r.ret > 0).length / rs.length,
    stoppedRate: rs.filter((r) => r.stopped).length / rs.length,
    avgReturn: avg(rets), medianReturn: pct(rets, 0.5),
    avgR: avg(rs.map((r) => r.r)),
    avgExcessVsSpy: avg(excess),
    bigWinners: rs.filter((r) => r.ret >= 0.5).length / rs.length,
    p10: pct(rets, 0.1), p90: pct(rets, 0.9),
  };
}

/**
 * barsBySymbol: { SYMBOL: Bar[] } (adjusted daily), spy: Bar[].
 * Returns the report object (also usable in tests).
 */
export function runBreakoutBacktest(barsBySymbol, spy, { caseStudies = ['PLTR'] } = {}) {
  const spyByTime = new Map(spy.map((b) => [b.time, b]));
  const trades = [];
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!bars || bars.length < 400) continue;
    for (const ev of findBreakoutEvents(bars)) {
      const t = simulate(bars, ev, spyByTime);
      if (t) trades.push({ symbol, ...t, rsNewHigh: relativeStrength(bars.slice(0, ev.index + 1), spy).rsNewHigh });
    }
  }
  const groups = {
    all: trades,
    trendTemplateOk: trades.filter((t) => t.trendOk),
    longBase9mPlus: trades.filter((t) => t.baseMonths >= 9),
    highQualityBase: trades.filter((t) => t.quality >= 2),
    rsNewHigh: trades.filter((t) => t.rsNewHigh),
    tightRisk8pct: trades.filter((t) => t.riskPct <= 0.08),
  };
  const report = {};
  for (const [g, ts] of Object.entries(groups)) report[g] = Object.fromEntries(HORIZONS.map((h) => [`${h}d`, summarize(ts, h)]));
  const fmtDate = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  return {
    generatedAt: new Date().toISOString(),
    rules: SETUP_RULES,
    method: '각 거래일까지의 데이터만으로 BREAKOUT 판정 → 다음 거래일 시가 매수, 계획 손절가 이탈 시 손절(갭은 시가 체결), 아니면 h거래일 후 종가 청산. SPY 대비.',
    limits: ['스토리 점수는 과거 시점 데이터가 없어 미검증 (차트 규칙만 검증)', '현재 상장 종목만 사용 → 상장폐지 종목 누락으로 결과가 좋게 나올 수 있음 (생존 편향)', '수수료·슬리피지 미반영 (손절 갭만 반영)'],
    trades: trades.length,
    symbols: Object.keys(barsBySymbol).length,
    report,
    caseStudies: Object.fromEntries(caseStudies.map((s) => [s, trades.filter((t) => t.symbol === s).map((t) => ({ date: fmtDate(t.time), entry: t.entry, stop: t.stop, baseMonths: t.baseMonths, results: t.results }))])),
    recent: trades.slice(-50).map((t) => ({ symbol: t.symbol, date: fmtDate(t.time), baseMonths: t.baseMonths, r60: t.results[60]?.r ?? null })),
  };
}

/** Load cached bars written by the nightly pipeline (or the backtest's own long-history cache). */
export function loadBarsDir(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      out[f.slice(0, -5)] = arr.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
    } catch { /* skip corrupt file */ }
  }
  return out;
}
