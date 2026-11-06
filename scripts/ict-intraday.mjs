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
import { chooseUniverse } from './desk-backtest.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const offsetCache = new Map(); // UTC date → New York offset in hours (DST-aware, computed once a day)
const etParts = (iso) => {
  const d = iso.slice(0, 10);
  let off = offsetCache.get(d);
  if (off == null) { const p = Object.fromEntries(ET.formatToParts(new Date(`${d}T16:00:00Z`)).map((x) => [x.type, x.value])); off = Number(p.hour) - 16; offsetCache.set(d, off); }
  const t = new Date(Date.parse(iso) + off * 3600e3);
  return { day: t.toISOString().slice(0, 10), h: t.getUTCHours(), m: t.getUTCMinutes() };
};

/** Alpaca 1-hour bars → regular-session 4-hour bars (09:30-13:30 and 13:30-16:00 ET) plus daily closes. */
export function toFourHour(hourly) {
  const blocks = new Map();
  for (const raw of hourly) {
    const b = { t: new Date(raw.time * 1000).toISOString(), o: raw.open, h: raw.high, l: raw.low, c: raw.close, v: raw.volume };
    const { day, h } = etParts(b.t);
    if (h < 9 || h > 15) continue;                  // the 09:00 bar starts at 09:30 for regular-session data; 16:00+ is after hours
    const key = `${day}|${h < 13 ? 'A' : 'B'}`;
    const x = blocks.get(key);
    if (!x) blocks.set(key, { day, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; x.v += b.v; }
  }
  return [...blocks.values()].sort((a, b) => (a.t < b.t ? -1 : 1));
}

function atrSeries(bars, n = 14) {
  const out = new Array(bars.length).fill(NaN); let s = 0;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
    s += tr; if (i > n) s -= Math.max(bars[i - n].h - bars[i - n].l, Math.abs(bars[i - n].h - bars[i - n - 1].c), Math.abs(bars[i - n].l - bars[i - n - 1].c));
    if (i >= n) out[i] = s / n;
  }
  return out;
}

/** daily-close trend for the higher-timeframe bias: close above its 50-day average */
function dailyBias(bars4) {
  const days = []; for (const b of bars4) { if (!days.length || days.at(-1).day !== b.day) days.push({ day: b.day, c: b.c }); else days.at(-1).c = b.c; }
  const up = new Map(); let s = 0;
  for (let i = 0; i < days.length; i++) { s += days[i].c; if (i >= 50) s -= days[i - 50].c; if (i >= 49) up.set(days[i].day, days[i].c > s / 50); }
  // bias known at the previous day's close (no look-ahead into the signal day)
  const prev = new Map(); for (let i = 1; i < days.length; i++) prev.set(days[i].day, up.get(days[i - 1].day));
  return prev;
}

export const ICT4H_VARIANTS = {
  '4시간 원형, 다음 봉 시가': { entry: 'market' },
  '4시간 원형 + 거래량 1.5배': { entry: 'market', mssVolReq: 1.5 },
  '4시간 원형 + 일봉 상승 추세(50일선 위)': { entry: 'market', bias: true },
  '4시간 + 일봉 추세 + 거래량 1.5배': { entry: 'market', bias: true, mssVolReq: 1.5 },
  '4시간 원형, FVG·오더블록 지정가': { entry: 'limit' },
  '4시간 + 일봉 추세, 지정가': { entry: 'limit', bias: true },
  '4시간 + 일봉 추세, 목표 2R 고정': { entry: 'market', bias: true, fixedR: 2 },
};

/** Trade every shift in one stock's 4-hour bars under variant v. Returns trades [{ t, R, win }]. */
export function tradesFor(bars, v, { cost = 0.001, maxHold = 60, minRR = 1.5 } = {}) {
  const rules = { ...DESK_RULES, mssRaw: true, mssVolReq: v.mssVolReq ?? null };
  const atr = atrSeries(bars), bias = v.bias ? dailyBias(bars) : null, out = [];
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
    const target = v.fixedR ? entry + v.fixedR * R : hi;
    if ((target - entry) / R < (v.fixedR ? 0 : minRR)) continue;
    let exit = null, j = k;
    if (bars[k].l <= stop) exit = Math.min(bars[k].o, stop);               // stopped on the entry bar (conservative)
    for (j = k + (exit == null ? 1 : 0); exit == null && j < Math.min(bars.length, k + maxHold); j++) {
      const b = bars[j];
      if (b.o <= stop) exit = b.o; else if (b.l <= stop) exit = stop; else if (b.o >= target) exit = b.o; else if (b.h >= target) exit = target;
    }
    if (exit == null) { j = Math.min(bars.length - 1, k + maxHold - 1); exit = bars[j].c; }
    const r = (exit - entry - cost * (entry + exit)) / R;
    out.push({ t: bars[i].day, R: r, win: r > 0 }); busyUntil = j;
  }
  return out;
}

export function summarize(trades, split) {
  const s = (ts) => { const n = ts.length, w = ts.filter((t) => t.win).length, sum = ts.reduce((a, t) => a + t.R, 0), gw = ts.filter((t) => t.R > 0).reduce((a, t) => a + t.R, 0), gl = -ts.filter((t) => t.R < 0).reduce((a, t) => a + t.R, 0);
    return { n, winRate: n ? w / n : null, expectancyR: n ? sum / n : null, profitFactor: gl > 0 ? gw / gl : null }; };
  return { all: s(trades), first: s(trades.filter((t) => t.t < split)), last: s(trades.filter((t) => t.t >= split)) };
}

async function main() {
  const years = Number(arg('years', '2')), size = Number(arg('size', '300'));
  const latest = JSON.parse(readFileSync(arg('universe', 'data-branch/latest.json'), 'utf8'));
  const symbols = [...chooseUniverse(latest, size).keys()];
  const { fetchDailyBars } = await import('../packages/pipeline/alpaca.mjs');
  const start = new Date(Date.now() - (years + 0.3) * 365 * 864e5).toISOString().slice(0, 10);
  const t0 = Date.now();
  const series = new Map();
  for (let i = 0; i < symbols.length; i += 10) { // keep memory flat: convert each batch to 4-hour bars right away
    const tb = Date.now();
    const { bars, requests, feed } = await fetchDailyBars({ symbols: symbols.slice(i, i + 10), start, end: new Date(Date.now() - 20 * 60 * 1000).toISOString(), timeframe: '1Hour', keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY, batchSize: 10 });
    let n = 0; for (const [s, b] of Object.entries(bars)) { n += b.length; const f = toFourHour(b); if (f.length > 200) series.set(s, f); }
    console.log(`ict4h: ${Math.min(i + 10, symbols.length)}/${symbols.length} stocks, ${n} hourly bars, ${requests} requests, feed=${feed}, ${((Date.now() - tb) / 1000).toFixed(1)}s`);
  }
  console.log(`ict4h: ${series.size} stocks, ${((Date.now() - t0) / 1000).toFixed(0)}s to fetch`);
  const split = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const p = (x) => (x == null ? '   -  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
  const rows = [];
  for (const [name, v] of Object.entries(ICT4H_VARIANTS)) {
    const all = []; for (const bars of series.values()) all.push(...tradesFor(bars, v));
    const s = summarize(all, split); rows.push({ name, ...s });
    console.log(`ICT4H ${name}\n    ${s.all.n}건 승률 ${p(s.all.winRate)} 거래당 ${s.all.expectancyR?.toFixed(2)}R PF ${s.all.profitFactor?.toFixed(2)}\n    앞(~${split}) ${s.first.n}건 ${p(s.first.winRate)} ${s.first.expectancyR?.toFixed(2)}R | 최근 1년 ${s.last.n}건 ${p(s.last.winRate)} ${s.last.expectancyR?.toFixed(2)}R`);
  }
  const out = arg('out'); if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), years, stocks: series.size, split, variants: rows })); }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Live view of the same rule (4-hour shift, limit in the gap / order block, stop under the swept low, target the 60-bar
 * high): every signal in `bars` with its plan and where it stands now. status: waiting (limit not reached yet), expired,
 * cancelled (opened under the stop first), open, won, lost, timeout. trend: the daily close was above its 50-day average.
 */
export function signalsFor(bars, { cost = 0.001, maxHold = 60, minRR = 1.5, fillBars = 10, since = 0 } = {}) {
  const rules = { ...DESK_RULES, mssRaw: true };
  const atr = atrSeries(bars), bias = dailyBias(bars), out = [];
  for (let i = Math.max(62, since); i < bars.length; i++) {
    if (!(atr[i] > 0)) continue;
    const m = structureShift(bars, i, atr[i], rules); if (!m) continue;
    const stop = m.sweepLow - 0.2 * atr[i];
    let hi = 0; for (let j = i - 60; j < i; j++) hi = Math.max(hi, bars[j].h);
    const zone = m.fvg ? m.fvg[1] : m.ob ? m.ob.hi : (m.swingHigh + bars[i].c) / 2;
    const limit = Math.min(bars[i].c, Math.max(zone, stop + 1.2 * atr[i]));
    if (!(limit > stop) || (limit - stop) / limit > 0.15 || (hi - limit) / (limit - stop) < minRR) continue;
    const s = { t: bars[i].t, day: bars[i].day, close: bars[i].c, limit, stop, target: hi, rr: (hi - limit) / (limit - stop), trend: bias.get(bars[i].day) === true,
      zone: m.fvg ? 'FVG' : m.ob ? '오더블록' : '돌파 구간', sweepLow: m.sweepLow, swingHigh: m.swingHigh, status: 'waiting' };
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
