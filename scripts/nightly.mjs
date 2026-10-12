#!/usr/bin/env node
// Usage: node scripts/nightly.mjs --cache .pipeline-cache --out data [--limit 200]
// Env: ALPACA_KEY_ID, ALPACA_SECRET_KEY, SEC_USER_AGENT, [ALPACA_FEED=sip|iex], [SEC_MAX_REFRESH]
import { runNightly } from '../packages/pipeline/run.mjs';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const missing = ['ALPACA_KEY_ID', 'ALPACA_SECRET_KEY', 'SEC_USER_AGENT'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}`);
  process.exit(2);
}
const t = Date.now();
runNightly({
  env: process.env,
  cacheDir: arg('cache', '.pipeline-cache'),
  outDir: arg('out', 'data'),
  limit: Number(arg('limit', 0)),
  historyDays: Number(arg('history-days', 800)),
  log: (m) => console.log(`[${((Date.now() - t) / 1000).toFixed(0)}s] ${m}`),
}).then(({ asOf, stats }) => {
  console.log(JSON.stringify({ asOf, ...stats }, null, 1));
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
