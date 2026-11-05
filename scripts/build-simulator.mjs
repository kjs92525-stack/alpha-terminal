// Builds apps/simulator/simulator.html from the nightly `data` branch snapshot.
// Usage: git fetch origin data && node scripts/build-simulator.mjs
// The simulator is a Monte Carlo what-if: it does NOT use real future prices.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const show = (p) => JSON.parse(execFileSync('git', ['show', `origin/data:${p}`], { maxBuffer: 1 << 28 }).toString());
const latest = show('latest.json');
let brief = null;
try { brief = show('market-brief/latest.json'); } catch { /* optional */ }

const KEEP = ['mom_12_1', 'mom_6_1', 'high52_prox', 'trend_200', 'ma_50_200', 'vol_60', 'max_dd_1y', 'rsi_14', 'dist_ema20', 'atr_pct', 'ret_5', 'breakout_20', 'rel_vol'];
const pick = (bucket) => {
  const by = new Map(latest[bucket].map((r) => [r.symbol, r]));
  return latest.recommendations[bucket].map((s) => by.get(s)).filter(Boolean).map((r) => ({
    symbol: r.symbol, name: r.name, sector: r.sector, score: r.score, price: r.price, bucket,
    factors: r.factors, f: Object.fromEntries(KEEP.map((k) => [k, r.f?.[k] ?? null])),
  }));
};
const data = {
  asOf: latest.asOf, model: latest.model, generatedAt: latest.generatedAt,
  market: brief ? { state: brief.decision?.state, label: brief.decision?.label, reasons: brief.decision?.reasons ?? [] } : null,
  stocks: [...pick('mid'), ...pick('short')],
};
const tpl = readFileSync(new URL('../apps/simulator/template.html', import.meta.url), 'utf8');
const out = tpl.replace('/*__DATA__*/null', JSON.stringify(data));
writeFileSync(new URL('../apps/simulator/simulator.html', import.meta.url), out);
console.log(`simulator.html: ${data.stocks.length} stocks, asOf ${data.asOf}, market ${data.market?.state ?? 'n/a'}`);
