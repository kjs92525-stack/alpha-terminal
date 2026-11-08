// Show exactly why the 4-hour ICT rule fired on a stock: the bars around the signal, the swing high it broke, the
// swing low it swept, the gap / order block the limit sits in, the plan, and the daily chart (averages, trend) under it.
// Prints one INSPECT line of JSON per symbol so a run log can be charted elsewhere.
//
//   node scripts/inspect-signal.mjs --symbols RVMD,TVTX     (needs ALPACA_KEY_ID / ALPACA_SECRET_KEY)
import { structureShift, DESK_RULES } from '../packages/analysis/analyst-desk.mjs';
import { toFourHour, signalsFor, atrSeries, dailyContext, contextRead } from './ict-intraday.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

/** the structure behind one signal at 4-hour bar i */
export function explain(b4, i) {
  const atr = atrSeries(b4), m = structureShift(b4, i, atr[i], { ...DESK_RULES, mssRaw: true });
  if (!m) return null;
  return { atr: r2(atr[i]), swingHigh: { price: r2(m.swingHigh), t: b4[m.swingHighIdx].t }, swingLow: { price: r2(m.swingLow), t: b4[m.swingLowIdx].t },
    sweep: { price: r2(m.sweepLow), t: b4[m.sweepIdx].t }, fvg: m.fvg?.map(r2) ?? null, ob: m.ob ? [r2(m.ob.lo), r2(m.ob.hi)] : null, volMult: m.volMult,
    shiftBar: { t: b4[i].t, o: r2(b4[i].o), h: r2(b4[i].h), l: r2(b4[i].l), c: r2(b4[i].c) } };
}

async function main() {
  const symbols = arg('symbols', '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const { fetchDailyBars } = await import('../packages/pipeline/alpaca.mjs');
  const end = new Date(Date.now() - 20 * 60 * 1000).toISOString(), key = { keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY };
  const hourly = (await fetchDailyBars({ symbols, start: new Date(Date.now() - 160 * 864e5).toISOString().slice(0, 10), end, timeframe: '1Hour', ...key, batchSize: 10 })).bars;
  const daily = (await fetchDailyBars({ symbols, start: new Date(Date.now() - 420 * 864e5).toISOString().slice(0, 10), end, ...key, batchSize: 10 })).bars;
  for (const sym of symbols) {
    const b4 = toFourHour(hourly[sym] ?? []), d = daily[sym] ?? [];
    if (b4.length < 80) { console.log(`INSPECT ${sym} not enough 4-hour bars (${b4.length})`); continue; }
    const sigs = signalsFor(b4, { since: b4.length - 140 }), ctx = dailyContext(b4);
    const out = sigs.map((s) => {
      const i = b4.findIndex((b) => b.t === s.t);
      return { ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])), why: explain(b4, i),
        daily: contextRead(ctx.get(s.day), s.close, s.limit, s.target) };
    });
    // daily averages on the real daily bars (not the 4-hour reconstruction)
    const cl = d.map((x) => x.close), sma = (n, k) => (k >= n - 1 ? cl.slice(k - n + 1, k + 1).reduce((a, v) => a + v, 0) / n : null);
    const dd = d.slice(-90).map((x, j) => { const k = d.length - 90 + j; return [new Date(x.time * 1000).toISOString().slice(0, 10), r2(x.open), r2(x.high), r2(x.low), r2(x.close), x.volume, r2(sma(20, k)), r2(sma(50, k)), r2(sma(200, k))]; });
    console.log(`INSPECT ${sym} ` + JSON.stringify({ sym, last4h: b4.slice(-160).map((b) => [b.t, r2(b.o), r2(b.h), r2(b.l), r2(b.c), b.v]), daily: dd, signals: out }));
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
