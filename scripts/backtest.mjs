#!/usr/bin/env node
// Backtest the base-breakout setup on long history.
// Usage: node scripts/backtest.mjs --cache .backtest-cache --out data-branch [--limit 500] [--start 2016-01-01]
// Env: ALPACA_KEY_ID, ALPACA_SECRET_KEY, SEC_USER_AGENT (for the universe list)
import fs from 'node:fs';
import path from 'node:path';
import { fetchDailyBars } from '../packages/pipeline/alpaca.mjs';
import { parseExchangeTickers, buildUniverse } from '../packages/pipeline/universe.mjs';
import { makeSecClient } from '../packages/pipeline/secdata.mjs';
import { fetchAssets } from '../packages/pipeline/alpaca.mjs';
import { runBreakoutBacktest, loadBarsDir } from '../packages/pipeline/backtest.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const cacheDir = path.join(arg('cache', '.backtest-cache'), 'bars');
const outDir = arg('out', 'data-branch');
const limit = Number(arg('limit', 0));
const start = arg('start', '2016-01-01');
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// long-base winners, plus loss-making asset pivots (power/data-center capacity re-used for AI compute)
const CASES = ['PLTR', 'RGTI', 'QUBT', 'IONQ', 'IREN', 'CIFR', 'WULF', 'APLD'];
// SEC refuses GitHub runners; fall back to Alpaca's active US equities
let listed;
try {
  listed = parseExchangeTickers(await makeSecClient({ userAgent: process.env.SEC_USER_AGENT }).json('https://www.sec.gov/files/company_tickers_exchange.json'));
} catch (e) {
  log(`SEC unavailable (${e.message}) — universe from Alpaca`);
  listed = await fetchAssets({ keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY });
}
let universe = buildUniverse(listed).map((u) => u.symbol);
if (limit > 0) universe = universe.slice(0, limit);
// always include case studies
universe = [...new Set([...CASES, ...universe])];
fs.mkdirSync(cacheDir, { recursive: true });
const have = new Set(fs.readdirSync(cacheDir).map((f) => f.replace(/\.json$/, '')));
const need = ['SPY', ...universe].filter((s) => !have.has(s.replace(/[^A-Z0-9.\-]/gi, '_')));
log(`universe ${universe.length}, fetching ${need.length} symbols from ${start}`);
if (need.length) {
  const end = new Date(Date.now() - 20 * 60000).toISOString();
  const r = await fetchDailyBars({ symbols: need, start, end, keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY, onBatch: (d, t) => log(`bars ${d}/${t}`) });
  for (const [s, bars] of Object.entries(r.bars)) {
    fs.writeFileSync(path.join(cacheDir, `${s.replace(/[^A-Z0-9.\-]/gi, '_')}.json`), JSON.stringify(bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume])));
  }
}
const all = loadBarsDir(cacheDir);
const spy = all.SPY;
delete all.SPY;
log(`running backtest on ${Object.keys(all).length} symbols`);
// reported quarters with filing dates, from the nightly company snapshots on the data branch
const companiesDir = path.join(outDir, 'companies');
const factsBySymbol = {};
if (fs.existsSync(companiesDir)) for (const f of fs.readdirSync(companiesDir)) {
  try { const c = JSON.parse(fs.readFileSync(path.join(companiesDir, f), 'utf8')); if (c?.facts?.revenueQuarterly?.length) factsBySymbol[c.symbol ?? f.replace(/\.json$/, '')] = c.facts; } catch { /* skip unreadable */ }
}
log(`point-in-time fundamentals for ${Object.keys(factsBySymbol).length} symbols`);
const report = runBreakoutBacktest(all, spy, { caseStudies: CASES, factsBySymbol: Object.keys(factsBySymbol).length ? factsBySymbol : null });
fs.mkdirSync(path.join(outDir, 'backtest'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'backtest', 'breakouts.json'), JSON.stringify(report, null, 1));
log(`done: ${report.trades} trades`);
console.log(JSON.stringify({ all: report.report.all, caseStudies: report.caseStudies, nearMisses: report.caseNearMisses }, null, 1));
