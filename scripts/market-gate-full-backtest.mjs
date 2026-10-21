#!/usr/bin/env node
// The whole site verdict (buildMarketBrief: prices, breadth, VIX, credit) replayed day by day on history,
// next to the price-only rules on the same days. Rules are the current MARKET_RULES; nothing is tuned here.
// Also compares credit signals as stand-alone caution flags (C): HYG−LQD (current), HYG−IEF, and the ICE BofA
// US high-yield OAS (FRED BAMLH0A0HYM2). Thresholds for the alternatives are fixed below before any run.
// Usage: node scripts/market-gate-full-backtest.mjs --breadth <breadth-history.json> --out <dir> [--start 2015-01-01] [--split 2022-01-01]
// Needs ALPACA_KEY_ID / ALPACA_SECRET_KEY, and network access to cdn.cboe.com / fred.stlouisfed.org.
import fs from 'node:fs';
import path from 'node:path';
import { MARKET_ETFS, buildMarketBrief } from '../packages/analysis/market-brief.mjs';
import { fetchDailyBars } from '../packages/pipeline/alpaca.mjs';
import { FWD, priceGateState, summarizeStates } from './market-gate-backtest.mjs';

const CREDIT_RULES = { hygLqd: -0.02, hygIef: -0.02, oasRise21: 0.5 };

/** Cboe VIX_History.csv (DATE,OPEN,HIGH,LOW,CLOSE with MM/DD/YYYY) or FRED (DATE/observation_date,VALUE) -> Map date -> close. */
export function parseDailyCsv(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/).slice(1)) {
    const cells = line.split(',');
    if (cells.length < 2) continue;
    let d = cells[0].trim();
    const us = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (us) d = `${us[3]}-${us[1]}-${us[2]}`;
    const v = Number(cells.at(-1));
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v) && cells.at(-1).trim() !== '.') out.set(d, v);
  }
  return out;
}

async function getCsv(urls) {
  for (const url of urls) {
    try { const r = await fetch(url, { headers: { 'user-agent': 'alpha-terminal research' } }); if (r.ok) return { url, text: await r.text() }; } catch { /* next */ }
  }
  return null;
}

/** One verdict per day: rows for the full gate, the price-only gate, and the credit flags, keyed on IWM days. */
export function replay({ bars, breadthBy, vixBy, oasBy }) {
  const IWM = bars.IWM, idx = new Map(IWM.map((b, i) => [new Date(b.time * 1000).toISOString().slice(0, 10), i]));
  const ret21 = (sym, asOf) => { const a = bars[sym]; const j = a ? a.findIndex((b) => new Date(b.time * 1000).toISOString().slice(0, 10) === asOf) : -1; return j >= 21 ? a[j].close / a[j - 21].close - 1 : null; };
  const oasDates = [...oasBy.keys()].sort();
  const full = [], price = [], credit = [];
  for (const [asOf, i] of idx) {
    if (i < 200 || i >= IWM.length - 1) continue;
    const b = breadthBy.get(asOf) ?? null, v = vixBy.has(asOf) ? { asOf, close: vixBy.get(asOf) } : null;
    const brief = buildMarketBrief({ barsBy: bars, breadth: b, vix: v, asOf, now: Date.parse(`${asOf}T23:30:00Z`) });
    const base = { asOf, next: IWM[i + 1].close / IWM[i].close - 1, fwd: Object.fromEntries(FWD.map((k) => [k, i + k < IWM.length ? IWM[i + k].close / IWM[i].close - 1 : null])) };
    full.push({ ...base, state: brief.decision.state, reasons: brief.decision.reasons });
    const ps = priceGateState(brief.metrics);
    if (ps) price.push({ ...base, state: ps });
    const hl = ret21('HYG', asOf), ll = ret21('LQD', asOf), il = ret21('IEF', asOf);
    const k = oasDates.findLastIndex((d) => d <= asOf), oasRise = k >= 21 ? oasBy.get(oasDates[k]) - oasBy.get(oasDates[k - 21]) : null;
    credit.push({ ...base, hygLqd: hl !== null && ll !== null ? hl - ll : null, hygIef: hl !== null && il !== null ? hl - il : null, oasRise });
  }
  return { full, price, credit };
}

/** A credit flag judged alone: IWM after flagged vs other days, and holding 0% on flagged days vs the same average exposure. */
export function flagStats(rows, flagged) {
  const r = rows.filter((x) => flagged(x) !== null);
  const asState = r.map((x) => ({ ...x, state: flagged(x) ? 'WAIT' : 'SELECTIVE' }));
  const s = summarizeStates(asState, ['WAIT', 'SELECTIVE']);
  return { days: s.days, flaggedShare: s.byState.WAIT.share, flagged21: s.byState.WAIT.fwd[21], other21: s.byState.SELECTIVE.fwd[21], gated: s.gatedIwm, constant: s.constantIwm, hold: s.holdIwm };
}

const brief = (s) => ({
  from: s.from, to: s.to, days: s.days,
  share: Object.fromEntries(Object.entries(s.byState).map(([k, v]) => [k, v.share])),
  iwm21: Object.fromEntries(Object.entries(s.byState).map(([k, v]) => [k, { n: v.fwd[21].n, avg: v.fwd[21].avg, hit: v.fwd[21].hitRate, worst: v.fwd[21].worst }])),
  hold: s.holdIwm, gated: { total: s.gatedIwm.total, maxDrawdown: s.gatedIwm.maxDrawdown }, constant: s.constantIwm,
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const outDir = arg('out', 'research-out'), start = arg('start', '2015-01-01'), split = arg('split', '2022-01-01');
  const breadth = JSON.parse(fs.readFileSync(arg('breadth', path.join(outDir, 'breadth-history.json')), 'utf8'));
  const symbols = [...new Set([...MARKET_ETFS, 'IEF'])];
  const { bars } = await fetchDailyBars({ symbols, start, end: new Date(Date.now() - 20 * 60000).toISOString(), keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY });
  const vixCsv = await getCsv(['https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS']);
  const oasCsv = await getCsv(['https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2']);
  const vixBy = vixCsv ? parseDailyCsv(vixCsv.text) : new Map(), oasBy = oasCsv ? parseDailyCsv(oasCsv.text) : new Map();
  const trainTo = new Date(Date.parse(split) - 86400000).toISOString().slice(0, 10);
  const periods = { full: [null, null], train: [null, trainTo], test: [split, null] };
  const cut = (rows, [from, to]) => rows.filter((x) => (!from || x.asOf >= from) && (!to || x.asOf <= to));
  const report = { model: 'market-gate-full-v1', split, sources: { vix: vixCsv?.url ?? '확보 실패', vixDays: vixBy.size, oas: oasCsv?.url ?? '확보 실패', oasDays: oasBy.size }, breadthCounts: breadth.counts, verdict: {}, credit: {} };
  for (const universe of ['listed', 'all']) {
    const breadthBy = new Map(breadth[universe].map((r) => [r.asOf, r]));
    const { full, price, credit } = replay({ bars, breadthBy, vixBy, oasBy });
    const reasonCount = {};
    for (const r of full) if (r.state !== 'SELECTIVE') for (const x of r.reasons) { const key = x.replace(/[-+]?\d+(\.\d+)?%?/g, '#'); reasonCount[key] = (reasonCount[key] ?? 0) + 1; }
    report.verdict[universe] = {
      ...Object.fromEntries(Object.entries(periods).map(([p, range]) => [p, { fullGate: brief(summarizeStates(cut(full, range))), priceOnly: brief(summarizeStates(cut(price, range))) }])),
      topReasons: Object.entries(reasonCount).sort((a, b) => b[1] - a[1]).slice(0, 12),
    };
    if (universe === 'listed') report.credit = Object.fromEntries(Object.entries(periods).map(([p, range]) => {
      const r = cut(credit, range);
      return [p, {
        hygLqd: flagStats(r, (x) => (x.hygLqd === null ? null : x.hygLqd <= CREDIT_RULES.hygLqd)),
        hygIef: flagStats(r, (x) => (x.hygIef === null ? null : x.hygIef <= CREDIT_RULES.hygIef)),
        oasRise: flagStats(r, (x) => (x.oasRise === null ? null : x.oasRise >= CREDIT_RULES.oasRise21)),
      }];
    }));
  }
  report.creditRules = CREDIT_RULES;
  report.caveat = '현재 규칙 그대로(튜닝 없음). 참여도는 breadth-history 재구성치(현재 상장 기준 listed, 상장폐지 일부 포함 all). VIX는 Cboe/FRED 종가, 사이트처럼 당일 값이 없으면 "미확인" 주의로 처리. 다음 날 IWM 수익률, 비용·세금 미반영. 신용 대안의 임계값은 실행 전에 정한 값이며 조정하지 않았습니다.';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'market-gate-full.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}
