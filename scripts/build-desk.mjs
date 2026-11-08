// Builds Alpha Desk from apps/desk/template.html.
//   apps/desk/desk.html — self-contained (data embedded), for the Claude artifact
//   public/desk.html    — served by the web app at /desk.html; loads the data branch at runtime
// Usage: git fetch origin data && node scripts/build-desk.mjs [--latest f] [--desk f] [--backtest f] [--ict4h f] [--bars f] [--watch f] [--brief f]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const show = (p) => JSON.parse(execFileSync('git', ['show', `origin/data:${p}`], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
const load = (k, p) => { try { return arg(k) ? JSON.parse(readFileSync(arg(k), 'utf8')) : show(p); } catch { return null; } };
const latest = load('latest', 'latest.json'), brief = load('brief', 'market-brief/latest.json');
const data = {
  asOf: latest?.asOf ?? null,
  market: brief?.decision ? { state: brief.decision.state, label: brief.decision.label, reasons: brief.decision.reasons ?? [] } : null,
  desk: load('desk', 'desk/account.json'), backtest: load('backtest', 'desk/backtest.json'), ict4h: load('ict4h', 'desk/ict4h.json'),
  real: load('bars', 'sim/bars.json'), watch: load('watch', 'sim/watch.json'),
};
const engineSrc = readFileSync(new URL('../packages/analysis/analyst-desk.mjs', import.meta.url), 'utf8');
const names = [...engineSrc.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
const engine = `const DeskEngine = (() => {\n${engineSrc.replace(/^export /gm, '')}\nreturn { ${names.join(', ')} };\n})();`;
const tpl = readFileSync(new URL('../apps/desk/template.html', import.meta.url), 'utf8');
if (!tpl.includes('/*__DATA__*/null') || !tpl.includes('/*__ENGINE__*/')) throw new Error('template is missing a placeholder');
const page = tpl.replace('/*__ENGINE__*/', () => engine);
mkdirSync(new URL('../apps/desk/', import.meta.url), { recursive: true });
writeFileSync(new URL('../apps/desk/desk.html', import.meta.url), page.replace('/*__DATA__*/null', () => JSON.stringify(data)));
mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/desk.html', import.meta.url),
  `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}\n</body>\n</html>\n`);
console.log(`desk: asOf ${data.asOf}, market ${data.market?.state ?? 'n/a'}, desk ${data.desk?.model ?? 'none'}, ict4h ${data.ict4h?.signals?.length ?? 0} signals, bars ${data.real ? Object.keys(data.real.bars).length : 0}`);
