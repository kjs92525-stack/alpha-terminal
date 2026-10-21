#!/usr/bin/env node
// Research run (not part of the nightly site): price-rule market gate on real bars, split into a tuning
// period and a later validation period. One rule set is picked from a small grid declared below using
// the tuning period only, then scored on the validation period next to the current rules.
// Usage: node scripts/market-gate-research.mjs --cache .backtest-cache --out <dir> [--start 2016-01-01] [--split 2022-01-01]
// Needs ALPACA_KEY_ID / ALPACA_SECRET_KEY unless the cache already holds SPY/QQQ/IWM. Prints summaries only.
import fs from 'node:fs';
import path from 'node:path';
import { MARKET_RULES } from '../packages/analysis/market-brief.mjs';
import { fetchDailyBars } from '../packages/pipeline/alpaca.mjs';
import { loadBarsDir } from '../packages/pipeline/backtest.mjs';
import { gateDays, runGateBacktest, iwmGateState } from './market-gate-backtest.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };

// Declared before looking at any result: shock and caution levels, and the confirmation length.
export const GRID = [];
for (const shockDay of [-0.02, -0.025, -0.03])
  for (const shockWeek of [-0.04, -0.05, -0.06])
    for (const cautionWeek of [-0.02, -0.03, -0.04])
      for (const confirmSessions of [1, 3])
        GRID.push({ ...MARKET_RULES, growthShockDay: shockDay, shockDay, growthShockWeek: shockWeek, shockWeek, growthCautionWeek: cautionWeek, confirmSessions });

const years = (from, to) => (Date.parse(to) - Date.parse(from)) / (365.25 * 86400000);
/** Objective, fixed in advance: annualised gated return divided by the gated max drawdown (higher is better). */
export function score(r) {
  if (!r.days || !r.from) return -Infinity;
  const y = Math.max(years(r.from, r.to), 0.25), cagr = (1 + r.gatedIwm.total) ** (1 / y) - 1;
  return cagr / Math.max(Math.abs(r.gatedIwm.maxDrawdown), 0.01);
}
const brief = (r) => ({
  from: r.from, to: r.to, days: r.days, score: Number(score(r).toFixed(3)),
  share: Object.fromEntries(Object.entries(r.byState).map(([k, v]) => [k, v.share])),
  iwm21: Object.fromEntries(Object.entries(r.byState).map(([k, v]) => [k, { n: v.fwd[21].n, avg: v.fwd[21].avg, hit: v.fwd[21].hitRate, worst: v.fwd[21].worst }])),
  hold: r.holdIwm, gated: { total: r.gatedIwm.total, maxDrawdown: r.gatedIwm.maxDrawdown }, constant: r.constantIwm,
});
const rulesKey = (R) => ({ shockDay: R.shockDay, shockWeek: R.shockWeek, cautionWeek: R.growthCautionWeek, confirmSessions: R.confirmSessions });

if (import.meta.url === `file://${process.argv[1]}`) {
  const cacheDir = path.join(arg('cache', '.backtest-cache'), 'bars');
  const outDir = arg('out', 'research-out');
  const start = arg('start', '2016-01-01'), split = arg('split', '2022-01-01');
  let all = fs.existsSync(cacheDir) ? loadBarsDir(cacheDir) : {};
  if (!['SPY', 'QQQ', 'IWM'].every((s) => all[s]?.length > 300)) {
    const r = await fetchDailyBars({ symbols: ['SPY', 'QQQ', 'IWM'], start, end: new Date(Date.now() - 20 * 60000).toISOString(), keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY });
    all = r.bars;
  }
  const bars = { SPY: all.SPY, QQQ: all.QQQ, IWM: all.IWM };
  const days = gateDays(bars);
  const trainTo = new Date(Date.parse(split) - 86400000).toISOString().slice(0, 10);
  const run = (rules, from, to) => runGateBacktest(bars, { rules, from, to, days });
  const base = { full: run(MARKET_RULES, null, null), train: run(MARKET_RULES, null, trainTo), test: run(MARKET_RULES, split, null) };
  const ranked = GRID.map((R) => ({ R, train: run(R, null, trainTo) })).sort((a, b) => score(b.train) - score(a.train));
  const best = ranked[0];
  const report = {
    model: 'market-gate-research-v1', split, objective: 'gated CAGR / |gated max drawdown|, picked on the tuning period only', grid: GRID.length,
    current: { rules: rulesKey(MARKET_RULES), full: brief(base.full), train: brief(base.train), test: brief(base.test) },
    picked: { rules: rulesKey(best.R), train: brief(best.train), test: brief(run(best.R, split, null)) },
    iwmOnly: { rule: 'IWM -2.5%/day, -5%/week or under 200d = WAIT; under 50d or unconfirmed = LIMIT (declared before running)', ...Object.fromEntries([['full', null, null], ['train', null, trainTo], ['test', split, null]].map(([k, from, to]) => [k, brief(runGateBacktest(bars, { from, to, days, stateOf: iwmGateState }))])) },
    top5OnTrain: ranked.slice(0, 5).map((x) => ({ rules: rulesKey(x.R), trainScore: Number(score(x.train).toFixed(3)), testScore: Number(score(run(x.R, split, null)).toFixed(3)) })),
    caveat: '가격 규칙만(참여도·VIX·신용 제외). 다음 날 IWM 수익률 기준, 비용·세금 미반영. 21일 이후 수익률은 구간 경계에서 다음 구간 가격을 일부 포함.',
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'market-gate-research.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}
