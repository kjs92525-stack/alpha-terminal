#!/usr/bin/env node
// Does the price part of the market gate actually avoid small-cap drawdowns?
// Usage: node scripts/market-gate-backtest.mjs --cache .backtest-cache --out data-branch [--start 2016-01-01]
// Reads cached SPY/QQQ/IWM bars (scripts/backtest.mjs fills the cache), or fetches them with ALPACA_KEY_ID/ALPACA_SECRET_KEY.
// Breadth, VIX and credit have no point-in-time history here, so only the price rules (QQQ/SPY shock, 50/200-day
// trend, 3-session confirmation) are tested. Output compares IWM forward returns by gate state.
import fs from 'node:fs';
import path from 'node:path';
import { MARKET_RULES, marketMetrics } from '../packages/analysis/market-brief.mjs';
import { fetchDailyBars } from '../packages/pipeline/alpaca.mjs';
import { loadBarsDir } from '../packages/pipeline/backtest.mjs';

export const FWD = [5, 21, 63];

export function priceGateState(m, R = MARKET_RULES) {
  const { SPY: spy, QQQ: qqq, IWM: iwm } = m;
  if (!spy || !qqq || !iwm || spy.ma200 === null || qqq.ma200 === null || iwm.ma200 === null) return null;
  const stress = [], caution = [];
  if (qqq.ret1 <= R.growthShockDay || qqq.ret5 <= R.growthShockWeek || spy.ret1 <= R.shockDay || spy.ret5 <= R.shockWeek) stress.push('shock');
  if (spy.above200 === false && qqq.above200 === false) stress.push('below200');
  if (qqq.ret5 <= R.growthCautionWeek || qqq.above50 === false || spy.above50 === false || iwm.above50 === false) caution.push('trend');
  // confirmSessions 1 = above both averages today; otherwise the 3-session confirmation of marketMetrics
  const confirmed = (x) => (R.confirmSessions === 1 ? x.above50 && x.above200 : x.confirmation);
  if (!['SPY', 'QQQ', 'IWM'].every((s) => confirmed(m[s]))) caution.push('confirmation');
  return stress.length ? 'WAIT' : caution.length ? 'LIMIT' : 'SELECTIVE';
}

/** Small-cap-only variant, declared before any run: IWM shock (-2.5% day / -5% week) or IWM under its 200-day
 *  average is stress; IWM under its 50-day average or without the 3-session confirmation is caution. */
export function iwmGateState(m) {
  const iwm = m.IWM;
  if (!iwm || iwm.ma200 === null) return null;
  if (iwm.ret1 <= -0.025 || iwm.ret5 <= -0.05 || iwm.above200 === false) return 'WAIT';
  if (iwm.above50 === false || !iwm.confirmation) return 'LIMIT';
  return 'SELECTIVE';
}

const maxDrawdown = (rets) => { let eq = 1, peak = 1, dd = 0; for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); } return dd; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

const EXPOSURE = { SELECTIVE: 1, LIMIT: 0.5 };
/** rows: [{ asOf, state, next, fwd: {5,21,63} }] -> state shares, IWM forward returns, and three ways to hold IWM. */
export function summarizeStates(rows, states = ['WAIT', 'LIMIT', 'SELECTIVE', 'UNKNOWN']) {
  const by = {};
  for (const state of states) {
    const r = rows.filter((x) => x.state === state);
    if (!r.length && state === 'UNKNOWN') continue;
    by[state] = { days: r.length, share: rows.length ? r.length / rows.length : null, avgNextDay: mean(r.map((x) => x.next)), fwd: Object.fromEntries(FWD.map((k) => { const v = r.map((x) => x.fwd[k]).filter((x) => x !== null); return [k, { n: v.length, avg: mean(v), hitRate: v.length ? v.filter((x) => x > 0).length / v.length : null, worst: v.length ? Math.min(...v) : null }]; })) };
  }
  const allNext = rows.map((x) => x.next);
  const gated = rows.map((x) => x.next * (EXPOSURE[x.state] ?? 0));
  const total = (a) => a.reduce((e, r) => e * (1 + r), 1) - 1;
  // same average exposure as the gate, held every day — tells timing apart from simply holding less
  const exposure = rows.length ? mean(rows.map((x) => EXPOSURE[x.state] ?? 0)) : 0;
  const constant = allNext.map((r) => r * exposure);
  return {
    from: rows[0]?.asOf ?? null, to: rows.at(-1)?.asOf ?? null, days: rows.length, byState: by,
    holdIwm: { total: total(allNext), maxDrawdown: maxDrawdown(allNext) },
    gatedIwm: { rule: 'SELECTIVE=100% LIMIT=50% WAIT/UNKNOWN=0% of IWM, next-day return', total: total(gated), maxDrawdown: maxDrawdown(gated) },
    constantIwm: { rule: 'IWM at the gate\'s average exposure every day', exposure, total: total(constant), maxDrawdown: maxDrawdown(constant) },
  };
}

/** Per-day SPY/QQQ/IWM metrics, computed once so several rule sets can be scored on the same days. */
export function gateDays(bars, { warmup = 200, now = Date.now() } = {}) {
  const { SPY, QQQ, IWM } = bars;
  const out = [];
  for (let i = warmup; i < IWM.length - 1; i++) {
    const asOf = new Date(IWM[i].time * 1000).toISOString().slice(0, 10);
    const m = { SPY: marketMetrics(SPY, asOf, now), QQQ: marketMetrics(QQQ, asOf, now), IWM: marketMetrics(IWM, asOf, now) };
    if (['SPY', 'QQQ', 'IWM'].some((s) => m[s]?.asOf !== asOf)) continue;
    out.push({ i, asOf, m });
  }
  return out;
}

export function runGateBacktest(bars, { warmup = 200, now = Date.now(), rules = MARKET_RULES, from = null, to = null, days = null, stateOf = null } = {}) {
  const { IWM } = bars;
  const rows = [];
  for (const { i, asOf, m } of days ?? gateDays(bars, { warmup, now })) {
    if ((from && asOf < from) || (to && asOf > to)) continue;
    const state = stateOf ? stateOf(m) : priceGateState(m, rules);
    if (!state) continue;
    // the state is known at the close of day i; the next-day return is the first one it can influence
    rows.push({ i, asOf, state, next: IWM[i + 1].close / IWM[i].close - 1, fwd: Object.fromEntries(FWD.map((k) => [k, i + k < IWM.length ? IWM[i + k].close / IWM[i].close - 1 : null])) });
  }
  return { model: 'market-gate-price-only-v1', ...summarizeStates(rows),
    caveat: '가격 규칙만 검증했습니다(참여도·VIX·신용은 시점별 과거 자료가 없음). 임계값은 같은 기간에 맞춰 조정하지 않았습니다. 한 시장 국면의 결과일 수 있고 거래비용·세금은 반영하지 않았습니다.',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const cacheDir = path.join(arg('cache', '.backtest-cache'), 'bars');
  const outDir = arg('out', 'data-branch');
  const start = arg('start', '2016-01-01');
  let all = fs.existsSync(cacheDir) ? loadBarsDir(cacheDir) : {};
  if (!['SPY', 'QQQ', 'IWM'].every((s) => all[s]?.length > 300)) {
    const r = await fetchDailyBars({ symbols: ['SPY', 'QQQ', 'IWM'], start, end: new Date(Date.now() - 20 * 60000).toISOString(), keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY });
    all = r.bars;
  }
  const report = runGateBacktest({ SPY: all.SPY, QQQ: all.QQQ, IWM: all.IWM });
  fs.mkdirSync(path.join(outDir, 'backtest'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'backtest', 'market-gate.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ from: report.from, to: report.to, days: report.days, byState: Object.fromEntries(Object.entries(report.byState).map(([k, v]) => [k, { days: v.days, avg21: v.fwd[21].avg, worst21: v.fwd[21].worst }])), holdIwm: report.holdIwm, gatedIwm: report.gatedIwm, constantIwm: report.constantIwm }, null, 1));
}
