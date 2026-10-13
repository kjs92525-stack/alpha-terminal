// Nightly pipeline: universe -> bars -> SEC refresh -> features -> rankings -> ledger -> performance.
// All IO goes through `fetchImpl` and the filesystem dirs, so it runs identically in
// GitHub Actions and in tests with a mocked fetch.

import fs from 'node:fs';
import path from 'node:path';
import { isDailyBarClosed } from '../analysis/market.mjs';
import { parseExchangeTickers, buildUniverse, sicToSector, fromVendorSymbol } from './universe.mjs';
import { fetchDailyBars, mergeBars, fetchNews } from './alpaca.mjs';
import { detectSetup, evaluateChart, SETUP_RULES } from '../analysis/setups.mjs';
import { storySignals } from '../analysis/story.mjs';
import { classifyHeadline } from '../analysis/news.mjs';
import { throttle } from './http.mjs';
import { makeSecClient, refreshCompanies, dailyIndexUrl, parseDailyIndex, businessDaysBetween } from './secdata.mjs';
import { computeFeatures } from './features.mjs';
import { rankHorizon, selectRecommendations, exclusionReasons, MODEL_VERSION, MID_FACTORS, SHORT_FACTORS, REC_FILTERS } from './ranking.mjs';
import { makeLedger, evaluateLedgers } from './ledger.mjs';

const BENCH = 'SPY';
const r4 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v ?? null);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, pretty ? 1 : 0));
}

const packBars = (bars) => bars.map((b) => [b.time, r4(b.open), r4(b.high), r4(b.low), r4(b.close), Math.round(b.volume)]);
const unpackBars = (arr) => (arr || []).map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
const safeName = (s) => s.replace(/[^A-Z0-9.\-]/gi, '_');

export async function runNightly({
  env, cacheDir, outDir, fetchImpl = fetch, now = Date.now(), historyDays = 800, limit = 0,
  log = () => {}, wait,
}) {
  const t0 = Date.now();
  const stats = { startedAt: new Date(now).toISOString() };
  const state = readJson(path.join(cacheDir, 'state.json'), {});
  const sec = makeSecClient({ userAgent: env.SEC_USER_AGENT, fetchImpl, wait });

  // 1. universe
  const tickers = await sec.json('https://www.sec.gov/files/company_tickers_exchange.json');
  let universe = buildUniverse(parseExchangeTickers(tickers));
  if (limit > 0) universe = universe.slice(0, limit);
  stats.universe = universe.length;
  log(`universe: ${universe.length}`);

  // 2. bars (incremental, split-safe)
  const barsDir = path.join(cacheDir, 'bars');
  const symbols = [...new Set([BENCH, ...universe.map((u) => u.symbol)])];
  const cached = new Map(symbols.map((s) => [s, unpackBars(readJson(path.join(barsDir, `${safeName(s)}.json`), null))]));
  const end = new Date(now - 20 * 60000).toISOString();
  const fullStart = new Date(now - historyDays * 86400000).toISOString().slice(0, 10);
  const fresh = symbols.filter((s) => !cached.get(s).length);
  const known = symbols.filter((s) => cached.get(s).length);
  const lastTimes = known.map((s) => cached.get(s).at(-1).time);
  const incStart = lastTimes.length ? new Date((Math.min(...lastTimes) - 10 * 86400) * 1000).toISOString().slice(0, 10) : fullStart;
  const alpaca = { keyId: env.ALPACA_KEY_ID, secretKey: env.ALPACA_SECRET_KEY, fetchImpl, wait, feed: env.ALPACA_FEED || 'sip' };
  let requests = 0;
  const needFull = [...fresh];
  if (known.length) {
    const r = await fetchDailyBars({ ...alpaca, symbols: known, start: incStart, end, onBatch: (d, t) => log(`bars inc ${d}/${t}`) });
    requests += r.requests;
    for (const s of known) {
      const m = mergeBars(cached.get(s), r.bars[s] ?? []);
      if (m.needsFull) needFull.push(s); else cached.set(s, m.bars);
    }
  }
  if (needFull.length) {
    const r = await fetchDailyBars({ ...alpaca, symbols: needFull, start: fullStart, end, onBatch: (d, t) => log(`bars full ${d}/${t}`) });
    requests += r.requests;
    for (const s of needFull) cached.set(s, r.bars[s] ?? []);
  }
  const minTime = Date.parse(fullStart) / 1000;
  for (const [s, bars] of cached) {
    const trimmed = bars.filter((b) => b.time >= minTime);
    cached.set(s, trimmed);
    if (trimmed.length) writeJson(path.join(barsDir, `${safeName(s)}.json`), packBars(trimmed));
  }
  stats.alpacaRequests = requests;
  stats.fullFetches = needFull.length;

  // 3. as-of date = last CLOSED SPY session
  const spy = cached.get(BENCH);
  if (!spy?.length) throw new Error('No SPY bars — cannot determine the as-of session');
  const closed = spy.filter((b) => isDailyBarClosed(b.time, now));
  const asOf = new Date(closed.at(-1).time * 1000).toISOString().slice(0, 10);
  stats.asOf = asOf;
  log(`asOf ${asOf}`);

  // 4. SEC refresh (changed filers from daily indices since last run)
  const changed = new Set();
  const lastIndex = state.lastIndexDate ?? new Date(Date.parse(asOf) - 3 * 86400000).toISOString().slice(0, 10);
  for (const day of businessDaysBetween(lastIndex, asOf)) {
    const txt = await sec.text(dailyIndexUrl(day));
    if (txt) for (const row of parseDailyIndex(txt)) changed.add(row.cik);
  }
  const compDir = path.join(cacheDir, 'companies');
  const compCache = new Map();
  const cache = {
    get: (cik) => { if (!compCache.has(cik)) compCache.set(cik, readJson(path.join(compDir, `${cik}.json`), null)); return compCache.get(cik); },
    set: (cik, rec) => { compCache.set(cik, rec); writeJson(path.join(compDir, `${cik}.json`), rec); },
  };
  const ciks = [...new Set(universe.map((u) => u.cik))];
  const sr = await refreshCompanies({ ciks, cache, client: sec, changed, now, maxRefresh: Number(env.SEC_MAX_REFRESH || 6000), onProgress: (d, t) => { if (d % 250 === 0 || d === t) log(`sec ${d}/${t}`); } });
  stats.sec = { ...sr, errors: sr.errors.slice(0, 20), changedFilers: changed.size, requests: sec.requests };

  // 4b. publish SEC data for the API (SEC refuses requests from Cloudflare Workers; the API
  //     falls back to these files). Company files are only rewritten when their content changes.
  const allListed = buildUniverse(parseExchangeTickers(tickers));
  writeJson(path.join(outDir, 'sec', 'tickers.json'), { generatedAt: new Date(now).toISOString(), source: 'SEC company_tickers_exchange.json', rows: Object.fromEntries(allListed.map((u) => [u.ticker, [u.cik, u.name]])) });
  let companyFilesWritten = 0;
  const recent = [];
  const recentCutoff = Date.parse(asOf) - 5 * 86400000;
  for (const u of universe) {
    const rec = cache.get(u.cik);
    if (!rec) continue;
    const body = { symbol: u.ticker, cik: u.cik, name: rec.name ?? u.name, sic: rec.sic ?? null, sicDescription: rec.sicDescription ?? null, fetchedAt: rec.fetchedAt, filings: (rec.filings ?? []).slice(0, 40), facts: rec.facts ?? null };
    const file = path.join(outDir, 'companies', `${u.ticker}.json`);
    const next = JSON.stringify(body);
    let prev = null;
    try { prev = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
    const strip = (txt) => txt && txt.replace(/"fetchedAt":"[^"]*",/, '');
    if (strip(prev) !== strip(next)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, next); companyFilesWritten++; }
    for (const f of rec.filings ?? []) {
      if (f.filingDate && Date.parse(f.filingDate) >= recentCutoff && f.category !== 'INSIDER' && f.category !== 'EXHIBIT') recent.push({ ...f, company: rec.name ?? u.name, cik: u.cik, ticker: u.ticker });
    }
  }
  recent.sort((x, y) => String(y.acceptedAt ?? y.filingDate).localeCompare(String(x.acceptedAt ?? x.filingDate)));
  writeJson(path.join(outDir, 'sec', 'recent-filings.json'), { generatedAt: new Date(now).toISOString(), note: '야간 배치 수집본 — 실시간 아님', items: recent.slice(0, 300) });
  stats.secPublished = { companyFilesWritten, recentFilings: recent.length };

  // 5. features
  const staleCutoff = Date.parse(asOf) - 7 * 86400000;
  const rows = [];
  for (const u of universe) {
    const bars = cached.get(u.symbol);
    if (!bars?.length) continue;
    const company = cache.get(u.cik);
    const features = computeFeatures(bars, company, asOf);
    if (!features || Date.parse(features.lastDate) < staleCutoff) continue;
    rows.push({ symbol: u.symbol, ticker: fromVendorSymbol(u.symbol), cik: u.cik, name: company?.name ?? u.name, exchange: u.exchange, sector: sicToSector(company?.sic), features });
  }
  stats.withFeatures = rows.length;

  // 6. rank
  const mid = rankHorizon(rows, 'mid');
  const short = rankHorizon(rows, 'short');
  stats.ranked = { mid: mid.length, short: short.length };
  const recs = { mid: selectRecommendations(mid, 'mid'), short: selectRecommendations(short, 'short') };

  // 6b. base-breakout scanner (primary product): chart setup on every liquid stock,
  //     story signals (fundamentals + news) only for the candidates.
  const asOfSec = Date.parse(`${asOf}T00:00:00Z`) / 1000;
  const spyAsOf = spy.filter((b) => b.time <= asOfSec);
  const ACTIONABLE = new Set(['BREAKOUT', 'POST_BREAKOUT', 'NEAR_PIVOT']);
  const pre = [];
  for (const r of rows) {
    if (r.features.price < 3 || (r.features.adv20 ?? 0) < 2e6 || r.sector === 'Blank Check') continue;
    const bars = (cached.get(r.symbol) ?? []).filter((b) => b.time <= asOfSec);
    if (bars.length < 260) continue;
    const quick = detectSetup(bars);
    if (!ACTIONABLE.has(quick.stage)) continue;
    pre.push({ r, bars, chart: evaluateChart(bars, spyAsOf) });
  }
  pre.sort((a, b) => b.chart.chartScore - a.chart.chartScore);
  const maxStory = Number(env.SETUP_NEWS_MAX || 150);
  const newsGate = throttle(320);
  const newsStart = new Date(Date.parse(asOf) - 60 * 86400000).toISOString();
  let newsRequests = 0;
  const setups = [];
  for (let i = 0; i < pre.length; i++) {
    const { r, chart } = pre[i];
    let news = [];
    if (i < maxStory) {
      try {
        await newsGate();
        news = (await fetchNews({ symbol: r.symbol, start: newsStart, keyId: env.ALPACA_KEY_ID, secretKey: env.ALPACA_SECRET_KEY, fetchImpl, wait }))
          .filter((n) => Date.parse(n.time) <= asOfSec * 1000 + 86400000)
          .map((n) => ({ ...n, ...classifyHeadline(n.headline) }));
        newsRequests++;
      } catch { /* news is optional evidence */ }
    }
    const company = cache.get(r.cik);
    const story = storySignals({ fundamentals: company?.facts ?? null, filings: company?.filings ?? [], news, asOf });
    const score = Math.round(chart.chartScore * 0.55 + story.storyScore * 0.45);
    setups.push({
      symbol: r.symbol, name: r.name, sector: r.sector, price: r4(r.features.price), mcap: r.features.mcap ? Math.round(r.features.mcap) : null, adv20: r.features.adv20 ? Math.round(r.features.adv20) : null,
      stage: chart.setup.stage, pivot: r4(chart.setup.pivot), distanceToPivot: r4(chart.setup.distanceToPivot ?? null), extension: r4(chart.setup.extension ?? null),
      barsSinceBreakout: chart.setup.barsSinceBreakout ?? null, breakoutVolMult: r4(chart.setup.breakoutVolMult ?? null),
      base: chart.setup.base ? { months: Math.round(chart.setup.base.window / 21), depth: r4(chart.setup.base.depth), high: r4(chart.setup.base.high), low: r4(chart.setup.base.low), higherLows: chart.setup.base.higherLows, contraction: chart.setup.base.contraction, volumeDryUp: chart.setup.base.volumeDryUp } : null,
      trend: { passed: chart.trend.passed, total: chart.trend.total }, rs: { newHigh: chart.rs.rsNewHigh, rs3m: r4(chart.rs.rs3m), rs12m: r4(chart.rs.rs12m) },
      plan: chart.plan ? { entry: r4(chart.plan.entry), stop: r4(chart.plan.stop), stopKind: chart.plan.stopKind, target: r4(chart.plan.target), riskPct: r4(chart.plan.riskPct), rMultiple: r4(chart.plan.rMultiple), note: chart.plan.note } : null,
      chartScore: chart.chartScore, storyScore: story.storyScore, score,
      reasons: story.reasons, themes: story.themes, revenueYoY: story.revenueYoY.map((q) => ({ end: q.end, yoy: r4(q.yoy) })),
      news: news.slice(0, 5).map((n) => ({ time: n.time, headline: n.headline, url: n.url, sentiment: n.sentiment, tags: n.tags })),
      newsChecked: i < maxStory,
    });
  }
  setups.sort((a, b) => b.score - a.score);
  stats.setups = { scanned: rows.length, candidates: setups.length, newsRequests, byStage: setups.reduce((m, x) => ((m[x.stage] = (m[x.stage] ?? 0) + 1), m), {}) };
  writeJson(path.join(outDir, 'setups.json'), {
    asOf, generatedAt: new Date().toISOString(), model: 'base-breakout-v1', rules: SETUP_RULES,
    weights: { chart: 0.55, story: 0.45 },
    method: '차트: 6–18개월 바닥(깊이 12–50%, 저점 상승·변동성 수축·거래량 감소) 상단을 평균 거래량 1.4배 이상으로 돌파 + 추세 템플릿 + 시장 대비 강도. 스토리: SEC 분기 매출 가속·흑자 전환·뉴스 관심·테마·의심받는 성장, 희석·런웨이·위험 공시 감점.',
    caveat: '돌파는 실패가 더 흔합니다. 손절가를 지키는 것을 전제로 한 후보 목록이며 투자 자문이 아닙니다.',
    stats: stats.setups,
    candidates: setups.slice(0, 200),
  });
  recs.setups = setups.filter((x) => (x.stage === 'BREAKOUT' || x.stage === 'POST_BREAKOUT') && x.plan && x.plan.riskPct <= 0.15).slice(0, 20)
    .map((x) => ({ rank: 0, symbol: x.symbol, name: x.name, sector: x.sector, score: x.score, factors: { chart: x.chartScore, story: x.storyScore }, features: { price: x.price } }));
  recs.setups.forEach((x, i) => { x.rank = i + 1; });

  const detail = (r) => ({
    rank: r.rank, percentile: r.percentile, symbol: r.symbol, name: r.name, sector: r.sector, score: r.score, coverage: r.coverage, factors: r.factors,
    price: r4(r.features.price), mcap: r.features.mcap ? Math.round(r.features.mcap) : null, adv20: r.features.adv20 ? Math.round(r.features.adv20) : null,
    f: Object.fromEntries(Object.entries(r.features).filter(([k]) => !['lastDate', 'bars', 'price', 'mcap', 'adv20'].includes(k)).map(([k, v]) => [k, Array.isArray(v) ? v : r4(v)])),
    excluded: exclusionReasons(r, r.horizon),
  });
  const sources = {
    prices: `Alpaca Market Data v2 (${env.ALPACA_FEED || 'sip'}, adjustment=all, daily)`,
    filings: 'SEC EDGAR submissions + daily form index',
    fundamentals: 'SEC XBRL companyfacts (latest annual)',
  };
  const latest = {
    asOf, model: MODEL_VERSION, generatedAt: new Date().toISOString(), universe: universe.length, ranked: stats.ranked, sources,
    weights: { mid: Object.fromEntries(Object.entries(MID_FACTORS).map(([k, v]) => [k, v.weight])), short: Object.fromEntries(Object.entries(SHORT_FACTORS).map(([k, v]) => [k, v.weight])) },
    filters: REC_FILTERS,
    recommendations: { mid: recs.mid.map((r) => r.symbol), short: recs.short.map((r) => r.symbol) },
    mid: mid.slice(0, 300).map(detail),
    short: short.slice(0, 300).map(detail),
  };
  writeJson(path.join(outDir, 'latest.json'), latest);
  const midBy = new Map(mid.map((r) => [r.symbol, r]));
  const shortBy = new Map(short.map((r) => [r.symbol, r]));
  writeJson(path.join(outDir, 'rankings', `${asOf}.json`), {
    asOf, model: MODEL_VERSION,
    rows: rows.map((r) => {
      const m = midBy.get(r.symbol);
      const s = shortBy.get(r.symbol);
      return [r.symbol, r.sector, r4(r.features.price), m?.score ?? null, m?.rank ?? null, s?.score ?? null, s?.rank ?? null];
    }),
    columns: ['symbol', 'sector', 'price', 'midScore', 'midRank', 'shortScore', 'shortRank'],
  });

  // 7. ledger — immutable: never overwrite an existing day
  const ledgerFile = path.join(outDir, 'ledger', `${asOf}.json`);
  stats.ledgerWritten = false;
  if (!fs.existsSync(ledgerFile)) {
    writeJson(ledgerFile, makeLedger(asOf, MODEL_VERSION, recs), true);
    stats.ledgerWritten = true;
  }

  // 8. performance of all ledgers
  const ledgerDir = path.join(outDir, 'ledger');
  const ledgerDates = fs.readdirSync(ledgerDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
  writeJson(path.join(ledgerDir, 'index.json'), { dates: ledgerDates, model: MODEL_VERSION });
  const ledgers = fs.readdirSync(ledgerDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().map((f) => readJson(path.join(ledgerDir, f), null)).filter(Boolean);
  const perf = evaluateLedgers(ledgers, (s) => cached.get(s) ?? unpackBars(readJson(path.join(barsDir, `${safeName(s)}.json`), null)), spy);
  writeJson(path.join(outDir, 'performance.json'), { ...perf, ledgers: ledgers.length, benchmark: BENCH });

  state.lastIndexDate = asOf;
  state.lastRun = new Date().toISOString();
  writeJson(path.join(cacheDir, 'state.json'), state, true);
  stats.seconds = Math.round((Date.now() - t0) / 1000);
  writeJson(path.join(outDir, 'meta.json'), stats, true);
  return { asOf, stats, latest };
}
