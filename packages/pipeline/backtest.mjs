// Historical test of the base-breakout setup (chart rules only), plus the floor-turn research rule.
//
// For every stock and every day, finds the bars where detectSetup() would have said
// BREAKOUT using only data up to that bar, then simulates the trade the scanner
// proposes: buy next session's open, stop at the plan's structural stop (gaps fill at
// the open), otherwise exit at the close after h sessions. Results vs SPY.
//
// Honest limits, reported in the output:
//  - news is not tested; reported sales/net income are, but only with quarters already filed on
//    the trade date (story-pit.mjs) and only as far back as the cached filings go (~3 years);
//  - universe = currently listed stocks (survivorship bias flatters results);
//  - no commissions/slippage beyond stop gaps.

import fs from 'node:fs';
import { storyAsOf } from '../analysis/story-pit.mjs';
import { storyEvents, storyEventGroups } from './story-events.mjs';
import path from 'node:path';
import { sma } from '../analysis/indicators.mjs';
import { findBase, explainBase, tradePlan, trendTemplate, relativeStrength, SETUP_RULES } from '../analysis/setups.mjs';

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
    avgR: avg(rs.map((r) => r.r).filter((r) => typeof r === 'number' && Number.isFinite(r))),
    avgExcessVsSpy: avg(excess),
    bigWinners: rs.filter((r) => r.ret >= 0.5).length / rs.length,
    p10: pct(rets, 0.1), p90: pct(rets, 0.9),
  };
}

/**
 * Floor turn: the first sign of a turn while still in the lower half of a long base, long before
 * the base high (often 20-70% away) is broken. At bar i, with a qualifying base ending at i-1:
 * prior close in the lower half of the base, close above a flat-or-rising 50-day average, close
 * above the prior 20-bar high on >=1.5x volume, and the last 20 bars holding above the base low.
 * Stop = lowest low of the last 20 bars minus 1%. Research rule, not yet a scanner rule.
 */
export const FLOOR_TURN = { maxPosInBase: 0.5, swing: 20, volMult: 1.5, maSlopeBars: 10, maxRisk: 0.2 };
export function findFloorTurnEvents(bars, rules = SETUP_RULES, ft = FLOOR_TURN) {
  const n = bars.length;
  const closes = bars.map((b) => b.close);
  const ma50 = sma(closes, 50), vol50 = sma(bars.map((b) => b.volume), 50);
  const events = [];
  let cooldownUntil = -1;
  for (let i = 300; i < n; i++) {
    if (i < cooldownUntil) continue;
    const b = bars[i];
    if (!(ma50[i] > 0) || !(ma50[i - ft.maSlopeBars] > 0) || b.close <= ma50[i] || ma50[i] < ma50[i - ft.maSlopeBars]) continue;
    if (!(vol50[i - 1] > 0) || b.volume / vol50[i - 1] < ft.volMult) continue;
    const prior = bars.slice(i - ft.swing, i);
    if (b.close <= Math.max(...prior.map((x) => x.high))) continue;
    const base = findBase(bars, i - 1, rules);
    if (!base || !(base.high > base.low)) continue;
    const pos = (bars[i - 1].close - base.low) / (base.high - base.low);
    if (pos > ft.maxPosInBase) continue;
    const swingLow = Math.min(...bars.slice(i - ft.swing + 1, i + 1).map((x) => x.low));
    if (swingLow <= base.low) continue;
    events.push({ index: i, base, posInBase: pos, stop: swingLow * 0.99, volMult: b.volume / vol50[i - 1] });
    cooldownUntil = i + 40;
  }
  return events;
}

export function simulateFloorTurn(bars, ev, spyByTime, ft = FLOOR_TURN) {
  const entryIdx = ev.index + 1;
  if (entryIdx >= bars.length) return null;
  const entry = bars[entryIdx].open, stop = ev.stop;
  if (!(entry > stop) || (entry - stop) / entry > ft.maxRisk) return null;
  const tt = trendTemplate(bars.slice(0, ev.index + 1));
  const out = { time: bars[ev.index].time, entry, stop, riskPct: (entry - stop) / entry, baseMonths: Math.round(ev.base.window / 21), depth: ev.base.depth, posInBase: ev.posInBase, toPivot: ev.base.high / entry - 1, volMult: ev.volMult, trendOk: tt.passed >= 6, results: {} };
  const spyEntry = spyByTime.get(bars[entryIdx].time)?.open;
  for (const h of HORIZONS) {
    const last = entryIdx + h - 1;
    if (last >= bars.length) { out.results[h] = null; continue; }
    let exit = bars[last].close, stopped = false;
    for (let j = entryIdx; j <= last; j++) { const x = bars[j]; if (x.low <= stop) { exit = Math.min(x.open, stop); stopped = true; break; } }
    const ret = exit / entry - 1, spyExit = spyByTime.get(bars[last].time)?.close;
    out.results[h] = { ret, r: ret / ((entry - stop) / entry), stopped, spy: spyEntry && spyExit ? spyExit / spyEntry - 1 : null };
  }
  return out;
}

/**
 * barsBySymbol: { SYMBOL: Bar[] } (adjusted daily), spy: Bar[].
 * Returns the report object (also usable in tests).
 */
/**
 * First volume breakout above the 6-month high of each advance (40-bar cooldown) where no base
 * qualified, with the window stats and the reason per window — for tuning on case studies.
 */
export function nearMisses(bars, rules = SETUP_RULES, limit = 12) {
  const highs = bars.map((b) => b.high);
  const max126 = rollingMax(highs, 126);
  const vol50 = sma(bars.map((b) => b.volume), 50);
  const out = [];
  let cooldown = -1;
  for (let i = 300; i < bars.length; i++) {
    if (i < cooldown) continue;
    if (max126[i - 1] === null || bars[i].close <= max126[i - 1] || !(vol50[i - 1] > 0) || bars[i].volume / vol50[i - 1] < rules.breakoutVolMult) continue;
    cooldown = i + 40;
    if (findBase(bars, i - 1, rules)) continue;
    const why = explainBase(bars, i - 1, rules).map((e) => {
      const W = e.window;
      const seg = bars.slice(Math.max(0, i - W), i);
      const hi = Math.max(...seg.map((b) => b.high));
      const lo = Math.min(...seg.map((b) => b.low));
      return `${Math.round(W / 21)}개월[${lo.toFixed(2)}~${hi.toFixed(2)}]: ${e.reason}`;
    });
    out.push({ date: new Date(bars[i].time * 1000).toISOString().slice(0, 10), close: bars[i].close, volMult: Math.round((bars[i].volume / vol50[i - 1]) * 10) / 10, why });
  }
  return out.slice(-limit);
}

export function runBreakoutBacktest(barsBySymbol, spy, { caseStudies = ['PLTR', 'RGTI', 'QUBT', 'IONQ'], factsBySymbol = null } = {}) {
  const spyByTime = new Map(spy.map((b) => [b.time, b]));
  const trades = [];
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!bars || bars.length < 400) continue;
    for (const ev of findBreakoutEvents(bars)) {
      const t = simulate(bars, ev, spyByTime);
      if (t) trades.push({ symbol, ...t, rsNewHigh: relativeStrength(bars.slice(0, ev.index + 1), spy).rsNewHigh,
        // what the filings said on the breakout day (only quarters already filed by then)
        story: factsBySymbol?.[symbol] ? storyAsOf(factsBySymbol[symbol], new Date(t.time * 1000).toISOString().slice(0, 10)) : null });
    }
  }
  const turns = [];
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!bars || bars.length < 400) continue;
    for (const ev of findFloorTurnEvents(bars)) {
      const t = simulateFloorTurn(bars, ev, spyByTime);
      if (t) turns.push({ symbol, ...t, story: factsBySymbol?.[symbol] ? storyAsOf(factsBySymbol[symbol], new Date(t.time * 1000).toISOString().slice(0, 10)) : null });
    }
  }
  // business-change event study (no chart rule), only where filings are cached
  const events = [];
  if (factsBySymbol) for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (bars?.length >= 400 && factsBySymbol[symbol]) for (const ev of storyEvents(bars, factsBySymbol[symbol], spyByTime)) events.push({ symbol, ...ev });
  }
  const groups = {
    all: trades,
    trendTemplateOk: trades.filter((t) => t.trendOk),
    longBase9mPlus: trades.filter((t) => t.baseMonths >= 9),
    highQualityBase: trades.filter((t) => t.quality >= 2),
    rsNewHigh: trades.filter((t) => t.rsNewHigh),
    tightRisk8pct: trades.filter((t) => t.riskPct <= 0.08),
    ...(factsBySymbol ? {
      storyKnown: trades.filter((t) => t.story?.known),
      storyImproving: trades.filter((t) => t.story?.known && t.story.improving),
      storyNotImproving: trades.filter((t) => t.story?.known && !t.story.improving),
      storyImprovingTrendOk: trades.filter((t) => t.story?.known && t.story.improving && t.trendOk),
    } : {}),
    floorTurn: turns,
    ...(factsBySymbol ? {
      floorTurnStoryKnown: turns.filter((t) => t.story?.known),
      floorTurnStoryImproving: turns.filter((t) => t.story?.known && t.story.improving),
      floorTurnStoryNotImproving: turns.filter((t) => t.story?.known && !t.story.improving),
    } : {}),
    ...(events.length ? storyEventGroups(events) : {}),
  };
  const report = {};
  for (const [g, ts] of Object.entries(groups)) report[g] = Object.fromEntries(HORIZONS.map((h) => [`${h}d`, summarize(ts, h)]));
  const fmtDate = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  return {
    generatedAt: new Date().toISOString(),
    rules: SETUP_RULES,
    method: '각 거래일까지의 데이터만으로 BREAKOUT 판정 → 다음 거래일 시가 매수, 계획 손절가 이탈 시 손절(갭은 시가 체결), 아니면 h거래일 후 종가 청산. SPY 대비.',
    limits: [factsBySymbol ? '실적 조건은 매수일까지 공시된 분기만 사용 — 재무 자료가 약 3년치라 2024년 하반기 이후 돌파만 비교 가능' : '스토리 점수는 과거 시점 데이터가 없어 미검증 (차트 규칙만 검증)', '현재 상장 종목만 사용 → 상장폐지 종목 누락으로 결과가 좋게 나올 수 있음 (생존 편향)', '수수료·슬리피지 미반영 (손절 갭만 반영)'],
    trades: trades.length,
    floorTurns: turns.length,
    storyEvents: events.length,
    storyEventMethod: '분기 매출 공시 다음 거래일 시가 매수 → h거래일 후 종가, 손절 없음, SPY 대비. 공시일까지 알려진 분기만으로 실적 개선 판정. 52주 범위 하단 1/3 = 바닥권, 상단 20% = 고점권. 주가 $2 이상·20일 평균 거래대금 $100만 이상.',
    floorTurnRules: FLOOR_TURN,
    floorTurnCases: Object.fromEntries(caseStudies.map((s) => [s, turns.filter((t) => t.symbol === s).map((t) => ({ date: fmtDate(t.time), entry: t.entry, stop: t.stop, toPivot: t.toPivot, results: t.results }))])),
    symbols: Object.keys(barsBySymbol).length,
    report,
    caseStudies: Object.fromEntries(caseStudies.map((s) => [s, trades.filter((t) => t.symbol === s).map((t) => ({ date: fmtDate(t.time), entry: t.entry, stop: t.stop, baseMonths: t.baseMonths, results: t.results }))])),
    caseNearMisses: Object.fromEntries(caseStudies.filter((s) => barsBySymbol[s]?.length).map((s) => [s, nearMisses(barsBySymbol[s])])),
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
