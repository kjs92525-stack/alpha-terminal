// Real daily bars for the simulator: every symbol any recommendation ledger has named (mid + short),
// plus SPY and QQQ, aligned to one trading calendar. Output is read by apps/simulator.
// Usage: node scripts/sim-bars.mjs --data data-branch --out data-branch/sim/bars.json
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchDailyBars } from '../packages/pipeline/alpaca.mjs';
import { makeFinnhubClient } from '../packages/pipeline/finnhub.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const dataDir = arg('data', 'data-branch'), out = arg('out', join(dataDir, 'sim/bars.json'));
const HISTORY_DAYS = 600; // calendar days before the first ledger: room for SMA200 + a 160-bar chart

export function buildPayload(ledgerDocs, bars, generatedAt = new Date().toISOString()) {
  const spy = bars.SPY ?? [];
  if (!spy.length) throw new Error('SPY bars missing — cannot build a trading calendar');
  const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  const cal = spy.map((b) => day(b.time)), pos = new Map(cal.map((d, i) => [d, i]));
  const sig = (x) => Number(x.toPrecision(6));
  const series = {};
  for (const [sym, arr] of Object.entries(bars)) {
    const byDay = new Map(arr.map((b) => [day(b.time), b])); let s = -1, prev = null; const rows = [];
    for (let i = 0; i < cal.length; i++) {
      const b = byDay.get(cal[i]);
      if (s < 0) { if (!b) continue; s = i; }
      if (b) { rows.push([sig(b.open), sig(b.high), sig(b.low), sig(b.close), Math.round(b.volume)]); prev = b.close; }
      else rows.push([sig(prev), sig(prev), sig(prev), sig(prev), 0]); // halted / missing day: flat bar
    }
    if (rows.length) series[sym] = { s, d: rows };
  }
  const slim = (x) => ({ symbol: x.symbol, name: x.name ?? null, sector: x.sector ?? null, score: x.score ?? null });
  const ledgers = ledgerDocs.map((l) => ({ asOf: l.asOf, mid: (l.mid ?? []).map(slim), short: (l.short ?? []).map(slim) }))
    .filter((l) => pos.has(l.asOf) || cal.some((d) => d > l.asOf));
  return { generatedAt, asOf: cal[cal.length - 1], source: 'Alpaca Market Data v2 (adjustment=all, daily)', cal, bars: series, ledgers };
}

/**
 * Every earnings date (past and next `aheadDays`) for the given symbols, month by month so the free
 * calendar endpoint never truncates. Returns { SYMBOL: [{ date, hour }] } sorted by date.
 */
export async function fetchEarnings(client, symbols, from, aheadDays = 45) {
  const out = {}, end = new Date(Date.now() + aheadDays * 864e5);
  for (let d = new Date(Date.parse(from) - 10 * 864e5); d < end; d = new Date(d.getTime() + 30 * 864e5)) {
    const a = d.toISOString().slice(0, 10), b = new Date(Math.min(d.getTime() + 29 * 864e5, end.getTime())).toISOString().slice(0, 10);
    const json = await client.json(`/calendar/earnings?from=${a}&to=${b}`);
    if (!Array.isArray(json?.earningsCalendar)) throw new Error('earnings calendar schema');
    for (const r of json.earningsCalendar) {
      if (!symbols.has(r?.symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '')) continue;
      const list = (out[r.symbol] ??= []);
      if (!list.some((x) => x.date === r.date)) list.push({ date: r.date, hour: r.hour ?? '' });
    }
  }
  for (const k of Object.keys(out)) out[k].sort((x, y) => (x.date < y.date ? -1 : 1));
  return out;
}

/** config/watchlist.txt → ['TEM', ...] (one ticker per line, '#' starts a comment) */
export function readWatchlist(path) {
  if (!existsSync(path)) return [];
  return [...new Set(readFileSync(path, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim().toUpperCase()).filter((t) => /^[A-Z][A-Z.\-]{0,9}$/.test(t)))];
}

/** Market verdict per date (market-brief/history/YYYY-MM-DD.json), so past cohorts use that day's cash rule. */
export function readGates(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    try { const b = JSON.parse(readFileSync(join(dir, f), 'utf8')); const st = b.decision?.state; if (st) out[b.asOf ?? f.slice(0, 10)] = st; } catch { /* skip unreadable */ }
  }
  return out;
}

async function main() {
  const ldir = join(dataDir, 'ledger');
  const docs = readdirSync(ldir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(join(ldir, f), 'utf8')));
  const latestPath = join(dataDir, 'latest.json');
  if (existsSync(latestPath)) { // today's picks may not be in the ledger yet
    const l = JSON.parse(readFileSync(latestPath, 'utf8'));
    if (!docs.some((d) => d.asOf === l.asOf)) {
      const by = (k) => new Map(l[k].map((r) => [r.symbol, r]));
      docs.push({ asOf: l.asOf, mid: l.recommendations.mid.map((s) => by('mid').get(s)).filter(Boolean), short: l.recommendations.short.map((s) => by('short').get(s)).filter(Boolean) });
    }
  }
  const symbols = [...new Set(['SPY', 'QQQ', ...readWatchlist(arg('watchlist', 'config/watchlist.txt')), ...docs.flatMap((d) => [...(d.mid ?? []), ...(d.short ?? []), ...(d.setups ?? []), ...(d.pullback ?? [])].map((x) => x.symbol))])];
  const first = docs[0]?.asOf ?? new Date().toISOString().slice(0, 10);
  const start = new Date(Date.parse(first) - HISTORY_DAYS * 864e5).toISOString().slice(0, 10);
  // The free plan serves consolidated (SIP) bars only up to 15 minutes ago. Asking for "today" makes Alpaca
  // refuse SIP and the client falls back to IEX, whose highs/lows and volume are one venue's, not the market's.
  const end = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  console.log(`sim-bars: ${docs.length} ledgers, ${symbols.length} symbols, ${start} → ${end}`);
  const { bars, requests, feed } = await fetchDailyBars({ symbols, start, end, keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY, batchSize: 50 });
  const payload = buildPayload(docs, bars);
  payload.gates = readGates(join(dataDir, 'market-brief/history'));
  payload.volumeReliable = feed === 'sip';
  if (process.env.FINNHUB_API_KEY) {
    try { payload.earnings = await fetchEarnings(makeFinnhubClient({ apiKey: process.env.FINNHUB_API_KEY }), new Set(symbols), first, 45); payload.earningsChecked = true; }
    catch (e) { console.warn(`sim-bars: earnings calendar unavailable (${e.message})`); payload.earningsChecked = false; }
  } else payload.earningsChecked = false;
  payload.source += ` · feed=${feed}`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload));
  // long history for the watchlist (config/watchlist.txt) so a user can build a scenario for any name they follow
  const watch = readWatchlist(arg('watchlist', 'config/watchlist.txt'));
  if (watch.length) {
    const wStart = new Date(Date.now() - 1300 * 864e5).toISOString().slice(0, 10);
    const w = await fetchDailyBars({ symbols: ['SPY', ...watch], start: wStart, end, keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY, batchSize: 50 });
    const wp = buildPayload([], w.bars); wp.volumeReliable = w.feed === 'sip';
    if (payload.earnings) { wp.earnings = Object.fromEntries(watch.filter((s) => payload.earnings[s]).map((s) => [s, payload.earnings[s]])); wp.earningsChecked = payload.earningsChecked; }
    wp.symbols = watch;
    writeFileSync(join(dirname(out), 'watch.json'), JSON.stringify(wp));
    console.log(`sim-bars: watchlist ${watch.join(',')} → ${Object.keys(wp.bars).length - 1} series`);
  }
  const missing = symbols.filter((s) => !payload.bars[s]);
  console.log(`sim-bars: ${Object.keys(payload.bars).length} series, ${payload.cal.length} days to ${payload.asOf}, ${requests} requests, ${(JSON.stringify(payload).length / 1e6).toFixed(1)} MB${missing.length ? `, missing: ${missing.join(',')}` : ''}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
