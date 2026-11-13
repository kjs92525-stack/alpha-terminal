// Momentum screen on daily bars, and the same screen tested on its own history.
// A stock passes on a day when (all known at that day's close):
//   liquid (price >= $10, 20-day average traded value >= $30M), close above a rising 50-day average (50 > 200 when there
//   is a 200), within 15% of its 252-day high, 1-month and 3-month returns ranked in the top 20% of the liquid universe,
//   20-day average volume at least 1.1x the 60-day average, and not stretched (close at most 2 daily ATR above the 20-day EMA).
// Event study: each pass is traded on its own under several entries and exits, costs 0.1% a side, one trade per stock at
// a time. The universe is today's listed symbols, so delisted stocks are missing (results lean optimistic).
//
//   node scripts/momentum-screen.mjs --rankings data-branch/rankings --years 3 [--out research/momo.json]
//     (needs ALPACA_KEY_ID / ALPACA_SECRET_KEY)
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { regimeSeries } from './desk-backtest.mjs';
import { portfolioSim, summarize } from './ict-intraday.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };

export const MOMO_RULES = { minPrice: 10, minAdv: 30e6, nearHigh: 0.85, rsTop: 0.8, volRatio: 1.1, maxExtAtr: 2, slopeDays: 20 };

/** per-bar indicators for one stock: bars = [{ day, o, h, l, c, v }] oldest first */
export function indicators(bars) {
  const n = bars.length, out = new Array(n);
  let s20v = 0, s60v = 0, s50 = 0, s200 = 0, sAdv = 0, e20 = null, atr = null; const m50 = [];
  for (let i = 0; i < n; i++) {
    const b = bars[i], c = b.c;
    s50 += c; if (i >= 50) s50 -= bars[i - 50].c; s200 += c; if (i >= 200) s200 -= bars[i - 200].c;
    s20v += b.v; if (i >= 20) s20v -= bars[i - 20].v; s60v += b.v; if (i >= 60) s60v -= bars[i - 60].v;
    sAdv += b.v * c; if (i >= 20) sAdv -= bars[i - 20].v * bars[i - 20].c;
    e20 = e20 == null ? c : c * 2 / 21 + e20 * 19 / 21;
    const tr = i ? Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)) : b.h - b.l;
    atr = atr == null ? tr : (atr * 13 + tr) / 14;
    const sma50 = i >= 49 ? s50 / 50 : null; m50.push(sma50);
    let hi252 = null; if (i >= 119) { hi252 = 0; for (let j = Math.max(0, i - 251); j <= i; j++) hi252 = Math.max(hi252, bars[j].h); }
    out[i] = { ema20: e20, sma50, sma50prev: i >= 69 ? m50[i - 20] : null, sma200: i >= 199 ? s200 / 200 : null, atr, hi252,
      adv: i >= 19 ? sAdv / 20 : null, volRatio: i >= 59 && s60v > 0 ? (s20v / 20) / (s60v / 60) : null,
      ret21: i >= 21 ? c / bars[i - 21].c - 1 : null, ret63: i >= 63 ? c / bars[i - 63].c - 1 : null };
  }
  return out;
}

/** everything but the cross-sectional rank: is the stock liquid, and does its own chart pass */
export function chartPass(b, x, rules = MOMO_RULES) {
  const liquid = b.c >= rules.minPrice && x.adv >= rules.minAdv && x.ret21 != null && x.ret63 != null;
  if (!liquid) return { liquid: false, pass: false };
  const trend = x.sma50 != null && b.c > x.sma50 && x.sma50prev != null && x.sma50 > x.sma50prev && (x.sma200 == null || x.sma50 > x.sma200);
  const nearHigh = x.hi252 ? b.c / x.hi252 : null, ext = x.atr > 0 ? (b.c - x.ema20) / x.atr : null;
  return { liquid, trend, nearHigh, ext, volRatio: x.volRatio,
    pass: trend && nearHigh >= rules.nearHigh && x.volRatio >= rules.volRatio && ext != null && ext <= rules.maxExtAtr && ext >= 0 };
}

/**
 * The screen over a whole universe. data = Map(symbol → bars). Returns { days, passes: Map(day → [{ sym, i, rs, ... }]) }
 * where rs is the average of the 21- and 63-session return percentiles among liquid stocks that day.
 */
export function screenAll(data, rules = MOMO_RULES, { fromDay = '' } = {}) {
  const ind = new Map(), byDay = new Map();
  for (const [sym, bars] of data) {
    const xs = indicators(bars); ind.set(sym, xs);
    for (let i = 63; i < bars.length; i++) {
      if (bars[i].day < fromDay) continue;
      const cp = chartPass(bars[i], xs[i], rules); if (!cp.liquid) continue;
      let a = byDay.get(bars[i].day); if (!a) byDay.set(bars[i].day, a = []);
      a.push({ sym, i, r21: xs[i].ret21, r63: xs[i].ret63, ...cp });
    }
  }
  const passes = new Map(), liquidCount = new Map();
  for (const [day, rows] of byDay) {
    const rank = (key) => { const s = rows.map((r) => r[key]).sort((a, b) => a - b); return (v) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo / s.length; }; };
    const p21 = rank('r21'), p63 = rank('r63');
    for (const r of rows) r.rs = (p21(r.r21) + p63(r.r63)) / 2;
    liquidCount.set(day, rows.length);
    passes.set(day, rows.filter((r) => r.pass && r.rs >= rules.rsTop).sort((a, b) => b.rs - a.rs));
    byDay.set(day, rows);
  }
  return { ind, passes, liquid: byDay, liquidCount };
}

export const MOMO_VARIANTS = {
  'A 다음날 시가, 손절 1.5ATR, 목표 3R, 최대 20일': { entry: 'open', stopAtr: 1.5, targetR: 3, maxHold: 20 },
  'B 다음날 시가, 손절 1.5ATR, 목표 2R, 최대 20일': { entry: 'open', stopAtr: 1.5, targetR: 2, maxHold: 20 },
  'C 다음날 시가, 손절 1.5ATR, 목표 없음, 20일선 종가 이탈 시 청산, 최대 20일': { entry: 'open', stopAtr: 1.5, exitEma: true, maxHold: 20 },
  'D 신호일 고가 돌파 매수(5일 유효), 손절 1.5ATR, 목표 3R': { entry: 'breakout', stopAtr: 1.5, targetR: 3, maxHold: 20 },
  'E 20일선 지정가(5일 유효), 손절 1.5ATR, 목표 3R': { entry: 'pullback', stopAtr: 1.5, targetR: 3, maxHold: 20 },
  'F 다음날 시가, 손절 2ATR, 목표 3R, 최대 20일': { entry: 'open', stopAtr: 2, targetR: 3, maxHold: 20 },
};

/** trade one signal list on one stock: sig = sorted bar indexes where the stock passed (or any entry condition) */
export function tradeSignals(bars, xs, sig, v, { cost = 0.001 } = {}) {
  const out = []; let busyUntil = -1;
  for (const i of sig) {
    if (i <= busyUntil || i + 1 >= bars.length) continue;
    const atr = xs[i].atr; if (!(atr > 0)) continue;
    let k = i + 1, entry = null;
    if (v.entry === 'open') entry = bars[k].o;
    else if (v.entry === 'breakout') { const trig = bars[i].h + 0.01; for (; k <= Math.min(i + 5, bars.length - 1); k++) if (bars[k].h >= trig) { entry = Math.max(bars[k].o, trig); break; } }
    else if (v.entry === 'pullback') { for (; k <= Math.min(i + 5, bars.length - 1); k++) { const lim = xs[k - 1].ema20; if (bars[k].l <= lim) { entry = Math.min(bars[k].o, lim); break; } } }
    if (entry == null) continue;
    const stop = entry - v.stopAtr * atr, R = entry - stop; if (!(R > 0) || R / entry > 0.15) continue;
    const target = v.targetR ? entry + v.targetR * R : Infinity;
    let exit = null, kind = null, xi = k, j;
    // the entry bar: only the part after the fill counts; a low under the stop is taken as a stop (conservative)
    if (bars[k].l <= stop) { exit = stop; kind = 'stop'; }
    for (j = k + 1; exit == null && j < Math.min(bars.length, k + v.maxHold); j++) {
      const b = bars[j];
      if (b.o <= stop) exit = b.o; else if (b.l <= stop) exit = stop; else if (b.o >= target) exit = b.o; else if (b.h >= target) exit = target;
      if (exit != null) { xi = j; kind = exit >= target ? 'target' : 'stop'; break; }
      if (v.exitEma && b.c < xs[j].ema20 && j + 1 < bars.length) { exit = bars[j + 1].o; xi = j + 1; kind = 'ema'; break; }
    }
    if (exit == null) { xi = Math.min(bars.length - 1, k + v.maxHold - 1); exit = bars[xi].c; kind = xi >= bars.length - 1 && xi < k + v.maxHold - 1 ? 'open' : 'timeout'; }
    out.push({ t: bars[i].day, entryT: bars[k].day, exitT: bars[xi].day, entryPx: entry, exitPx: exit, stopPx: stop, R: (exit - entry - cost * (entry + exit)) / R, kind, held: xi - k, stopPct: R / entry });
    out.at(-1).win = out.at(-1).R > 0; busyUntil = xi;
  }
  return out;
}

async function main() {
  const years = Number(arg('years', '3')), dir = arg('rankings', 'data-branch/rankings');
  const file = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().at(-1), rk = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const iS = rk.columns.indexOf('symbol'), iP = rk.columns.indexOf('price'), iSec = rk.columns.indexOf('sector');
  const sectorOf = new Map(rk.rows.map((r) => [r[iS], r[iSec]]));
  const symbols = ['QQQ', 'SPY', ...rk.rows.filter((r) => r[iP] >= 8 && /^[A-Z]+$/.test(r[iS])).map((r) => r[iS])];
  const { fetchDailyBars } = await import('../packages/pipeline/alpaca.mjs');
  const start = new Date(Date.now() - (years + 1.1) * 365 * 864e5).toISOString().slice(0, 10), t0 = Date.now();
  const { bars: raw, requests, feed } = await fetchDailyBars({ symbols, start, end: new Date(Date.now() - 20 * 60 * 1000).toISOString(), keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY, batchSize: 100,
    onBatch: (a, b) => { if (a % 500 === 0 || a === b) console.log(`momo: ${a}/${b} symbols`); } });
  const data = new Map();
  for (const [s, b] of Object.entries(raw)) { const x = b.map((r) => ({ day: new Date(r.time * 1000).toISOString().slice(0, 10), o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume })); if (x.length > 130) data.set(s, x); }
  console.log(`momo: ${data.size} stocks, ${requests} requests, feed=${feed}, ${((Date.now() - t0) / 1000).toFixed(0)}s, last day ${data.get('QQQ')?.at(-1)?.day}`);
  const q = data.get('QQQ'); data.delete('QQQ'); data.delete('SPY');
  const regOf = new Map(); { const rs = regimeSeries(q); for (let i = 1; i < q.length; i++) regOf.set(q[i].day, rs[i - 1]); }
  const fromDay = new Date(Date.now() - years * 365 * 864e5).toISOString().slice(0, 10), split = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const { ind, passes, liquid, liquidCount } = screenAll(data, MOMO_RULES, { fromDay });
  const days = [...passes.keys()].sort(), last = days.at(-1);
  console.log(`momo: ${days.length} days from ${days[0]}, liquid stocks/day median ${[...liquidCount.values()].sort((a, b) => a - b)[liquidCount.size >> 1]}, passes/day median ${[...passes.values()].map((a) => a.length).sort((a, b) => a - b)[passes.size >> 1]}`);

  // ---- history: the screen as a trade, against the same exits on any liquid stock above its 50-day average ----
  const p = (x) => (x == null ? '   -  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
  const sigOf = (pick) => { const m = new Map(); for (const d of days) for (const r of (pick === 'screen' ? passes.get(d) : liquid.get(d).filter(pick))) { let a = m.get(r.sym); if (!a) m.set(r.sym, a = []); a.push({ i: r.i, rs: r.rs }); } return m; };
  const groups = { '스크린 통과': sigOf('screen'), '비교: 유동성 + 50일선 위(상승)만': sigOf((r) => r.trend), '비교: 스크린에서 과열 제한만 뺌': sigOf((r) => r.trend && r.nearHigh >= MOMO_RULES.nearHigh && r.volRatio >= MOMO_RULES.volRatio && r.rs >= MOMO_RULES.rsTop),
    '비교: 스크린 + 상대강도 상위 10%': sigOf((r) => r.pass && r.rs >= 0.9), '비교: 스크린 + 52주 고점 5% 이내': sigOf((r) => r.pass && r.rs >= MOMO_RULES.rsTop && r.nearHigh >= 0.95) };
  const rows = [];
  for (const [gname, sig] of Object.entries(groups)) for (const [vname, v] of Object.entries(MOMO_VARIANTS)) {
    if (gname !== '스크린 통과' && !vname.startsWith('A ') && !vname.startsWith('D ')) continue;
    const all = [];
    for (const [sym, list] of sig) { const bars = data.get(sym), rsAt = new Map(list.map((x) => [x.i, x.rs])); for (const t of tradeSignals(bars, ind.get(sym), list.map((x) => x.i), v)) { t.sym = sym; t.reg = regOf.get(t.t) ?? null; t.rs = rsAt.get(bars.findIndex((b) => b.day === t.t)); all.push(t); } }
    all.sort((a, b) => (a.entryT < b.entryT ? -1 : a.entryT > b.entryT ? 1 : b.rs - a.rs));
    const s = summarize(all, split), sims = [0.02, 0.03].map((rp) => ({ riskPct: rp, ...portfolioSim(all, { riskPct: rp, maxOpen: 3, maxGross: 1 }) }));
    rows.push({ group: gname, variant: vname, ...s, account: sims });
    console.log(`MOMOSTUDY ${gname} | ${vname}: ${s.all.n}건 승률 ${p(s.all.winRate)} ${s.all.expectancyR?.toFixed(2)}R PF ${s.all.profitFactor?.toFixed(2)} (앞 ${s.first.expectancyR?.toFixed(2)} / 최근 1년 ${s.last.expectancyR?.toFixed(2)}) 평균 이익 ${s.avgWinR?.toFixed(2)}R 손실 ${s.avgLossR?.toFixed(2)}R | ${sims.map((ps) => `위험 ${ps.riskPct * 100}% 최대 3종목 ${ps.multiple.toFixed(2)}배/연 ${p(ps.cagr)}/DD ${p(ps.maxDD)}/최악월 ${p(ps.worstMonth)}`).join(' | ')}\n    국면: ${Object.entries(s.byRegime).map(([k, a]) => `${k} ${a.n}건 승률 ${p(a.winRate)} ${a.expectancyR?.toFixed(2)}R`).join(' | ')}`);
  }

  // ---- today: who passes, and the near misses (one condition short), strongest first ----
  const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
  const row = (r) => { const b = data.get(r.sym), x = ind.get(r.sym)[r.i], c = b[r.i].c; let hi20 = 0, lo10 = Infinity; for (let j = r.i - 19; j <= r.i; j++) hi20 = Math.max(hi20, b[j].h); for (let j = r.i - 9; j <= r.i; j++) lo10 = Math.min(lo10, b[j].l);
    return { sym: r.sym, sector: sectorOf.get(r.sym) ?? null, close: r2(c), rs: r2(r.rs), ret21: r2(r.r21), ret63: r2(r.r63), nearHigh: r2(r.nearHigh), ext: r2(r.ext), volRatio: r2(r.volRatio), adv: Math.round(x.adv / 1e6),
      ema20: r2(x.ema20), sma50: r2(x.sma50), sma200: r2(x.sma200), atr: r2(x.atr), hi252: r2(x.hi252), hi20: r2(hi20), lo10: r2(lo10), dayHigh: r2(b[r.i].h), dayLow: r2(b[r.i].l), chg1: r2(c / b[r.i - 1].c - 1), chg5: r2(c / b[r.i - 5].c - 1) }; };
  const today = passes.get(last).map(row);
  const near = liquid.get(last).filter((r) => !(r.pass && r.rs >= MOMO_RULES.rsTop) && r.trend && r.rs >= 0.7 && r.nearHigh >= 0.8 && r.ext != null && r.ext <= 3 && r.ext >= -0.5).sort((a, b) => b.rs - a.rs).slice(0, 40).map(row);
  console.log(`MOMO ${JSON.stringify({ asOf: last, regime: regimeSeries(q).at(-1), liquid: liquidCount.get(last), pass: today, near })}`);
  const out = arg('out'); if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), asOf: last, years, rules: MOMO_RULES, study: rows, pass: today, near })); }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
