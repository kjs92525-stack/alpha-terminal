// Real daily bars for the simulator: every symbol any recommendation ledger has named (mid + short),
// plus SPY and QQQ, aligned to one trading calendar. Output is read by apps/simulator.
// Usage: node scripts/sim-bars.mjs --data data-branch --out data-branch/sim/bars.json
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchDailyBars } from '../packages/pipeline/alpaca.mjs';

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
  const symbols = [...new Set(['SPY', 'QQQ', ...docs.flatMap((d) => [...(d.mid ?? []), ...(d.short ?? [])].map((x) => x.symbol))])];
  const first = docs[0]?.asOf ?? new Date().toISOString().slice(0, 10);
  const start = new Date(Date.parse(first) - HISTORY_DAYS * 864e5).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  console.log(`sim-bars: ${docs.length} ledgers, ${symbols.length} symbols, ${start} → ${end}`);
  const { bars, requests, feed } = await fetchDailyBars({ symbols, start, end, keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY, batchSize: 50 });
  const payload = buildPayload(docs, bars);
  payload.gates = readGates(join(dataDir, 'market-brief/history'));
  payload.source += ` · feed=${feed}`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload));
  const missing = symbols.filter((s) => !payload.bars[s]);
  console.log(`sim-bars: ${Object.keys(payload.bars).length} series, ${payload.cal.length} days to ${payload.asOf}, ${requests} requests, ${(JSON.stringify(payload).length / 1e6).toFixed(1)} MB${missing.length ? `, missing: ${missing.join(',')}` : ''}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
