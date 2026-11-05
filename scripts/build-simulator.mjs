// Builds the simulator pages from apps/simulator/template.html.
//   apps/simulator/simulator.html  — self-contained (data embedded), for sharing as one file
//   public/simulator.html          — served by the web app at /simulator.html; loads the data branch at runtime
// Usage: git fetch origin data && node scripts/build-simulator.mjs [--bars sim/bars.json] [--desk desk/account.json]
// Real bars come from scripts/sim-bars.mjs (published to the data branch as sim/bars.json by
// .github/workflows/sim-bars.yml). Without them the page falls back to synthetic scenarios.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const show = (p) => JSON.parse(execFileSync('git', ['show', `origin/data:${p}`], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
const tryShow = (p) => { try { return show(p); } catch { return null; } };
const latest = arg('latest') ? JSON.parse(readFileSync(arg('latest'), 'utf8')) : show('latest.json');
const brief = tryShow('market-brief/latest.json');
const real = arg('bars') ? JSON.parse(readFileSync(arg('bars'), 'utf8')) : tryShow('sim/bars.json');
const desk = arg('desk') ? JSON.parse(readFileSync(arg('desk'), 'utf8')) : tryShow('desk/account.json');

const KEEP = ['mom_12_1', 'mom_6_1', 'high52_prox', 'trend_200', 'ma_50_200', 'vol_60', 'max_dd_1y', 'rsi_14', 'dist_ema20', 'atr_pct', 'ret_5', 'breakout_20', 'rel_vol'];
const pick = (bucket) => {
  const by = new Map(latest[bucket].map((r) => [r.symbol, r]));
  return latest.recommendations[bucket].map((s) => by.get(s)).filter(Boolean).map((r) => ({
    symbol: r.symbol, name: r.name, sector: r.sector, score: r.score, price: r.price, bucket,
    f: Object.fromEntries(KEEP.map((k) => [k, r.f?.[k] ?? null])),
  }));
};
const data = {
  asOf: latest.asOf, model: latest.model, generatedAt: latest.generatedAt,
  market: brief ? { state: brief.decision?.state, label: brief.decision?.label, reasons: brief.decision?.reasons ?? [] } : null,
  stocks: [...pick('mid'), ...pick('short')],
  real: real ?? undefined,
  desk: desk ?? undefined,
};
const tpl = readFileSync(new URL('../apps/simulator/template.html', import.meta.url), 'utf8');
if (!tpl.includes('/*__DATA__*/null')) throw new Error('template is missing the /*__DATA__*/null placeholder');
writeFileSync(new URL('../apps/simulator/simulator.html', import.meta.url), tpl.replace('/*__DATA__*/null', () => JSON.stringify(data)));
mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/simulator.html', import.meta.url),
  `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${tpl}\n</body>\n</html>\n`);
console.log(`simulator: ${data.stocks.length} stocks, asOf ${data.asOf}, market ${data.market?.state ?? 'n/a'}, real bars ${real ? `${Object.keys(real.bars).length} symbols to ${real.asOf}` : 'none (synthetic mode)'}, desk ${desk ? `${desk.ledgers.length} days, ${desk.stats.closed} closed` : 'none'}`);
