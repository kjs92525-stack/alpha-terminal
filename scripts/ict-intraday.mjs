// ICT on 4-hour bars: an event study. Every bullish market structure shift (sweep of a swing low, then a displacement
// close through the lower swing high) on regular-session 4-hour bars is traded on its own: buy the next bar's open (or a
// limit in the gap / order block), stop under the swept low, sell everything at buy-side liquidity (60-bar high) or after
// 60 bars. One trade per stock at a time; no portfolio limits, so this measures the signal itself, not an account.
//
//   node scripts/ict-intraday.mjs --universe data-branch/latest.json --years 2 --size 300 [--out research/ict4h.json]
//     (needs ALPACA_KEY_ID / ALPACA_SECRET_KEY)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { structureShift, DESK_RULES } from '../packages/analysis/analyst-desk.mjs';
import { chooseUniverse, regimeSeries } from './desk-backtest.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
import { toFourHour, hourBars } from '../packages/analysis/intraday.mjs';
export { toFourHour };

export function atrSeries(bars, n = 14) {
  const out = new Array(bars.length).fill(NaN); let s = 0;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
    s += tr; if (i > n) s -= Math.max(bars[i - n].h - bars[i - n].l, Math.abs(bars[i - n].h - bars[i - n - 1].c), Math.abs(bars[i - n].l - bars[i - n - 1].c));
    if (i >= n) out[i] = s / n;
  }
  return out;
}

/** daily-close trend for the higher-timeframe bias: close above its 50-day average */
export function dailyBias(bars4) {
  const days = []; for (const b of bars4) { if (!days.length || days.at(-1).day !== b.day) days.push({ day: b.day, c: b.c }); else days.at(-1).c = b.c; }
  const up = new Map(); let s = 0;
  for (let i = 0; i < days.length; i++) { s += days[i].c; if (i >= 50) s -= days[i - 50].c; if (i >= 49) up.set(days[i].day, days[i].c > s / 50); }
  // bias known at the previous day's close (no look-ahead into the signal day)
  const prev = new Map(); for (let i = 1; i < days.length; i++) prev.set(days[i].day, up.get(days[i - 1].day));
  return prev;
}

/**
 * The daily chart under a 4-hour signal, from the 4-hour bars themselves and known before the signal day opens:
 * day → { ema20, sma50, sma200, atr } (sma200 needs 200 days of history, else null).
 */
export function dailyContext(bars4) {
  const days = [];
  for (const b of bars4) { const x = days.at(-1); if (!x || x.day !== b.day) days.push({ day: b.day, h: b.h, l: b.l, c: b.c }); else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; } }
  const out = new Map(); let e20 = null, s50 = 0, s200 = 0, atr = null;
  for (let i = 0; i < days.length; i++) {
    const d = days[i], c = d.c;
    e20 = e20 == null ? c : c * 2 / 21 + e20 * 19 / 21;
    s50 += c; if (i >= 50) s50 -= days[i - 50].c; s200 += c; if (i >= 200) s200 -= days[i - 200].c;
    const tr = i ? Math.max(d.h - d.l, Math.abs(d.h - days[i - 1].c), Math.abs(d.l - days[i - 1].c)) : d.h - d.l;
    atr = atr == null ? tr : (atr * 13 + tr) / 14;
    if (i + 1 < days.length && i >= 19) out.set(days[i + 1].day, { ema20: e20, sma50: i >= 49 ? s50 / 50 : null, sma200: i >= 199 ? s200 / 200 : null, atr });
  }
  return out;
}
/**
 * How a signal sits on the daily chart: ext = the signal close's distance above the daily 20-day EMA in daily ATRs
 * (over ~2 = stretched, little room left), overhead = the nearest daily 50/200-day average between the entry and the
 * target (a wall the move has to break first), spread = 20-day EMA vs 50-day average (the averages fanned apart).
 */
export function contextRead(ctx, close, entry, target) {
  if (!ctx || !(ctx.atr > 0)) return null;
  const walls = [ctx.sma50, ctx.sma200].filter((m) => m != null && m > entry * 1.005 && m < target);
  return { ext: (close - ctx.ema20) / ctx.atr, overhead: walls.length ? Math.min(...walls) : null, spread: ctx.sma50 ? ctx.ema20 / ctx.sma50 - 1 : null,
    ema20: ctx.ema20, sma50: ctx.sma50, sma200: ctx.sma200 };
}

export const ICT1H_EDGE = {
  'A 1시간 지정가, 유동성 목표': { entry: 'limit' },
  'B 1시간 지정가 + 일봉 추세': { entry: 'limit', bias: true },
  'F 1시간 지정가 + 할인 구간': { entry: 'limit', discount: 0.5 },
  'G 1시간 지정가 + 거래량 1.5배': { entry: 'limit', mssVolReq: 1.5 },
  'M 1시간 할인 + 거래량 1.5배': { entry: 'limit', discount: 0.5, mssVolReq: 1.5 },
  'N 1시간 할인 + 일봉 과열 아님': { entry: 'limit', discount: 0.5, maxExt: 2 },
};
export const ICT4H_VARIANTS = {
  '4시간 원형, 다음 봉 시가': { entry: 'market' },
  '4시간 원형 + 거래량 1.5배': { entry: 'market', mssVolReq: 1.5 },
  '4시간 원형 + 일봉 상승 추세(50일선 위)': { entry: 'market', bias: true },
  '4시간 + 일봉 추세 + 거래량 1.5배': { entry: 'market', bias: true, mssVolReq: 1.5 },
  '4시간 원형, FVG·오더블록 지정가': { entry: 'limit' },
  '4시간 + 일봉 추세, 지정가': { entry: 'limit', bias: true },
  '4시간 + 일봉 추세, 목표 2R 고정': { entry: 'market', bias: true, fixedR: 2 },
};
// edge research on the one rule that passed (limit entry): exits, discount entries and volume, each split by market regime
export const ICT4H_EDGE = {
  'A 지정가, 유동성 목표 (현재)': { entry: 'limit' },
  'B 지정가 + 일봉 추세': { entry: 'limit', bias: true },
  'C 지정가, 목표 3R 고정': { entry: 'limit', fixedR: 3 },
  'D 지정가, 목표 없이 계단식 추적(+1R마다 손절 1R씩 올림)': { entry: 'limit', ratchet: true },
  'E 지정가, 유동성 목표 + 계단식 추적': { entry: 'limit', ratchetToo: true },
  'F 지정가, 할인 구간(60봉 범위 아래쪽 절반)만': { entry: 'limit', discount: 0.5 },
  'G 지정가 + 구조 전환 봉 거래량 1.5배': { entry: 'limit', mssVolReq: 1.5 },
  'H 지정가 + 일봉 추세 + 계단식 추적': { entry: 'limit', bias: true, ratchet: true },
  // (1-hour variants are below as ICT1H_EDGE)
// the daily chart under the signal (2026-11-08: a TVTX signal whose daily averages were far apart)
  'I 지정가 + 일봉 과열 아님(20일선 위 2ATR 이내)': { entry: 'limit', maxExt: 2 },
  'J 지정가 + 목표 전 일봉 50·200일선 저항 없음': { entry: 'limit', noOverhead: true },
  'K 지정가 + 일봉 20·50일선 벌어짐 15% 이내': { entry: 'limit', maxSpread: 0.15 },
  'L 지정가 + 일봉 추세 + 과열 아님 + 저항 없음': { entry: 'limit', bias: true, maxExt: 2, noOverhead: true },
  'M 지정가 + 할인 구간 + 거래량 1.5배': { entry: 'limit', discount: 0.5, mssVolReq: 1.5 },
  'N 지정가 + 할인 구간 + 과열 아님': { entry: 'limit', discount: 0.5, maxExt: 2 },
};

/** Trade every shift in one stock's 4-hour bars under variant v. Returns trades [{ t, R, win }]. */
export function tradesFor(bars, v, { cost = 0.001, maxHold: maxHold0 = 60, minRR = 1.5 } = {}) {
  const maxHold = v.maxHold ?? maxHold0;  // a quick variant can hold fewer bars
  const rules = { ...DESK_RULES, mssRaw: true, mssVolReq: v.mssVolReq ?? null };
  const atr = atrSeries(bars), trendOf = dailyBias(bars), bias = v.bias ? trendOf : null, out = [];
  const ctxOf = v.maxExt != null || v.noOverhead || v.maxSpread != null ? dailyContext(bars) : null;
  let busyUntil = -1;
  for (let i = 62; i < bars.length - 2; i++) {
    if (i <= busyUntil || !(atr[i] > 0)) continue;
    if (bias && bias.get(bars[i].day) !== true) continue;
    const m = structureShift(bars, i, atr[i], rules); if (!m) continue;
    const stop = m.sweepLow - 0.2 * atr[i];
    let hi = 0; for (let j = i - 60; j < i; j++) hi = Math.max(hi, bars[j].h);
    // entry
    let k = i + 1, entry;
    if (v.entry === 'limit') {
      const zone = m.fvg ? m.fvg[1] : m.ob ? m.ob.hi : (m.swingHigh + bars[i].c) / 2;
      const lim = Math.min(bars[i].c, Math.max(zone, stop + 1.2 * atr[i]));
      for (; k <= Math.min(i + 10, bars.length - 1); k++) { if (bars[k].o <= stop) { k = -1; break; } if (bars[k].l <= lim) { entry = Math.min(bars[k].o, lim); break; } }
      if (entry == null || k < 0) continue;
    } else entry = bars[k].o;
    const R = entry - stop; if (!(R > 0) || R / entry > 0.15) continue;
    if (v.discount != null) { let lo = Infinity; for (let j = i - 60; j < i; j++) lo = Math.min(lo, bars[j].l); if (entry > lo + v.discount * (hi - lo)) continue; }
    let target = v.ratchet ? Infinity : v.fixedR ? entry + v.fixedR * R : hi;
    if (!v.ratchet && (target - entry) / R < (v.fixedR ? 0 : minRR)) continue;
    if (v.capR) target = Math.min(target, entry + v.capR * R);   // quick exit: take the first capR R, do not wait for the old high
    if (ctxOf) {
      const cx = contextRead(ctxOf.get(bars[i].day), bars[i].c, entry, Number.isFinite(target) ? target : hi); if (!cx) continue;
      if (v.maxExt != null && cx.ext > v.maxExt) continue;
      if (v.noOverhead && cx.overhead != null) continue;
      if (v.maxSpread != null && cx.spread != null && Math.abs(cx.spread) > v.maxSpread) continue;
    }
    const trail = v.ratchet || v.ratchetToo; let stopNow = stop;
    let exit = null, j = k, kind = null, xi = k;
    if (bars[k].l <= stop) { exit = Math.min(bars[k].o, stop); kind = 'stop'; }  // stopped on the entry bar (conservative)
    for (j = k + (exit == null ? 1 : 0); exit == null && j < Math.min(bars.length, k + maxHold); j++) {
      const b = bars[j];
      if (b.o <= stopNow) exit = b.o; else if (b.l <= stopNow) exit = stopNow; else if (b.o >= target) exit = b.o; else if (b.h >= target) exit = target;
      if (exit != null) { xi = j; kind = exit >= target ? 'target' : stopNow > stop ? 'trail' : 'stop'; }
      // step trail, decided on this bar's close for the next bar: every full R gained lifts the stop by 1R (+1R → break-even)
      if (exit == null && trail) { const steps = Math.floor((b.c - entry) / R); if (steps >= 1) stopNow = Math.max(stopNow, entry + (steps - 1) * R); }
    }
    if (exit == null) { j = Math.min(bars.length - 1, k + maxHold - 1); exit = bars[j].c; xi = j; kind = j >= bars.length - 1 ? 'open' : 'timeout'; }
    const r = (exit - entry - cost * (entry + exit)) / R;
    let lo = Infinity; for (let q = i - 60; q < i; q++) lo = Math.min(lo, bars[q].l);
    out.push({ t: bars[i].day, R: r, win: r > 0, kind, entryPx: entry, exitPx: exit, stopPx: stop, entryT: bars[k].t, exitT: bars[xi].t, held: xi - k,
      trend: trendOf.get(bars[i].day) === true, volMult: m.volMult, stopPct: R / entry, disc: hi > lo && (entry - lo) / (hi - lo) <= 0.5 }); busyUntil = j;
  }
  return out;
}

/** price-inverted bars (p → 1/p): a bearish structure shift on the real chart is a bullish one here */
export function invertBars(bars) { return bars.map((b) => ({ day: b.day, t: b.t, o: 1 / b.o, h: 1 / b.l, l: 1 / b.h, c: 1 / b.c, v: b.v })); }
/**
 * Short trades: the same rule on the inverted chart (sweep of a swing high, displacement close under the swing low, sell
 * into the bearish gap / order block, stop over the swept high, cover at sell-side liquidity = the 60-bar low). R is
 * recomputed exactly on real prices. trend = the real daily close was under its 50-day average (a downtrend). Borrow
 * fees are not included.
 */
export function shortTradesFor(bars, v, opts = {}) {
  const cost = opts.cost ?? 0.001;
  return tradesFor(invertBars(bars), v, opts).map((t) => {
    const E = 1 / t.entryPx, X = 1 / t.exitPx, S = 1 / t.stopPx, R = (E - X - cost * (E + X)) / (S - E);
    return { ...t, side: 'short', R, win: R > 0, stopPct: (S - E) / E, entryPx: E, exitPx: X, stopPx: S };
  });
}
export const INVERSE_ETFS = ['SOXS', 'SQQQ', 'SPXS', 'TZA', 'LABD'];
export const BULL_ETFS = ['SOXL', 'TQQQ'];

/**
 * The signals as one account: take them in entry order, at most `maxOpen` at a time (one per stock is already enforced),
 * risking `riskPct` of the equity at entry on each (the R of a trade is its gain in units of that risk). Equity moves when
 * a trade closes. `pick(t)` can skip trades (a regime rule). Returns final multiple, CAGR, max drawdown, trades taken.
 */
export function portfolioSim(trades, { riskPct = 0.01, maxOpen = 5, pick = () => true, start = 1, maxGross = Infinity } = {}) {
  const ts = trades.filter((t) => t.entryT && t.kind !== 'open' && pick(t)).sort((a, b) => (a.entryT < b.entryT ? -1 : 1));
  let eq = start, peak = start, maxDD = 0, taken = 0; const open = [], monthEnd = new Map();
  const settle = (until) => {
    open.sort((a, b) => (a.exitT < b.exitT ? -1 : 1));
    while (open.length && open[0].exitT <= until) { const o = open.shift(); eq += o.risk * o.R; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq / peak - 1); monthEnd.set(o.exitT.slice(0, 7), eq); }
  };
  for (const t of ts) {
    settle(t.entryT);
    if (open.length >= maxOpen) continue;
    // cash limit: a position's value is its risk / stop distance; all open positions together stay under maxGross x equity
    let risk = eq * riskPct;
    if (Number.isFinite(maxGross) && t.stopPct > 0) {
      const used = open.reduce((a, o) => a + o.value, 0), room = maxGross * eq - used;
      if (room <= 0.02 * eq) continue;
      risk = Math.min(risk, room * t.stopPct);
    }
    open.push({ exitT: t.exitT, R: t.R, risk, value: t.stopPct > 0 ? risk / t.stopPct : 0 }); taken++;
  }
  settle('9999');
  const years = ts.length ? (Date.parse(ts.at(-1).exitT) - Date.parse(ts[0].entryT)) / (365.25 * 864e5) : 0;
  // calendar months from the first to the last trade (a month with no closed trade carries the equity over)
  const months = []; if (ts.length) { let prev = start, d = new Date(ts[0].entryT.slice(0, 7) + '-01T00:00:00Z'); const last = ts.at(-1).exitT.slice(0, 7);
    while (d.toISOString().slice(0, 7) <= last) { const k = d.toISOString().slice(0, 7), e = monthEnd.get(k) ?? prev; months.push(e / prev - 1); prev = e; d.setUTCMonth(d.getUTCMonth() + 1); } }
  const sorted = [...months].sort((a, b) => a - b);
  return { multiple: eq / start, cagr: years > 0 ? (eq / start) ** (1 / years) - 1 : null, maxDD, taken, years,
    worstMonth: sorted[0] ?? null, medianMonth: sorted.length ? sorted[sorted.length >> 1] : null, losingMonths: months.length ? months.filter((m) => m < 0).length / months.length : null, bestMonth: sorted.at(-1) ?? null };
}
export function byKind(trades) {
  const g = {}; for (const t of trades) { const a = (g[t.kind] ??= { n: 0, sumR: 0, held: 0 }); a.n++; a.sumR += t.R; a.held += t.held ?? 0; }
  for (const a of Object.values(g)) { a.avgR = a.sumR / a.n; a.avgHeld = a.held / a.n; }
  return g;
}

export function summarize(trades, split) {
  const s = (ts) => { const n = ts.length, w = ts.filter((t) => t.win).length, sum = ts.reduce((a, t) => a + t.R, 0), gw = ts.filter((t) => t.R > 0).reduce((a, t) => a + t.R, 0), gl = -ts.filter((t) => t.R < 0).reduce((a, t) => a + t.R, 0);
    return { n, winRate: n ? w / n : null, expectancyR: n ? sum / n : null, profitFactor: gl > 0 ? gw / gl : null }; };
  const byRegime = {}; for (const t of trades) (byRegime[t.reg ?? '-'] ??= []).push(t);
  return { all: s(trades), first: s(trades.filter((t) => t.t < split)), last: s(trades.filter((t) => t.t >= split)),
    byRegime: Object.fromEntries(Object.entries(byRegime).map(([k, ts]) => [k, s(ts)])),
    avgWinR: (() => { const w = trades.filter((t) => t.R > 0); return w.length ? w.reduce((a, t) => a + t.R, 0) / w.length : null; })(),
    avgLossR: (() => { const l = trades.filter((t) => t.R <= 0); return l.length ? l.reduce((a, t) => a + t.R, 0) / l.length : null; })() };
}

async function main() {
  const years = Number(arg('years', '2')), size = Number(arg('size', '300'));
  const latest = JSON.parse(readFileSync(arg('universe', 'data-branch/latest.json'), 'utf8'));
  const symbols = ['QQQ', ...chooseUniverse(latest, size).keys(), ...(arg('set') === 'both' ? [...INVERSE_ETFS, ...BULL_ETFS] : [])];
  const { fetchDailyBars } = await import('../packages/pipeline/alpaca.mjs');
  const start = new Date(Date.now() - (years + 0.3) * 365 * 864e5).toISOString().slice(0, 10);
  const t0 = Date.now();
  const series = new Map(), series1h = new Map();
  for (let i = 0; i < symbols.length; i += 10) { // keep memory flat: convert each batch to 4-hour bars right away
    const tb = Date.now();
    const { bars, requests, feed } = await fetchDailyBars({ symbols: symbols.slice(i, i + 10), start, end: new Date(Date.now() - 20 * 60 * 1000).toISOString(), timeframe: '1Hour', keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY, batchSize: 10 });
    let n = 0; for (const [s, b] of Object.entries(bars)) { n += b.length; const f = toFourHour(b); if (f.length > 200) series.set(s, f); if (!['growth', 'both'].includes(arg('set'))) { const h = hourBars(b); if (h.length > 400) series1h.set(s, h); } }
    console.log(`ict4h: ${Math.min(i + 10, symbols.length)}/${symbols.length} stocks, ${n} hourly bars, ${requests} requests, feed=${feed}, ${((Date.now() - tb) / 1000).toFixed(1)}s`);
  }
  console.log(`ict4h: ${series.size} stocks, ${((Date.now() - t0) / 1000).toFixed(0)}s to fetch`);
  const split = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  // market regime per day from QQQ's daily closes (known at the previous close, no look-ahead)
  const regOf = new Map(), q = series.get('QQQ'); series.delete('QQQ');
  if (q) {
    const days = []; for (const b of q) { if (!days.length || days.at(-1).day !== b.day) days.push({ day: b.day, c: b.c }); else days.at(-1).c = b.c; }
    const rs = regimeSeries(days); for (let i = 1; i < days.length; i++) regOf.set(days[i].day, rs[i - 1]);
    console.log(`ict4h: regimes ${JSON.stringify(Object.fromEntries([...regOf.values()].reduce((m, r) => m.set(r, (m.get(r) ?? 0) + 1), new Map())))}`);
  }
  const set = arg('set', 'base') === 'edge' ? ICT4H_EDGE : ICT4H_VARIANTS;
  const p = (x) => (x == null ? '   -  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
  const rows = [];
  const crash = (t) => t.reg === '급락 조정' || t.reg === '약세장';
  const regimeRule = (t) => crash(t) || (t.reg === '상승장' && t.trend);   // the regime playbook: trend in up-markets, everything after a crash
  const runSet = (tag, seriesMap, variants, barsPerDay) => {
    for (const [name, v] of Object.entries(variants)) {
      const all = []; for (const bars of seriesMap.values()) all.push(...tradesFor(bars, v));
      for (const t of all) t.reg = regOf.get(t.t) ?? null;
      const s = summarize(all, split); rows.push({ tf: tag, name, ...s });
      console.log(`${tag} ${name}\n    ${s.all.n}건 승률 ${p(s.all.winRate)} 거래당 ${s.all.expectancyR?.toFixed(2)}R PF ${s.all.profitFactor?.toFixed(2)}\n    앞(~${split}) ${s.first.n}건 ${p(s.first.winRate)} ${s.first.expectancyR?.toFixed(2)}R | 최근 1년 ${s.last.n}건 ${p(s.last.winRate)} ${s.last.expectancyR?.toFixed(2)}R\n    평균 이익 ${s.avgWinR?.toFixed(2)}R / 평균 손실 ${s.avgLossR?.toFixed(2)}R\n    시장 국면: ${Object.entries(s.byRegime).map(([k, a]) => `${k} ${a.n}건 승률 ${p(a.winRate)} ${a.expectancyR?.toFixed(2)}R`).join(' | ')}`);
      console.log(`    청산: ${Object.entries(byKind(all)).map(([k, a]) => `${{ target: '목표', stop: '손절', trail: '추적 손절', timeout: '60봉 만기', open: '보유 중' }[k] ?? k} ${a.n}건 ${a.avgR.toFixed(2)}R(평균 ${(a.avgHeld / barsPerDay).toFixed(1)}일)`).join(' | ')}`);
      for (const [label, pick] of [['전부', () => true], ['국면 규칙', regimeRule]]) {
        const line = [0.005, 0.01, 0.02].map((rp) => { const ps = portfolioSim(all, { riskPct: rp, maxOpen: 5, pick }); return `위험 ${(rp * 100).toFixed(1)}%: ${ps.multiple.toFixed(2)}배(연 ${p(ps.cagr)}, 낙폭 ${p(ps.maxDD)}, ${ps.taken}건)`; });
        console.log(`    계좌(${label}, 최대 5종목): ${line.join(' | ')}`);
      }
    }
  };
  if (arg('set') === 'both') {
    // both directions: long the 4-hour shift, short its mirror image, quick exits for counter-trend trades, and the
    // leveraged ETFs (SOXS etc.) traded long on their own charts, the way a Korean retail account can short a market
    const etfs = new Set([...INVERSE_ETFS, ...BULL_ETFS]), tag = (arr, sym) => arr.map((t) => ({ ...t, sym, reg: regOf.get(t.t) ?? null }));
    const G = { long: [], longQuick: [], short: [], shortQuick: [], inv: [], bull: [] };
    for (const [sym, bars] of series) {
      if (etfs.has(sym)) { (INVERSE_ETFS.includes(sym) ? G.inv : G.bull).push(...tag(tradesFor(bars, { entry: 'limit' }), sym)); continue; }
      G.long.push(...tag(tradesFor(bars, { entry: 'limit' }), sym));
      G.longQuick.push(...tag(tradesFor(bars, { entry: 'limit', capR: 2, maxHold: 20 }), sym));
      G.short.push(...tag(shortTradesFor(bars, { entry: 'limit' }), sym));
      G.shortQuick.push(...tag(shortTradesFor(bars, { entry: 'limit', capR: 2, maxHold: 20 }), sym));
    }
    const line = (label, ts) => { const s = summarize(ts, split); console.log(`BOTH ${label}: ${s.all.n}건 승률 ${p(s.all.winRate)} ${s.all.expectancyR?.toFixed(2)}R (앞 ${s.first.expectancyR?.toFixed(2)} / 최근 ${s.last.expectancyR?.toFixed(2)}) 평균 이익 ${s.avgWinR?.toFixed(2)}R 손실 ${s.avgLossR?.toFixed(2)}R\n    국면: ${Object.entries(s.byRegime).map(([k, a]) => `${k} ${a.n}건 ${p(a.winRate)} ${a.expectancyR?.toFixed(2)}R`).join(' | ')}`); };
    line('롱 추세 일치', G.long.filter((t) => t.trend));
    line('롱 역추세(원래 목표)', G.long.filter((t) => !t.trend));
    line('롱 역추세 빠른 청산(2R·10일)', G.longQuick.filter((t) => !t.trend));
    line('숏 하락 추세 일치', G.short.filter((t) => t.trend));
    line('숏 역추세', G.short.filter((t) => !t.trend));
    line('숏 하락 추세 빠른 청산(2R·10일)', G.shortQuick.filter((t) => t.trend));
    line('인버스 ETF 롱 전부(SOXS 등)', G.inv);
    line('인버스 ETF 롱 추세 일치', G.inv.filter((t) => t.trend));
    line('레버리지 ETF 롱 전부(SOXL·TQQQ)', G.bull);
    for (const sym of INVERSE_ETFS) { const ts = G.inv.filter((t) => t.sym === sym); if (ts.length) line(`  ${sym}`, ts); }
    const crashOrBear = (t) => t.reg === '급락 조정' || t.reg === '약세장';
    const books = {
      '롱 추세 일치만 (현재 규칙)': G.long.filter((t) => t.trend),
      '+ 급락·약세장 역추세 롱 빠른 청산': [...G.long.filter((t) => t.trend), ...G.longQuick.filter((t) => !t.trend && crashOrBear(t))],
      '+ 하락 추세 숏(개별주)': [...G.long.filter((t) => t.trend), ...G.short.filter((t) => t.trend)],
      '+ 하락 추세 숏 빠른 청산': [...G.long.filter((t) => t.trend), ...G.shortQuick.filter((t) => t.trend)],
      '+ 인버스 ETF 추세 일치': [...G.long.filter((t) => t.trend), ...G.inv.filter((t) => t.trend)],
      '+ 인버스 ETF 전부': [...G.long.filter((t) => t.trend), ...G.inv],
      '+ 숏 + 역추세 빠른 롱': [...G.long.filter((t) => t.trend), ...G.short.filter((t) => t.trend), ...G.longQuick.filter((t) => !t.trend && crashOrBear(t))],
    };
    for (const [name, ts] of Object.entries(books)) {
      const cells = [[0.01, 1], [0.02, 1], [0.02, 2]].map(([rp, g]) => { const ps = portfolioSim(ts, { riskPct: rp, maxOpen: 5, maxGross: g }); return `위험 ${rp * 100}%·현금 ${g}배 ${ps.multiple.toFixed(2)}배/연 ${p(ps.cagr)}/DD ${p(ps.maxDD)}`; });
      console.log(`BOOK ${name}: ${ts.length}건 | ${cells.join(' | ')}`);
    }
    return;
  }
  if (arg('set') === 'growth') {
    // growth research: one base rule (4-hour limit), then which signals to take, how many at once, how much risk,
    // under a real cash limit (1x = cash only, 2x = margin)
    const all = []; for (const bars of series.values()) all.push(...tradesFor(bars, { entry: 'limit' }));
    for (const t of all) t.reg = regOf.get(t.t) ?? null;
    const vol = (t) => t.volMult >= 1.5;
    const picks = {
      '추세 일치': (t) => t.trend,
      '추세 일치 + 거래량 전환': (t) => t.trend || vol(t),
      '추세 일치 + 급락·약세장 전부': (t) => t.trend || crash(t),
      '추세 일치 + 거래량 + 급락·약세장': (t) => t.trend || vol(t) || crash(t),
      '조정·횡보 제외 전부': (t) => t.reg !== '조정·횡보',
      '신호 전부': () => true,
    };
    console.log(`GROWTH base: ${all.length} trades, ${p(all.filter((t) => t.win).length / all.length)} win, ${(all.reduce((a, t) => a + t.R, 0) / all.length).toFixed(2)}R, median stop ${(all.map((t) => t.stopPct).sort((a, b) => a - b)[all.length >> 1] * 100).toFixed(1)}%`);
    const aggr = process.argv.includes('--aggr');   // aggressive grid: higher risk per trade, margin, fewer signal sets
    const pickSet = aggr ? Object.fromEntries(Object.entries(picks).filter(([k]) => k === '추세 일치' || k === '추세 일치 + 급락·약세장 전부')) : picks;
    const risks = aggr ? [0.02, 0.03, 0.04, 0.05, 0.07, 0.1] : [0.01, 0.015, 0.02, 0.03], opens = aggr ? [2, 3, 5] : [3, 5, 8];
    for (const [name, pick] of Object.entries(pickSet)) {
      const sub = all.filter(pick), s = summarize(sub, split);
      console.log(`GROWTH ${name}: ${s.all.n}건 ${s.all.expectancyR?.toFixed(2)}R (앞 ${s.first.expectancyR?.toFixed(2)} / 최근 ${s.last.expectancyR?.toFixed(2)})`);
      for (const gross of [1, 2]) for (const maxOpen of opens) {
        const line = risks.map((rp) => { const ps = portfolioSim(all, { riskPct: rp, maxOpen, pick, maxGross: gross }); return `${(rp * 100).toFixed(1)}% ${ps.multiple.toFixed(2)}배/${p(ps.cagr)}/DD${p(ps.maxDD)}${aggr ? `/월중앙${p(ps.medianMonth)}/최악월${p(ps.worstMonth)}/손실월${p(ps.losingMonths)}` : ''}`; });
        console.log(`    현금 ${gross}배, 최대 ${maxOpen}종목: ${line.join(' | ')}`);
      }
    }
    return;
  }
  runSet('ICT4H', series, set, 2);
  // the same rule on regular-session 1-hour bars (7 a day; 60 bars ≈ 9 sessions): faster structure, shorter holds
  if (series1h.size) { series1h.delete('QQQ'); runSet('ICT1H', series1h, set === ICT4H_EDGE ? ICT1H_EDGE : { '1시간 원형, 지정가': { entry: 'limit' } }, 7); }
  const out = arg('out'); if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), years, stocks: series.size, split, variants: rows })); }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Live view of the same rule (4-hour shift, limit in the gap / order block, stop under the swept low, target the 60-bar
 * high): every signal in `bars` with its plan and where it stands now. status: waiting (limit not reached yet), expired,
 * cancelled (opened under the stop first), open, won, lost, timeout. trend: the daily close was above its 50-day average.
 */
export function signalsFor(bars, { cost = 0.001, maxHold = 60, minRR = 1.5, fillBars = 10, since = 0, minRiskPct = 0.01 } = {}) {
  const rules = { ...DESK_RULES, mssRaw: true };
  const atr = atrSeries(bars), bias = dailyBias(bars), ctxOf = dailyContext(bars), out = [];
  for (let i = Math.max(62, since); i < bars.length; i++) {
    if (!(atr[i] > 0)) continue;
    const m = structureShift(bars, i, atr[i], rules); if (!m) continue;
    const stop = m.sweepLow - 0.2 * atr[i];
    let hi = 0; for (let j = i - 60; j < i; j++) hi = Math.max(hi, bars[j].h);
    const zone = m.fvg ? m.fvg[1] : m.ob ? m.ob.hi : (m.swingHigh + bars[i].c) / 2;
    const limit = Math.min(bars[i].c, Math.max(zone, stop + 1.2 * atr[i]));
    if (!(limit > stop) || (limit - stop) / limit > 0.15 || (hi - limit) / (limit - stop) < minRR) continue;
    if ((limit - stop) / limit < minRiskPct) continue; // a stop under 1% away is noise or a pinned price (pending takeover)
    const s = { t: bars[i].t, day: bars[i].day, close: bars[i].c, limit, stop, target: hi, rr: (hi - limit) / (limit - stop), trend: bias.get(bars[i].day) === true,
      zone: m.fvg ? 'FVG' : m.ob ? '오더블록' : '돌파 구간', sweepLow: m.sweepLow, swingHigh: m.swingHigh, status: 'waiting', volMult: m.volMult };
    { let lo = Infinity; for (let j = i - 60; j < i; j++) lo = Math.min(lo, bars[j].l); s.rangePos = hi > lo ? Math.round((limit - lo) / (hi - lo) * 100) / 100 : null; }
    const cx = contextRead(ctxOf.get(bars[i].day), bars[i].c, limit, hi);
    if (cx) s.daily = { ext: Math.round(cx.ext * 100) / 100, overhead: cx.overhead, spread: cx.spread != null ? Math.round(cx.spread * 1000) / 1000 : null, ema20: cx.ema20, sma50: cx.sma50, sma200: cx.sma200 };
    let k = i + 1, entry = null;
    for (; k < bars.length && k <= i + fillBars; k++) { if (bars[k].o <= stop) { s.status = 'cancelled'; break; } if (bars[k].l <= limit) { entry = Math.min(bars[k].o, limit); break; } }
    if (entry == null) { if (s.status !== 'cancelled' && k > i + fillBars) s.status = 'expired'; out.push(s); continue; }
    s.entry = entry; s.filledAt = bars[k].t; s.status = 'open';
    const R = entry - stop; let exit = null, j;
    if (bars[k].l <= stop) { exit = Math.min(bars[k].o, stop); s.status = 'lost'; j = k; }
    for (j = k + 1; exit == null && j < Math.min(bars.length, k + maxHold); j++) {
      const b = bars[j];
      if (b.o <= stop) { exit = b.o; s.status = 'lost'; } else if (b.l <= stop) { exit = stop; s.status = 'lost'; }
      else if (b.o >= hi) { exit = b.o; s.status = 'won'; } else if (b.h >= hi) { exit = hi; s.status = 'won'; }
    }
    if (exit == null && k + maxHold <= bars.length) { exit = bars[k + maxHold - 1].c; s.status = 'timeout'; }
    if (exit != null) { s.exit = exit; s.R = (exit - entry - cost * (entry + exit)) / R; }
    else s.last = bars.at(-1).c;
    out.push(s);
  }
  return out;
}
