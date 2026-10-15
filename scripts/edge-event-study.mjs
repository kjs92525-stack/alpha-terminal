#!/usr/bin/env node
// Event study of insider clusters and offering/shelf filings (DESIGN P4).
// Usage: node scripts/edge-event-study.mjs --bars .backtest-cache/bars --cache .edge-cache --out data-branch [--limit 2400]
// Env: FINNHUB_API_KEY. Two Finnhub calls per symbol (cached across runs), 1.1 s apart.
import fs from 'node:fs';
import path from 'node:path';
import { makeFinnhubClient } from '../packages/pipeline/finnhub.mjs';
import { loadBarsDir, summarize } from '../packages/pipeline/backtest.mjs';
import { insiderEvents, filingEvents, edgeEventGroups } from '../packages/pipeline/edge-events.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const barsDir = arg('bars', '.backtest-cache/bars'), cacheDir = arg('cache', '.edge-cache'), outDir = arg('out', 'data-branch');
const limit = Number(arg('limit', 2400)), from = arg('from', '2022-01-01');
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const all = loadBarsDir(barsDir);
const spy = all.SPY;
if (!spy) throw new Error(`no SPY bars in ${barsDir} — run the Breakout backtest first`);
const spyByTime = new Map(spy.map((b) => [b.time, b]));
// small/mid caps with ~3 years of filings in the nightly snapshot, most history first
const companiesDir = path.join(outDir, 'companies');
const facts = {};
for (const f of fs.existsSync(companiesDir) ? fs.readdirSync(companiesDir) : []) {
  try { const c = JSON.parse(fs.readFileSync(path.join(companiesDir, f), 'utf8')); const sym = c.symbol ?? f.replace(/\.json$/, ''); if (c?.facts?.revenueQuarterly?.length >= 8 && all[sym]?.length >= 400) facts[sym] = c.facts; } catch { /* skip */ }
}
const symbols = Object.keys(facts).sort().slice(0, limit);
log(`${symbols.length} symbols with filings history and bars`);
fs.mkdirSync(cacheDir, { recursive: true });
const client = makeFinnhubClient({ apiKey: process.env.FINNHUB_API_KEY });
const to = new Date().toISOString().slice(0, 10);
const cached = async (sym, kind, url) => {
  const file = path.join(cacheDir, `${sym.replace(/[^A-Z0-9.\-]/gi, '_')}.${kind}.json`);
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * 86400000) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const j = await client.json(url);
  fs.writeFileSync(file, JSON.stringify(j));
  return j;
};
const events = [];
let errors = 0, insiderRows = 0, filingRows = 0;
for (const [i, sym] of symbols.entries()) {
  try {
    const ins = await cached(sym, 'insider', `/stock/insider-transactions?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}`);
    const fil = await cached(sym, 'filings', `/stock/filings?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}`);
    const rows = Array.isArray(ins?.data) ? ins.data : [], filings = Array.isArray(fil) ? fil.map((f) => ({ form: f.form, filingDate: f.filedDate })) : [];
    insiderRows += rows.length; filingRows += filings.length;
    for (const e of [...insiderEvents(all[sym], rows, spyByTime, facts[sym]), ...filingEvents(all[sym], filings, spyByTime, facts[sym])]) events.push({ symbol: sym, ...e });
  } catch (e) {
    errors++;
    if (e.fatal) throw e;
  }
  if ((i + 1) % 200 === 0) log(`${i + 1}/${symbols.length} · events ${events.length} · errors ${errors}`);
}
const groups = edgeEventGroups(events);
const report = Object.fromEntries(Object.entries(groups).map(([g, ts]) => [g, Object.fromEntries([20, 60, 120].map((h) => [`${h}d`, summarize(ts, h)]))]));
const firstDate = events.map((e) => e.date).sort()[0] ?? null;
const out = {
  generatedAt: new Date().toISOString(),
  method: '내부자 매수 묶음(Form 4 제출일 기준 30일 내 2명 이상 $10만 이상 또는 $25만 이상, 회사·펀드 매수 제외)·증자 설명서(424B1/3/4/5)·증권 등록(S-3/S-1/F-3/F-1)이 공개된 다음 거래일 시가 매수 → h거래일 후 종가, 손절 없음, SPY 대비. 같은 종류는 종목당 60일에 1번. 매출 가속 여부는 그날까지 공시된 분기만으로 판정.',
  limits: ['Finnhub 무료 자료의 이력 깊이가 종목마다 다름', '현재 상장 종목만 사용(생존 편향)', '사건 당시 시가총액을 몰라 대형주 채권 발행 설명서를 구분하지 못함', '수수료·슬리피지 미반영'],
  symbols: symbols.length, errors, insiderRows, filingRows, firstEventDate: firstDate, events: events.length,
  report,
  recent: events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40).map((e) => ({ symbol: e.symbol, kind: e.kind, date: e.date, buyers: e.buyers ?? null, r60: e.results[60]?.ret ?? null, spy60: e.results[60]?.spy ?? null })),
};
fs.mkdirSync(path.join(outDir, 'backtest'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'backtest', 'edge-events.json'), JSON.stringify(out, null, 1));
log(`done: ${events.length} events, ${errors} errors, ${client.calls} calls`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([g, r]) => [g, { n: r['120d'].n, xs60: r['60d'].avgExcessVsSpy, xs120: r['120d'].avgExcessVsSpy }])), null, 1));
