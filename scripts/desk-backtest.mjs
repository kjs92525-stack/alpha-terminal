// Multi-year backtest of the analyst desk rules: the same analyze → pick → size → manage code that runs every
// night, applied session by session to a universe of liquid US stocks. Daily ranking lists did not exist
// before 2026-10, so every candidate gets the same neutral list score and the market state comes from SPY.
//
//   node scripts/desk-backtest.mjs --universe latest.json --out desk/backtest.json [--years 3]
//     (fetches bars from Alpaca; needs ALPACA_KEY_ID / ALPACA_SECRET_KEY, optional FINNHUB_API_KEY)
//   node scripts/desk-backtest.mjs --bars universe-bars.json --out desk/backtest.json   (offline, sim/bars format)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickForDay, replayDesk, deskStats, regimeFromSpy, seriesFor, capBucket, DESK_RULES } from '../packages/analysis/analyst-desk.mjs';
import { barsAccess } from './analyst-desk.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const NEUTRAL_SCORE = 60;

/** Pick the universe: the most liquid ranked stocks (by 20-day dollar volume) plus any extra symbols. */
export function chooseUniverse(latest, size = 600, extra = []) {
  const rows = new Map();
  for (const k of ['mid', 'short']) for (const r of latest[k] ?? []) if (r.adv20 && r.price >= 5 && !rows.has(r.symbol)) rows.set(r.symbol, r);
  const top = [...rows.values()].sort((a, b) => b.adv20 - a.adv20).slice(0, size);
  const meta = new Map(top.map((r) => [r.symbol, { name: r.name, sector: r.sector, mcap: r.mcap }]));
  for (const s of extra) if (!meta.has(s)) meta.set(s, { name: s, sector: null, mcap: rows.get(s)?.mcap ?? null });
  return meta;
}

/** win rate, expectancy and total R per setup */
export function bySetup(trades) {
  const g = {};
  for (const t of trades) { const a = (g[t.setup] ??= { n: 0, wins: 0, sumR: 0 }); a.n++; if (t.R > 0) a.wins++; a.sumR += t.R; }
  for (const a of Object.values(g)) { a.winRate = a.wins / a.n; a.expectancyR = a.sumR / a.n; a.sumR = Math.round(a.sumR * 10) / 10; }
  return g;
}

// Rule variants compared on the same bars: the current desk (v4) against ICT market-structure readings.
// Trades are also split by entry date: the last 12 months are the out-of-sample check for anything tuned earlier.
const BASE_SETUPS = ['breakout', 'base', 'pullback', 'reversal'];
const ICT = { mssEntry: 'limit', mssExit: 'liquidity', mssMinRR: 2, mssDiscount: 0.5 };
const RAW = { setups: ['structure'], mssRaw: true, mssExit: 'liquidity', mssMinRR: 1.5, mssDiscount: null, minQuality: 0, minQualityWait: 0, picksPerDay: { SELECTIVE: 5, LIMIT: 5, UNKNOWN: 5, WAIT: 5 } };
const WK = { ...RAW, mssTf: 'W', maxStopPct: 0.25 };
export const VARIANTS = {
  'v5 (현재 데스크)': {},
  '일봉 원형 시가 (현재 ICT 장부)': { ...RAW, mssEntry: 'market' },
  '일봉 원형 시가 + 거래량 1.5배': { ...RAW, mssEntry: 'market', mssVolReq: 1.5 },
  '일봉 원형 시가 + 거래량 2배': { ...RAW, mssEntry: 'market', mssVolReq: 2 },
  '주봉 원형 시가': { ...WK, mssEntry: 'market' },
  '주봉 원형 시가 + 거래량 1.5배': { ...WK, mssEntry: 'market', mssVolReq: 1.5 },
  '주봉 원형 지정가': { ...WK, mssEntry: 'limit' },
  '주봉 원형 지정가 + 거래량 1.5배': { ...WK, mssEntry: 'limit', mssVolReq: 1.5 },
};
// "bigger winners": smaller and faster stocks, and/or no half sale at +2R (trail the whole position)
const RUN = { partialFrac: 0 };
export const GROWTH_VARIANTS = {
  'v5 (현재 데스크)': {},
  '+2R 절반 익절 없이 추세 끝까지': { ...RUN },
  '익절 없이 + 50일선 추적': { ...RUN, trailMa: 'sma50' },
  '중소형주만 (시총 100억$ 미만)': { maxMcap: 10e9 },
  '중소형주만 + 익절 없이': { maxMcap: 10e9, ...RUN },
  '중소형·고변동(일 변동 3%+) + 익절 없이': { maxMcap: 10e9, minAtrPick: 0.03, ...RUN },
  '중소형·고변동 + 익절 없이 + 50일선': { maxMcap: 10e9, minAtrPick: 0.03, ...RUN, trailMa: 'sma50' },
};
const half = (trades) => { const n = trades.length, w = trades.filter((t) => t.R > 0).length, R = trades.reduce((a, t) => a + t.R, 0); return { n, winRate: n ? w / n : null, expectancyR: n ? R / n : null }; };
export function compareVariants(payload, meta, { years = 3, set = 'ict' } = {}) {
  return Object.entries(set === 'growth' ? GROWTH_VARIANTS : VARIANTS).map(([name, v]) => {
    const r = runBacktest(payload, meta, { years, rules: { ...DESK_RULES, ...v } }), s = r.stats;
    const split = new Date(Date.parse(r.to) - 365 * 864e5).toISOString().slice(0, 10);
    return { name, trades: s.closed, winRate: s.winRate, expectancyR: s.expectancyR, profitFactor: s.profitFactor, totalReturn: s.totalReturn, cagr: r.cagr, spyCagr: r.spyCagr, maxDrawdown: s.maxDrawdown, exposure: r.exposure, bySetup: r.bySetup,
      avgWinPct: (() => { const w = r.trades.filter((t) => t.pnlPct > 0); return w.length ? w.reduce((a, t) => a + t.pnlPct, 0) / w.length : null; })(),
      bigWins: r.trades.filter((t) => t.pnlPct >= 0.3).length,
      split, inSample: half(r.trades.filter((t) => t.entryDate < split)), outOfSample: half(r.trades.filter((t) => t.entryDate >= split)) };
  });
}

export function runBacktest(payload, meta, { years = 3, rules = DESK_RULES } = {}) {
  const data = barsAccess(payload), cal = data.cal, spy = data.get('SPY');
  if (!spy) throw new Error('SPY bars missing');
  const startIdx = Math.max(260, cal.length - Math.round(years * 252)); // first ~260 sessions only warm up indicators
  const symbols = [...meta.keys()].filter((s) => data.get(s));
  const earningsIn = (sym, d) => {
    if (!data.earnings) return undefined;
    const list = data.earnings(sym); if (!list) return undefined;
    const e = list.find((x) => x.date > cal[d]); if (!e) return null;
    let n = 0; for (let t = Date.parse(cal[d]) + 864e5; t <= Date.parse(e.date); t += 864e5) { const w = new Date(t).getUTCDay(); if (w && w < 6) n++; }
    return n <= 30 ? n : null;
  };
  const picker = (d, { busy, cooldown }) => {
    const si = d - spy.s, market = regimeFromSpy(spy.bars, si), spyRet126 = si >= 126 ? spy.bars[si].c / spy.bars[si - 126].c - 1 : null;
    const candidates = [];
    for (const sym of symbols) {
      const x = data.get(sym), i = d - x.s; if (i < 260 || i >= x.bars.length) continue;
      const sr = seriesFor(x.bars), c = sr.cl[i];
      if (!(c > sr.sma200[i] || sr.sma50[i] > sr.sma200[i])) continue; // cheap pre-filter: analyze() rejects these anyway
      const m = meta.get(sym);
      candidates.push({ symbol: sym, name: m.name, sector: m.sector, mcap: m.mcap, score: NEUTRAL_SCORE, source: '유동성 상위 유니버스', bars: x.bars, i, earningsIn: earningsIn(sym, d) });
    }
    const res = pickForDay({ date: cal[d], candidates, market, spyRet126, busy, cooldown, volumeReliable: data.volumeReliable, earningsChecked: data.earningsChecked }, rules);
    return { date: cal[d], market, picks: res.picks };
  };
  const r = replayDesk([], data, rules, { picker, start: startIdx, end: cal.length - 1 });
  const stats = deskStats(r.trades, r.equity);
  // calendar-year and monthly returns, desk vs SPY
  const periods = (keyLen) => {
    const out = new Map();
    for (const e of r.equity) { const k = e.date.slice(0, keyLen); const p = out.get(k) ?? { first: e, last: e }; p.last = e; out.set(k, p); }
    let prev = { equity: rules.startEquity, spy: rules.startEquity };
    return [...out].map(([k, p]) => { const row = { period: k, desk: p.last.equity / prev.equity - 1, spy: p.last.spy / prev.spy - 1 }; prev = p.last; return row; });
  };
  const weekly = r.equity.filter((_, i) => i % 5 === 0 || i === r.equity.length - 1).map((e) => ({ date: e.date, equity: e.equity, spy: e.spy }));
  const days = r.equity.length, cagr = (x) => (1 + x) ** (252 / Math.max(1, days)) - 1;
  const exposure = r.equity.reduce((a, e) => a + (e.open > 0 ? 1 : 0), 0) / Math.max(1, days);
  return {
    model: `desk-backtest-v${rules.version}`, generatedAt: new Date().toISOString(), from: cal[startIdx], to: cal.at(-1), sessions: days,
    universe: { size: symbols.length, rule: '현재 상장 종목 중 20일 거래대금 상위 + 관심 종목' }, rules,
    bySetup: bySetup(r.trades),
    stats, cagr: cagr(stats.totalReturn), spyCagr: stats.spyReturn != null ? cagr(stats.spyReturn) : null, exposure,
    years: periods(4), months: periods(7), equity: weekly,
    trades: r.trades.map((t) => ({ symbol: t.symbol, setup: t.setup, cap: t.cap, market: t.market, entryDate: t.entryDate, exitDate: t.exitDate, days: t.days, pnlPct: Math.round(t.pnlPct * 10000) / 10000, R: Math.round(t.R * 100) / 100, alpha: t.alpha != null ? Math.round(t.alpha * 10000) / 10000 : null, reason: t.reason })),
    caveats: [
      '유니버스는 지금 상장된 종목에서 골랐습니다. 그 사이 상장폐지·급락으로 사라진 종목이 빠져 있어 결과가 실제보다 좋게 나옵니다(생존 편향).',
      `그 당시의 랭킹 점수가 없어 모든 후보에 같은 점수(${NEUTRAL_SCORE})를 줬습니다. 실제 데스크는 랭킹 상위만 보므로 후보 구성이 다릅니다.`,
      '시장 판정은 SPY의 200일·50일선만으로 대신했습니다(200일선 아래 진입 대기, 50일선 아래 축소). 실제 판정은 참여도·변동성까지 봅니다.',
      data.earningsChecked ? '실적 발표일은 Finnhub 과거 캘린더로 반영했습니다.' : '과거 실적 발표일을 받지 못해 실적 회피 규칙이 빠졌습니다. 실제보다 갭 손실이 적게 잡힙니다.',
      '과거 증자 공시는 반영하지 않았습니다. 실시간 데스크는 Finnhub 공시로 최근 90일 증자 종목을 거릅니다.',
      '체결은 일봉 기준의 보수적 가정입니다(같은 날 손절·익절이 겹치면 손절). 세금·환율은 빼고 계산합니다.',
    ],
  };
}

async function main() {
  const out = arg('out', 'desk/backtest.json'), years = Number(arg('years', '3'));
  let payload, meta;
  if (arg('bars')) {
    payload = JSON.parse(readFileSync(arg('bars'), 'utf8'));
    const latest = arg('universe') ? JSON.parse(readFileSync(arg('universe'), 'utf8')) : null;
    meta = latest ? chooseUniverse(latest, Number(arg('size', '600')), Object.keys(payload.bars)) : new Map(Object.keys(payload.bars).map((s) => [s, { name: s, sector: null, mcap: null }]));
    meta.delete('SPY'); meta.delete('QQQ');
  } else {
    const { fetchDailyBars } = await import('../packages/pipeline/alpaca.mjs');
    const { buildPayload, fetchEarnings } = await import('./sim-bars.mjs');
    const { makeFinnhubClient } = await import('../packages/pipeline/finnhub.mjs');
    const latest = JSON.parse(readFileSync(arg('universe', 'data-branch/latest.json'), 'utf8'));
    const extra = (arg('extra', '') || '').split(',').filter(Boolean);
    meta = chooseUniverse(latest, Number(arg('size', '600')), extra);
    const symbols = ['SPY', 'QQQ', ...meta.keys()];
    const start = new Date(Date.now() - (years + 1.2) * 365 * 864e5).toISOString().slice(0, 10);
    const { bars, feed } = await fetchDailyBars({ symbols, start, end: new Date(Date.now() - 20 * 60 * 1000).toISOString(), keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY, batchSize: 50 });
    payload = buildPayload([], bars); payload.volumeReliable = feed === 'sip';
    if (process.env.FINNHUB_API_KEY) {
      try { payload.earnings = await fetchEarnings(makeFinnhubClient({ apiKey: process.env.FINNHUB_API_KEY }), new Set(symbols), start, 45); payload.earningsChecked = true; }
      catch (e) { console.warn(`backtest: earnings unavailable (${e.message})`); payload.earningsChecked = false; }
    } else payload.earningsChecked = false;
    console.log(`backtest: ${Object.keys(payload.bars).length} series, ${payload.cal.length} sessions, feed=${feed}`);
  }
  const t0 = Date.now();
  if (process.argv.includes('--variants')) {
    const rows = compareVariants(payload, meta, { years, set: arg('variant-set', 'ict') });
    const p = (x) => (x == null ? '   -  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
    for (const r of rows) {
      console.log(`VARIANT ${r.name}\n    trades ${String(r.trades).padStart(4)}  win ${p(r.winRate)}  exp ${r.expectancyR?.toFixed(2)}R  PF ${r.profitFactor?.toFixed(2)}  CAGR ${p(r.cagr)} (SPY ${p(r.spyCagr)})  maxDD ${p(r.maxDrawdown)}  exposure ${p(r.exposure)}  평균 이익 ${p(r.avgWinPct)}  30%+ 수익 ${r.bigWins}건\n    학습(~${r.split}) ${r.inSample.n}건 승률 ${p(r.inSample.winRate)} ${r.inSample.expectancyR?.toFixed(2)}R | 검증(최근 1년) ${r.outOfSample.n}건 승률 ${p(r.outOfSample.winRate)} ${r.outOfSample.expectancyR?.toFixed(2)}R`);
      for (const [k, a] of Object.entries(r.bySetup)) console.log(`    ${k.padEnd(10)} ${String(a.n).padStart(4)}  win ${p(a.winRate)}  exp ${a.expectancyR.toFixed(2)}R  sum ${a.sumR}R`);
    }
    if (arg('variants-out')) { mkdirSync(dirname(arg('variants-out')), { recursive: true }); writeFileSync(arg('variants-out'), JSON.stringify({ generatedAt: new Date().toISOString(), years, variants: rows })); }
  }
  const res = runBacktest(payload, meta, { years });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(res));
  const s = res.stats;
  console.log(`backtest ${res.from}→${res.to}: ${s.closed} trades, win ${(s.winRate * 100).toFixed(0)}%, expectancy ${s.expectancyR?.toFixed(2)}R, PF ${s.profitFactor?.toFixed(2)}, return ${(s.totalReturn * 100).toFixed(1)}% (CAGR ${(res.cagr * 100).toFixed(1)}%) vs SPY ${(s.spyReturn * 100).toFixed(1)}%, maxDD ${(s.maxDrawdown * 100).toFixed(1)}%, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
