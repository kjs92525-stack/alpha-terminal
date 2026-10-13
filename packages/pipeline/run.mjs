// Nightly pipeline: universe -> bars -> SEC refresh -> features -> rankings -> ledger -> performance.
// All IO goes through `fetchImpl` and the filesystem dirs, so it runs identically in
// GitHub Actions and in tests with a mocked fetch.

import fs from 'node:fs';
import path from 'node:path';
import { isDailyBarClosed } from '../analysis/market.mjs';
import { parseExchangeTickers, buildUniverse, sicToSector, fromVendorSymbol } from './universe.mjs';
import { fetchDailyBars, mergeBars, fetchNews, fetchAssets } from './alpaca.mjs';
import { buildNameIndex, normalizeCompanyName, framePeriods, frameUrl } from './cikmap.mjs';
import { makeFinnhubClient, fetchCompany, withFacts } from './finnhub.mjs';
import { detectSetup, evaluateChart, SETUP_RULES } from '../analysis/setups.mjs';
import { storySignals } from '../analysis/story.mjs';
import { detectPullback, detectHtfBottom, mergeMonthly, PULLBACK_RULES, BOTTOM_RULES } from '../analysis/zones.mjs';
import { resampleWeekly } from '../analysis/indicators.mjs';
import { classifyHeadline } from '../analysis/news.mjs';
import { throttle } from './http.mjs';
import { makeSecClient, normalizeUserAgent, refreshCompanies, dailyIndexUrl, parseDailyIndex, businessDaysBetween } from './secdata.mjs';
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
  const uaCheck = normalizeUserAgent(env.SEC_USER_AGENT);
  stats.secUserAgentIssues = uaCheck.issues;
  for (const i of uaCheck.issues) log(`SEC_USER_AGENT: ${i}`);
  const sec = makeSecClient({ userAgent: uaCheck.ua, fetchImpl, wait });

  // 1. universe — SEC list (has CIKs for filings/fundamentals). If SEC refuses this runner
  //    (it blocks some cloud IP ranges), use the last good SEC list, else Alpaca's asset list,
  //    and skip SEC refresh for this run: price-based scans still run.
  const tickerCacheFile = path.join(cacheDir, 'sec-tickers.json');
  let tickers = null;
  let secOk = true;
  try {
    tickers = await sec.json('https://www.sec.gov/files/company_tickers_exchange.json');
    if (tickers) writeJson(tickerCacheFile, tickers);
    stats.universeSource = 'sec';
  } catch (e) {
    secOk = false;
    stats.secError = String(e.message ?? e).slice(0, 200);
    log(`SEC unavailable (${stats.secError}) — falling back`);
    tickers = readJson(tickerCacheFile, null);
    stats.universeSource = tickers ? 'sec-cache' : 'alpaca-assets';
  }
  const listed = tickers ? parseExchangeTickers(tickers) : await fetchAssets({ keyId: env.ALPACA_KEY_ID, secretKey: env.ALPACA_SECRET_KEY, fetchImpl, wait });
  let universe = buildUniverse(listed);
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

  // 2b. long monthly history (for 월봉 바닥). Completed months rarely change, so refetch weekly;
  //     the recent months are always rebuilt from the daily bars (mergeMonthly).
  const monthlyDir = path.join(cacheDir, 'monthly');
  const monthlyStale = !state.monthlyFetchedAt || now - Date.parse(state.monthlyFetchedAt) > 6 * 86400000;
  const monthly = new Map();
  const needMonthly = [];
  for (const s of symbols) {
    const m = unpackBars(readJson(path.join(monthlyDir, `${safeName(s)}.json`), null));
    monthly.set(s, m);
    if (monthlyStale || !m.length) needMonthly.push(s);
  }
  stats.monthlyFetched = 0;
  if (needMonthly.length && env.SKIP_MONTHLY !== '1') {
    try {
      const r = await fetchDailyBars({ ...alpaca, timeframe: '1Month', symbols: needMonthly, start: env.MONTHLY_START || '2012-01-01', end, onBatch: (d, t) => log(`monthly ${d}/${t}`) });
      for (const s of needMonthly) if (r.bars[s]?.length) { monthly.set(s, r.bars[s]); writeJson(path.join(monthlyDir, `${safeName(s)}.json`), packBars(r.bars[s])); }
      stats.monthlyFetched = needMonthly.length;
      stats.alpacaRequests += r.requests;
      if (monthlyStale) state.monthlyFetchedAt = new Date(now).toISOString();
    } catch (e) {
      stats.monthlyError = String(e.message ?? e).slice(0, 200); // monthly is optional: weekly/daily scans still run
    }
  }

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
  for (const day of secOk ? businessDaysBetween(lastIndex, asOf) : []) {
    const txt = await sec.text(dailyIndexUrl(day));
    if (txt) for (const row of parseDailyIndex(txt)) changed.add(row.cik);
  }
  const compDir = path.join(cacheDir, 'companies');
  const compCache = new Map();
  const cache = {
    get: (cik) => { if (!compCache.has(cik)) compCache.set(cik, readJson(path.join(compDir, `${cik}.json`), null)); return compCache.get(cik); },
    set: (cik, rec) => { compCache.set(cik, rec); writeJson(path.join(compDir, `${cik}.json`), rec); },
  };
  // 4a. www.sec.gov refused: data.sec.gov (filings + XBRL) is a separate host — probe it, and
  //     if it answers, map tickers to CIKs by company name (confirmed below via submissions).
  let secDataOk = secOk;
  const cikMapFile = path.join(cacheDir, 'sec-cikmap.json');
  const cikMap = readJson(cikMapFile, {});
  let tentative = new Set();
  if (!secOk) {
    try {
      secDataOk = !!(await sec.json('https://data.sec.gov/submissions/CIK0000320193.json'));
    } catch (e) {
      secDataOk = false;
      stats.secDataError = String(e.message ?? e).slice(0, 200);
    }
    log(`data.sec.gov ${secDataOk ? 'reachable' : `blocked (${stats.secDataError})`}`);
    if (secDataOk) {
      for (const u of universe) if (!u.cik && cikMap[u.ticker]) u.cik = cikMap[u.ticker];
      const missing = universe.filter((u) => !u.cik);
      if (missing.length) {
        const frames = [];
        for (const p of framePeriods(asOf)) {
          try { const fr = await sec.json(frameUrl(p)); if (fr) frames.push(fr); } catch (e) { log(`frames ${p}: ${e.message}`); }
        }
        const idx = buildNameIndex(frames);
        for (const u of missing) {
          const cik = idx.get(normalizeCompanyName(u.name));
          if (cik) { u.cik = cik; tentative.add(u.ticker); }
        }
      }
      stats.cikMap = { cached: universe.filter((u) => u.cik && !tentative.has(u.ticker)).length, matchedByName: tentative.size, unmatched: universe.filter((u) => !u.cik).length };
    }
  }

  const ciks = [...new Set(universe.map((u) => u.cik).filter(Boolean))];
  if (secDataOk) {
    const sr = await refreshCompanies({ ciks, cache, client: sec, changed, now, maxRefresh: Number(env.SEC_MAX_REFRESH || 6000), onProgress: (d, t) => { if (d % 250 === 0 || d === t) log(`sec ${d}/${t}`); } });
    stats.sec = { ...sr, errors: sr.errors.slice(0, 20), changedFilers: changed.size, requests: sec.requests };
    if (!secOk) {
      // keep a name match only when SEC's own ticker list for that CIK confirms it
      let rejected = 0;
      for (const u of universe) {
        if (!u.cik) continue;
        const rec = cache.get(u.cik);
        const ok = rec?.tickers ? rec.tickers.map((t) => String(t).toUpperCase()).includes(u.ticker) : !tentative.has(u.ticker);
        if (ok) cikMap[u.ticker] = u.cik;
        else { if (tentative.has(u.ticker)) rejected++; delete cikMap[u.ticker]; u.cik = null; }
      }
      writeJson(cikMapFile, cikMap);
      stats.cikMap.rejected = rejected;
      stats.cikMap.confirmed = universe.filter((u) => u.cik).length;
    }
  } else {
    stats.sec = { skipped: true, reason: stats.secDataError ?? stats.secError, requests: sec.requests };
  }

  // 4c. Finnhub fundamentals for companies without SEC data (SEC refuses cloud runners).
  //     Free plan = 60 calls/min, 2 calls per company: most liquid missing companies first,
  //     then the stalest (quarterly numbers change about every 90 days). Cached per symbol.
  const fhDir = path.join(cacheDir, 'finnhub');
  const fhRec = new Map();
  const secFacts = (u) => (u.cik ? cache.get(u.cik)?.facts : null);
  // facts are recomputed from cached compact filings every run; records in an older format are refetched
  for (const u of universe) { const r = withFacts(readJson(path.join(fhDir, `${safeName(u.symbol)}.json`), null)); if (r) fhRec.set(u.symbol, r); }
  if (env.FINNHUB_API_KEY) {
    const fh = makeFinnhubClient({ apiKey: env.FINNHUB_API_KEY, fetchImpl, wait });
    const maxCompanies = Math.floor(Number(env.FINNHUB_MAX_CALLS || 1500) / 2);
    const adv = (s) => { const b = (cached.get(s) ?? []).slice(-20); return b.length ? b.reduce((a, x) => a + x.close * x.volume, 0) / b.length : 0; };
    const need = universe.filter((u) => !secFacts(u));
    const missing = need.filter((u) => !fhRec.has(u.symbol)).sort((a, b) => adv(b.symbol) - adv(a.symbol));
    const stale = need.filter((u) => fhRec.has(u.symbol) && now - Date.parse(fhRec.get(u.symbol).fetchedAt) > 45 * 86400000)
      .sort((a, b) => fhRec.get(a.symbol).fetchedAt.localeCompare(fhRec.get(b.symbol).fetchedAt));
    const todo = [...missing, ...stale].slice(0, maxCompanies);
    const fstats = { needed: need.length, cached: fhRec.size, attempted: todo.length, fetched: 0, withRevenue: 0, errors: [] };
    for (let i = 0; i < todo.length; i++) {
      const u = todo[i];
      try {
        const raw = await fetchCompany(fh, u.symbol, now);
        writeJson(path.join(fhDir, `${safeName(u.symbol)}.json`), raw);
        const rec = withFacts(raw);
        fhRec.set(u.symbol, rec);
        fstats.fetched++;
        if (rec.facts?.revenueQuarterly?.length) fstats.withRevenue++;
      } catch (e) {
        fstats.errors.push(`${u.symbol}: ${e.message}`);
        if (e.fatal || fstats.errors.length >= 25) { fstats.aborted = e.message; break; }
      }
      if ((i + 1) % 50 === 0 || i + 1 === todo.length) log(`finnhub ${i + 1}/${todo.length}`);
    }
    fstats.errors = fstats.errors.slice(0, 10);
    fstats.calls = fh.calls;
    stats.finnhub = fstats;
  }
  /** Company record for features/story: SEC when it has facts, else Finnhub. */
  const companyFor = (u) => {
    const secRec = u.cik ? cache.get(u.cik) : null;
    if (secRec?.facts) return secRec;
    const f = fhRec.get(u.symbol);
    return f ? { ...f, filings: secRec?.filings ?? [], sic: secRec?.sic ?? null } : secRec;
  };

  // 4b. publish SEC data for the API (SEC refuses requests from Cloudflare Workers; the API
  //     falls back to these files). Company files are only rewritten when their content changes.
  const allListed = secOk ? buildUniverse(listed) : universe.filter((u) => u.cik);
  if (allListed.length) writeJson(path.join(outDir, 'sec', 'tickers.json'), { generatedAt: new Date(now).toISOString(), source: 'SEC company_tickers_exchange.json', rows: Object.fromEntries(allListed.map((u) => [u.ticker, [u.cik, u.name]])) });
  let companyFilesWritten = 0;
  const recent = [];
  const recentCutoff = Date.parse(asOf) - 5 * 86400000;
  for (const u of universe) {
    const rec = companyFor(u);
    if (!rec) continue;
    const body = { symbol: u.ticker, cik: u.cik ?? rec.cik ?? null, name: rec.name ?? u.name, sic: rec.sic ?? null, sicDescription: rec.sicDescription ?? rec.industry ?? null, source: rec.source ?? 'SEC', fetchedAt: rec.fetchedAt, filings: (rec.filings ?? []).slice(0, 40), facts: rec.facts ?? null };
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
  const companyBy = new Map();
  for (const u of universe) {
    const bars = cached.get(u.symbol);
    if (!bars?.length) continue;
    const company = companyFor(u);
    const features = computeFeatures(bars, company, asOf);
    if (!features || Date.parse(features.lastDate) < staleCutoff) continue;
    if (features.mcap === null && company?.marketCap) features.mcap = company.marketCap;
    companyBy.set(u.symbol, company);
    rows.push({ symbol: u.symbol, ticker: fromVendorSymbol(u.symbol), cik: u.cik, name: company?.name ?? u.name, exchange: u.exchange, sector: company?.sic ? sicToSector(company.sic) : company?.sector ?? 'Unknown', features });
  }
  stats.withFeatures = rows.length;

  // 6. rank
  const mid = rankHorizon(rows, 'mid');
  const short = rankHorizon(rows, 'short');
  stats.ranked = { mid: mid.length, short: short.length };
  const recs = { mid: selectRecommendations(mid, 'mid'), short: selectRecommendations(short, 'short') };

  // 6b. setup scanner (primary product). Four chart setups, each with a buy point:
  //     breakout (바닥 돌파), pullback (눌림목), weekly bottom (주봉 바닥), monthly bottom (월봉 바닥).
  //     Story signals (fundamentals + news) are added for the best candidates.
  const asOfSec = Date.parse(`${asOf}T00:00:00Z`) / 1000;
  const spyAsOf = spy.filter((b) => b.time <= asOfSec);
  const ACTIONABLE = new Set(['BREAKOUT', 'POST_BREAKOUT', 'NEAR_PIVOT']);
  const items = [];
  const planOut = (p) => (p ? {
    entry: r4(p.entry), stop: r4(p.stop), stopKind: p.stopKind, target: r4(p.target), target2: r4(p.target2 ?? null), zone: p.zone ? p.zone.map(r4) : null,
    entryType: p.entryType ?? null, how: p.how ?? null, riskPct: r4(p.riskPct), rMultiple: r4(p.rMultiple), note: p.note ?? null,
  } : null);
  for (const r of rows) {
    if (r.features.price < 3 || (r.features.adv20 ?? 0) < 2e6 || r.sector === 'Blank Check') continue;
    const bars = (cached.get(r.symbol) ?? []).filter((b) => b.time <= asOfSec);
    if (bars.length < 220) continue;
    const htf = { weekly: resampleWeekly(bars), monthly: mergeMonthly((monthly.get(r.symbol) ?? []).filter((b) => b.time <= asOfSec), bars) };
    if (bars.length >= 260) {
      const quick = detectSetup(bars, SETUP_RULES, htf.monthly);
      if (ACTIONABLE.has(quick.stage)) {
        const chart = evaluateChart(bars, spyAsOf, htf.monthly);
        const st = chart.setup;
        items.push({ type: 'breakout', r, stage: st.stage, setupScore: chart.chartScore, plan: planOut(chart.plan), detail: {
          pivot: r4(st.pivot), distanceToPivot: r4(st.distanceToPivot ?? null), extension: r4(st.extension ?? null),
          barsSinceBreakout: st.barsSinceBreakout ?? null, breakoutVolMult: r4(st.breakoutVolMult ?? null),
          base: st.base ? { months: Math.round(st.base.window / 21), depth: r4(st.base.depth), high: r4(st.base.high), low: r4(st.base.low), priorPeak: r4(st.base.priorPeak ?? null), higherLows: st.base.higherLows, contraction: st.base.contraction, volumeDryUp: st.base.volumeDryUp } : null,
          trend: { passed: chart.trend.passed, total: chart.trend.total }, rs: { newHigh: chart.rs.rsNewHigh, rs3m: r4(chart.rs.rs3m), rs12m: r4(chart.rs.rs12m) },
        } });
      }
    }
    const pb = detectPullback(bars);
    if (pb.stage !== 'NONE') {
      items.push({ type: 'pullback', r, stage: pb.stage, setupScore: pb.score, plan: planOut(pb.plan), detail: {
        high: r4(pb.high), highAgeBars: pb.highAgeBars, pullLow: r4(pb.pullLow), depth: r4(pb.depth), currentDepth: r4(pb.currentDepth),
        support: { kind: pb.support.kind, price: r4(pb.support.price) }, confluence: pb.confluence, volumeDryUp: pb.volumeDryUp, rsi: r4(pb.rsi), rsiCooled: pb.rsiCooled, trend: pb.trend,
      } });
    }
    for (const tf of ['weekly', 'monthly']) {
      const hb = detectHtfBottom(htf[tf], tf);
      if (hb.stage === 'NONE') continue;
      items.push({ type: tf === 'weekly' ? 'weekly_bottom' : 'monthly_bottom', r, stage: hb.stage, setupScore: hb.score, plan: planOut(hb.plan), detail: {
        high: r4(hb.high), low: r4(hb.low), decline: r4(hb.decline), lowAgeBars: hb.lowAgeBars, lowAgeLabel: hb.lowAgeLabel, aboveLow: r4(hb.aboveLow),
        higherLow: hb.higherLow, aboveMa: hb.aboveMa, maRising: hb.maRising, volumeDryUp: hb.volumeDryUp, rsiRecover: hb.rsiRecover, pivot: r4(hb.pivot), bars: htf[tf].length,
      } });
    }
  }
  // news budget: best candidates of each type first (round-robin), one request per symbol
  const TYPES = ['breakout', 'pullback', 'weekly_bottom', 'monthly_bottom'];
  const byType = Object.fromEntries(TYPES.map((t) => [t, items.filter((x) => x.type === t).sort((a, b) => b.setupScore - a.setupScore)]));
  const maxStory = Number(env.SETUP_NEWS_MAX || 200);
  const newsOrder = [];
  for (let k = 0; newsOrder.length < maxStory && TYPES.some((t) => k < byType[t].length); k++) {
    for (const t of TYPES) { const x = byType[t][k]; if (x && !newsOrder.includes(x.r.symbol) && newsOrder.length < maxStory) newsOrder.push(x.r.symbol); }
  }
  const newsGate = throttle(320);
  const newsStart = new Date(Date.parse(asOf) - 60 * 86400000).toISOString();
  const newsBy = new Map();
  let newsRequests = 0;
  for (const sym of newsOrder) {
    try {
      await newsGate();
      newsBy.set(sym, (await fetchNews({ symbol: sym, start: newsStart, keyId: env.ALPACA_KEY_ID, secretKey: env.ALPACA_SECRET_KEY, fetchImpl, wait }))
        .filter((n) => Date.parse(n.time) <= asOfSec * 1000 + 86400000)
        .map((n) => ({ ...n, ...classifyHeadline(n.headline) })));
      newsRequests++;
    } catch { newsBy.set(sym, []); /* news is optional evidence */ }
  }
  const storyBy = new Map();
  const setups = [];
  for (const x of items) {
    const { r } = x;
    if (!storyBy.has(r.symbol)) {
      const company = companyBy.get(r.symbol) ?? null;
      storyBy.set(r.symbol, storySignals({ fundamentals: company?.facts ?? null, filings: company?.filings ?? [], news: newsBy.get(r.symbol) ?? [], asOf }));
    }
    const story = storyBy.get(r.symbol);
    const news = newsBy.get(r.symbol) ?? [];
    setups.push({
      type: x.type, symbol: r.symbol, name: r.name, sector: r.sector, price: r4(r.features.price), mcap: r.features.mcap ? Math.round(r.features.mcap) : null, adv20: r.features.adv20 ? Math.round(r.features.adv20) : null,
      stage: x.stage, ...x.detail, plan: x.plan,
      chartScore: x.setupScore, storyScore: story.storyScore, score: Math.round(x.setupScore * 0.55 + story.storyScore * 0.45),
      reasons: story.reasons, themes: story.themes, revenueYoY: story.revenueYoY.map((q) => ({ end: q.end, yoy: r4(q.yoy) })),
      narrative: story.narrative,
      news: news.slice(0, 5).map((n) => ({ time: n.time, headline: n.headline, url: n.url, sentiment: n.sentiment, tags: n.tags })),
      newsChecked: newsBy.has(r.symbol),
    });
  }
  setups.sort((a, b) => b.score - a.score);
  const count = (arr) => arr.reduce((m, x) => ((m[x.stage] = (m[x.stage] ?? 0) + 1), m), {});
  stats.setups = {
    scanned: rows.length, candidates: setups.length, newsRequests,
    byStage: count(setups.filter((x) => x.type === 'breakout')),
    byType: Object.fromEntries(TYPES.map((t) => [t, count(setups.filter((x) => x.type === t))])),
  };
  const PER_TYPE = 150;
  writeJson(path.join(outDir, 'setups.json'), {
    asOf, generatedAt: new Date().toISOString(), model: 'setups-v2', rules: { breakout: SETUP_RULES, pullback: PULLBACK_RULES, bottom: BOTTOM_RULES },
    weights: { chart: 0.55, story: 0.45 },
    method: {
      breakout: '6–18개월 바닥(깊이 12–50%, 저점 상승·변동성 수축·거래량 감소) 상단을 50일 평균 1.4배 이상 거래량으로 돌파.',
      pullback: '상승 추세(200일선 위·상승, 50>200, 직전 30% 이상 상승) 종목이 최근 고점 대비 5–25% 조정 후 20일 EMA·50일선·이전 고점·오더블록 지지에 도달.',
      weekly_bottom: '최근 2년 고점 대비 35% 이상 하락 후 4주 이상 신저가 없음, 바닥 대비 20% 이내. 10주선 위 + 저점 상승이면 전환 시작.',
      monthly_bottom: '최근 5년 고점 대비 50% 이상 하락 후 2개월 이상 신저가 없음, 바닥 대비 25% 이내. 10개월선 위 + 저점 상승/이평 상승이면 전환 시작.',
      story: 'SEC 분기 매출 가속·흑자 전환·뉴스 관심·테마·의심받는 성장 가점, 희석·런웨이·위험 공시 감점.',
    },
    caveat: '돌파·눌림·바닥 매수 모두 실패가 흔합니다. 손절가를 지키는 것을 전제로 한 후보 목록이며 투자 자문이 아닙니다. 주봉·월봉의 마지막 봉은 진행 중인 봉입니다.',
    stats: stats.setups,
    candidates: TYPES.flatMap((t) => setups.filter((x) => x.type === t).slice(0, PER_TYPE)),
  });
  const toRec = (x) => ({ rank: 0, symbol: x.symbol, name: x.name, sector: x.sector, score: x.score, factors: { chart: x.chartScore, story: x.storyScore, type: x.type, stage: x.stage }, features: { price: x.price } });
  const pick = (pred) => setups.filter((x) => pred(x) && x.plan && x.plan.riskPct !== null && x.plan.riskPct <= 0.15).slice(0, 20).map(toRec).map((x, i) => ({ ...x, rank: i + 1 }));
  recs.setups = pick((x) => x.type === 'breakout' && (x.stage === 'BREAKOUT' || x.stage === 'POST_BREAKOUT'));
  recs.pullback = pick((x) => x.type === 'pullback' && (x.stage === 'BOUNCE' || x.stage === 'AT_SUPPORT'));
  recs.bottom = pick((x) => (x.type === 'weekly_bottom' || x.type === 'monthly_bottom') && x.stage === 'TURNING');

  const detail = (r) => ({
    rank: r.rank, percentile: r.percentile, symbol: r.symbol, name: r.name, sector: r.sector, score: r.score, coverage: r.coverage, factors: r.factors,
    price: r4(r.features.price), mcap: r.features.mcap ? Math.round(r.features.mcap) : null, adv20: r.features.adv20 ? Math.round(r.features.adv20) : null,
    f: Object.fromEntries(Object.entries(r.features).filter(([k]) => !['lastDate', 'bars', 'price', 'mcap', 'adv20'].includes(k)).map(([k, v]) => [k, Array.isArray(v) ? v : r4(v)])),
    excluded: exclusionReasons(r, r.horizon),
  });
  const sources = {
    prices: `Alpaca Market Data v2 (${env.ALPACA_FEED || 'sip'}, adjustment=all, daily)`,
    filings: 'SEC EDGAR submissions + daily form index',
    fundamentals: stats.finnhub ? `SEC XBRL companyfacts, 없으면 Finnhub financials-reported (SEC 10-Q/10-K 수치, 분기·TTM) — Finnhub ${fhRec.size}개 종목` : 'SEC XBRL companyfacts (latest annual)',
    universe: stats.universeSource === 'sec' ? 'SEC company_tickers_exchange.json'
      : secDataOk ? `${stats.universeSource === 'sec-cache' ? 'SEC 종목 목록(이전 수집본)' : 'Alpaca 종목 목록'} + SEC 재무·공시(data.sec.gov${stats.cikMap ? `, ${stats.cikMap.confirmed}개 종목 SEC 티커로 확인` : ''})`
        : `${stats.universeSource === 'sec-cache' ? 'SEC 종목 목록(이전 수집본)' : 'Alpaca 종목 목록'} — SEC 접속 실패로 섹터·재무·공시 없음`,
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
