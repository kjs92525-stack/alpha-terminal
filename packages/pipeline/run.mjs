import { financialReview } from '../analysis/financial-review.mjs';
// Nightly pipeline: universe -> bars -> SEC refresh -> features -> rankings -> ledger -> performance.
// All IO goes through `fetchImpl` and the filesystem dirs, so it runs identically in
// GitHub Actions and in tests with a mocked fetch.

import fs from 'node:fs';
import path from 'node:path';
import { isDailyBarClosed } from '../analysis/market.mjs';
import { parseExchangeTickers, buildUniverse, sicToSector, fromVendorSymbol } from './universe.mjs';
import { fetchDailyBars, mergeBars, fetchNews, fetchAssets } from './alpaca.mjs';
import { buildNameIndex, normalizeCompanyName, framePeriods, frameUrl } from './cikmap.mjs';
import { makeFinnhubClient, fetchCompany, withFacts, fetchEarningsCalendar } from './finnhub.mjs';
import { detectSetup, evaluateChart, SETUP_RULES } from '../analysis/setups.mjs';
import { storySignals, quarterlyYoY } from '../analysis/story.mjs';
import { detectPullback, detectHtfBottomClosed, mergeMonthly, PULLBACK_RULES, BOTTOM_RULES } from '../analysis/zones.mjs';
import { resampleWeekly } from '../analysis/indicators.mjs';
import { BUSINESS_LINKS, buildSectorRadar } from '../analysis/sector-stories.mjs';
import { earlyMarket, earlyFacts } from '../analysis/early-alpha.mjs';
import { assetPivotSignals } from '../analysis/asset-pivot.mjs';
import { earlyIssues } from '../analysis/discovery-rules.mjs';
import { simulatePaperTrade, summarizePaper, PAPER_RULES } from '../analysis/paper-trade.mjs';
import { detectVolumeSurge, explainSurge, SURGE_RULES } from '../analysis/volume-surge.mjs';
import { SECTOR_ETFS, cyclePhase, bestGroup } from '../analysis/cycle.mjs';
import { classifyHeadline } from '../analysis/news.mjs';
import { throttle } from './http.mjs';
import { makeSecClient, normalizeUserAgent, refreshCompanies, dailyIndexUrl, parseDailyIndex, businessDaysBetween } from './secdata.mjs';
import { computeFeatures } from './features.mjs';
import { rankHorizon, selectRecommendations, exclusionReasons, MODEL_VERSION, MID_FACTORS, SHORT_FACTORS, REC_FILTERS } from './ranking.mjs';
import { makeLedger, evaluateLedgers } from './ledger.mjs';
import { buildBrief } from './brief.mjs';
import { runEarlyAlpha } from './early-alpha.mjs';
import { MARKET_ETFS,marketBreadth } from '../analysis/market-brief.mjs';
import { publishMarketBrief } from './market-brief.mjs';

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
  // sector / theme ETFs are fetched with the stocks: they define the cycle groups
  const symbols = [...new Set([BENCH, ...MARKET_ETFS, ...SECTOR_ETFS.map(([e]) => e), ...universe.map((u) => u.symbol)])];
  const cached = new Map(symbols.map((s) => [s, unpackBars(readJson(path.join(barsDir, `${safeName(s)}.json`), null))]));
  const end = new Date(now - 20 * 60000).toISOString();
  const fullStart = new Date(now - historyDays * 86400000).toISOString().slice(0, 10);
  const fresh = symbols.filter((s) => !cached.get(s).length);
  const known = symbols.filter((s) => cached.get(s).length);
  const lastTimes = known.map((s) => cached.get(s).at(-1).time);
  const incStart = lastTimes.length ? new Date((Math.min(...lastTimes) - 10 * 86400) * 1000).toISOString().slice(0, 10) : fullStart;
  const alpaca = { keyId: env.ALPACA_KEY_ID, secretKey: env.ALPACA_SECRET_KEY, fetchImpl, wait, feed: env.ALPACA_FEED || 'sip' };
  let requests = 0;
  const observedFeeds=new Set();
  const needFull = [...fresh];
  if (known.length) {
    const r = await fetchDailyBars({ ...alpaca, symbols: known, start: incStart, end, onBatch: (d, t) => log(`bars inc ${d}/${t}`) });
    requests += r.requests;
    observedFeeds.add(r.feed);
    for (const s of known) {
      const m = mergeBars(cached.get(s), r.bars[s] ?? []);
      if (m.needsFull) needFull.push(s); else cached.set(s, m.bars);
    }
  }
  if (needFull.length) {
    const r = await fetchDailyBars({ ...alpaca, symbols: needFull, start: fullStart, end, onBatch: (d, t) => log(`bars full ${d}/${t}`) });
    requests += r.requests;
    observedFeeds.add(r.feed);
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
  // Independent EOD market risk overlay; no changes to rankings or ledgers.
  try {
    const breadth=marketBreadth({symbols:universe.map(u=>u.symbol),getBars:s=>cached.get(s),asOf,now});
    writeJson(path.join(outDir,'market-breadth.json'),breadth);
    const brief=await publishMarketBrief({barsBy:Object.fromEntries(MARKET_ETFS.map(s=>[s,cached.get(s)??[]])),breadth,asOf,outDir,env,fetchImpl,now,source:`Alpaca ${[...observedFeeds].join('/')||'캐시'} · adjustment=all · 지연 종가`});
    stats.marketBrief={state:brief.decision.state,sample:breadth.sample,missing:brief.missing};
  } catch(e) {stats.marketBrief={error:String(e?.message??e).slice(0,200)};}

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
  //     Free plan = 60 calls/min, 3 calls per company: most liquid missing companies first,
  //     then the stalest (quarterly numbers change about every 90 days). Cached per symbol.
  const fhDir = path.join(cacheDir, 'finnhub');
  const fhRec = new Map();
  const secFacts = (u) => (u.cik ? cache.get(u.cik)?.facts : null);
  // facts are recomputed from cached compact filings every run; records in an older format are refetched
  for (const u of universe) { const r = withFacts(readJson(path.join(fhDir, `${safeName(u.symbol)}.json`), null)); if (r) fhRec.set(u.symbol, r); }
  if (env.FINNHUB_API_KEY) {
    const fh = makeFinnhubClient({ apiKey: env.FINNHUB_API_KEY, fetchImpl, wait, minIntervalMs: Number(env.FINNHUB_MIN_INTERVAL_MS ?? 1100) });
    const maxCompanies = Math.floor(Number(env.FINNHUB_MAX_CALLS || 1500) / 3);
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
    const prior=readJson(path.join(outDir,'companies',`${u.ticker??u.symbol}.json`),null);
    const oldFilings=(prior?.filingCheck?prior.filings??[]:[]).filter(x=>Date.parse(x.acceptedAt??x.filingDate)<=Date.parse(asOf)+86400000-1);
    return f ? { ...f, filings: [...(secRec?.filings ?? []),...oldFilings].filter((x,i,a)=>a.findIndex(y=>y.accession===x.accession&&y.form===x.form)===i),filingCheck:prior?.filingCheck, sic: secRec?.sic ?? null } : secRec;
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
    // $1+: long-base breakouts often start as low-priced small caps (RGTI was ~$1 in 2024); liquidity still required
    if (r.features.price < Number(env.SETUP_MIN_PRICE || 1) || (r.features.adv20 ?? 0) < 2e6 || r.sector === 'Blank Check') continue;
    const bars = (cached.get(r.symbol) ?? []).filter((b) => b.time <= asOfSec);
    if (bars.length < 220) continue;
    const htf = { weekly: resampleWeekly(bars), monthly: mergeMonthly((monthly.get(r.symbol) ?? []).filter((b) => b.time <= asOfSec), bars) };
    if (bars.length >= 260) {
      const quick = detectSetup(bars, SETUP_RULES, htf.monthly);
      // IN_BASE = 바닥 다지기: a validated bottom base, not yet near its top
      if (ACTIONABLE.has(quick.stage) || quick.stage === 'IN_BASE') {
        const chart = evaluateChart(bars, spyAsOf, htf.monthly);
        const st = chart.setup;
        // 바닥 다지기: rank buyable floors first (at the floor with a tight stop), wide-stop boxes last
        const floorBonus = st.stage !== 'IN_BASE' ? 0
          : (chart.plan?.entryType === 'zone' ? 15 : chart.plan?.entryType === 'limit' ? 8 : 0) - ((chart.plan?.riskPct ?? 1) > 0.25 ? 15 : 0);
        items.push({ type: st.stage === 'IN_BASE' ? 'base' : 'breakout', r, stage: st.stage, setupScore: chart.chartScore + floorBonus, plan: planOut(chart.plan), detail: {
          pivot: r4(st.pivot), distanceToPivot: r4(st.distanceToPivot ?? null), extension: r4(st.extension ?? null),
          barsSinceBreakout: st.barsSinceBreakout ?? null, posInBase: r4(chart.plan?.posInBase ?? null), breakoutVolMult: r4(st.breakoutVolMult ?? null),
          base: st.base ? { months: Math.round(st.base.window / 21), depth: r4(st.base.depth), high: r4(st.base.high), low: r4(st.base.low), priorPeak: r4(st.base.priorPeak ?? null), multiYearLow: r4(st.base.multiYearLow ?? null), higherLows: st.base.higherLows, contraction: st.base.contraction, volumeDryUp: st.base.volumeDryUp } : null,
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
      // mid-week / mid-month the last bar is still forming: confirm on the last closed bar instead
      const forming = tf==='weekly'?htf[tf].at(-1).time+4*86400>asOfSec:(()=>{const d=new Date(htf[tf].at(-1).time*1000);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000>asOfSec+86400})();
      const hb = detectHtfBottomClosed(htf[tf], tf, forming);
      if (hb.stage === 'NONE') continue;
      items.push({ type: tf === 'weekly' ? 'weekly_bottom' : 'monthly_bottom', r, stage: hb.stage, setupScore: hb.score, plan: planOut(hb.plan), detail: {
        high: r4(hb.high), low: r4(hb.low), decline: r4(hb.decline), lowAgeBars: hb.lowAgeBars, lowAgeLabel: hb.lowAgeLabel, aboveLow: r4(hb.aboveLow),
        provisional: hb.provisional, htfBasis: hb.basis, htfNote: hb.note ?? null,
        higherLow: hb.higherLow, aboveMa: hb.aboveMa, maRising: hb.maRising, volumeDryUp: hb.volumeDryUp, rsiRecover: hb.rsiRecover, pivot: r4(hb.pivot), bars: htf[tf].length,
      } });
    }
  }
  // news budget: best candidates of each type first (round-robin), one request per symbol
  const TYPES = ['breakout', 'base', 'pullback', 'weekly_bottom', 'monthly_bottom'];
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
  // 6b-2. volume surges (3x+ the 50-session average in the last 3 sessions) with the likely cause
  //       from dated headlines/filings; extra news requests only for surge names not yet fetched
  const surgeRows = [];
  for (const r of rows) {
    if (r.sector === 'Blank Check') continue;
    const s = detectVolumeSurge((cached.get(r.symbol) ?? []).filter((b) => b.time <= asOfSec));
    if (s) surgeRows.push({ r, s });
  }
  // cap the multiple so one thin print cannot outrank a large, liquid name with a real event
  const surgeRank = (x) => Math.min(x.volMult, 15) * Math.log10(x.dollarVolume);
  surgeRows.sort((a, b) => surgeRank(b.s) - surgeRank(a.s));
  const surgeTop = surgeRows.slice(0, Number(env.SURGE_MAX || 60));
  let surgeNewsRequests = 0;
  for (const { r } of surgeTop) {
    if (newsBy.has(r.symbol)) continue;
    try {
      await newsGate();
      newsBy.set(r.symbol, (await fetchNews({ symbol: r.symbol, start: newsStart, keyId: env.ALPACA_KEY_ID, secretKey: env.ALPACA_SECRET_KEY, fetchImpl, wait })).filter((n) => Date.parse(n.time) <= asOfSec * 1000 + 86400000).map((n) => ({ ...n, ...classifyHeadline(n.headline) })));
      surgeNewsRequests++;
    } catch { /* not collected: shown as unchecked, never as "no news" */ }
  }
  const surges = surgeTop.map(({ r, s }) => {
    const e = explainSurge({ surge: s, news: newsBy.has(r.symbol) ? newsBy.get(r.symbol) : null, filings: companyBy.get(r.symbol)?.filings ?? [], asOf });
    return { symbol: r.symbol, name: r.name, sector: r.sector, mcap: r.features.mcap ? Math.round(r.features.mcap) : null, adv20: r.features.adv20 ? Math.round(r.features.adv20) : null,
      ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'number' ? r4(v) : v])), ...e };
  });
  writeJson(path.join(outDir, 'volume-surges.json'), {
    asOf, generatedAt: new Date().toISOString(), rules: SURGE_RULES,
    method: '최근 3거래일 안에 거래량이 직전 50거래일 평균의 3배 이상(당일 거래대금 $10M 이상, 평소 하루 거래대금 $2M 이상, 주가 $2 이상)인 종목. 이유는 급증일 전후(-3일~+2일) 뉴스 제목·공시로 분류하고, 찾지 못하면 "확인된 이유 없음"으로 둡니다.',
    caveat: '거래량은 무언가 바뀌었다는 신호일 뿐 방향을 알려주지 않습니다. 이유 분류는 기사 제목 기준이라 원문 확인 전에는 단서입니다. 매수 추천이 아닙니다.',
    stats: { detected: surgeRows.length, shown: surges.length, newsRequests: surgeNewsRequests },
    items: surges,
  });
  stats.surges = { detected: surgeRows.length, shown: surges.length, newsRequests: surgeNewsRequests };
  // upcoming earnings (one Finnhub call): buying days before a report is a coin flip on the report
  const earnFrom = asOf, earnTo = new Date(Date.parse(asOf) + 30 * 86400000).toISOString().slice(0, 10);
  let earnings = new Map(), earningsStatus = env.FINNHUB_API_KEY ? 'error' : 'not_configured';
  if (env.FINNHUB_API_KEY) {
    try { earnings = await fetchEarningsCalendar(makeFinnhubClient({ apiKey: env.FINNHUB_API_KEY, fetchImpl, wait, minIntervalMs: 0 }), earnFrom, earnTo); earningsStatus = 'ok'; } catch { /* unknown, never "no earnings" */ }
  }
  const weekdaysUntil = (d) => { let n = 0; for (let t = Date.parse(asOf) + 86400000; t <= Date.parse(d); t += 86400000) { const w = new Date(t).getUTCDay(); if (w && w < 6) n++; } return n; };
  stats.earnings = { status: earningsStatus, count: earnings.size };
  const storyBy = new Map();
  const setups = [];
  for (const x of items) {
    const { r } = x;
    if (!storyBy.has(r.symbol)) {
      const company = companyBy.get(r.symbol) ?? null;
      storyBy.set(r.symbol, storySignals({ ticker:r.ticker ?? r.symbol, fundamentals: company?.facts ?? null, filings: company?.filings ?? [], news: newsBy.get(r.symbol) ?? [], asOf }));
    }
    const story = storyBy.get(r.symbol);
    const news = newsBy.get(r.symbol) ?? [];
    setups.push({
      type: x.type, symbol: r.symbol, name: r.name, sector: r.sector, price: r4(r.features.price), mcap: r.features.mcap ? Math.round(r.features.mcap) : null, adv20: r.features.adv20 ? Math.round(r.features.adv20) : null,
      stage: x.stage, ...x.detail, plan: x.plan,
      ret63: (()=>{const b=(cached.get(r.symbol)??[]).filter(b=>b.time<=asOfSec);return b.length>63?r4(b.at(-1).close/b.at(-64).close-1):null})(),
      ret21: (()=>{const b=(cached.get(r.symbol)??[]).filter(b=>b.time<=asOfSec);return b.length>21?r4(b.at(-1).close/b.at(-22).close-1):null})(),
      storySignals:story.signals,priceAsOf:r.features.lastDate,ret1:r4(r.features.ret_1),ret5:r4(r.features.ret_5),
      funding:(()=>{const f=companyBy.get(r.symbol)?.facts,current=end=>Boolean(end&&Number.isFinite(Date.parse(end))&&Date.parse(end)/1000<=asOfSec&&asOfSec-Date.parse(end)/1000<=200*86400);return {runwayMonths:current(f?.cash?.end)&&current(f?.operatingCashFlow?.end)?f?.runwayMonths??null:null,sharesYoY:current(f?.sharesOutstanding?.end)?f?.sharesYoY??null:null,source:'200일 이내 보고 자료만 표시 · 공시 원문 미검증'}})(),
      chartScore: x.setupScore, storyScore: story.storyScore, score: Math.round(x.setupScore * 0.55 + story.storyScore * 0.45),
      reasons: story.reasons, themes: story.themes, revenueYoY: story.revenueYoY.map((q) => ({ end: q.end, yoy: r4(q.yoy) })),
      // reported quarterly net income (only periods up to the snapshot date) for the automatic thesis checks
      netIncomeQ:(companyBy.get(r.symbol)?.facts?.netIncomeQuarterly??[]).filter(q=>q?.end&&Date.parse(q.end)/1000<=asOfSec&&Number.isFinite(q.value)).slice(-5).map(q=>({end:q.end,value:Math.round(q.value)})),
      narrative: story.narrative,
      earnings: earnings.has(r.symbol) ? { ...earnings.get(r.symbol), sessions: weekdaysUntil(earnings.get(r.symbol).date) } : null, earningsChecked: earningsStatus === 'ok',
      // IREN-type asset pivots: large contract headlines / capex build-out and how it is funded
      assetPivot: assetPivotSignals({ news: newsBy.has(r.symbol) ? newsBy.get(r.symbol) : null, facts: companyBy.get(r.symbol)?.facts ?? null, mcap: r.features.mcap ?? null, asOf }),
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
  // 6c. sector / theme cycle: each ETF's phase, and every candidate attached to the group it
  //     tracks best (daily-return correlation over ~6 months, beyond the market's)
  const etfBars = Object.fromEntries(SECTOR_ETFS.map(([e]) => [e, (cached.get(e) ?? []).filter((b) => b.time <= asOfSec)]).filter(([, b]) => b.length >= 260));
  const groupOf = new Map();
  for (const x of setups) {
    if (groupOf.has(x.symbol)) continue;
    const bars = (cached.get(x.symbol) ?? []).filter((b) => b.time <= asOfSec);
    groupOf.set(x.symbol, bars.length >= 130 ? bestGroup(bars, etfBars, spyAsOf) : null);
  }
  const ETF_NAME = Object.fromEntries(SECTOR_ETFS);
  for (const x of setups) { const g = groupOf.get(x.symbol); x.group = g ? { etf: g.etf, name: ETF_NAME[g.etf], corr: r4(g.corr) } : null; }
  const groups = [];
  for (const [etf, name] of SECTOR_ETFS) {
    const bars = etfBars[etf];
    if (!bars) continue;
    const cp = cyclePhase(bars, spyAsOf);
    if (!cp) continue;
    const BUY = new Set(['BREAKOUT', 'POST_BREAKOUT', 'NEAR_PIVOT', 'BOUNCE', 'AT_SUPPORT', 'TURNING', 'AT_BOTTOM']);
    const members = setups.filter((x) => x.group?.etf === etf && BUY.has(x.stage) && x.plan)
      .sort((a, b) => b.score - a.score)
      .filter((x, i, arr) => arr.findIndex((y) => y.symbol === x.symbol) === i)
      .slice(0, 8)
      .map((x) => ({ symbol: x.symbol, name: x.name, price: x.price, type: x.type, stage: x.stage, score: x.score, corr: x.group.corr, how: x.plan.how, takeaway: x.narrative?.takeaway ?? null }));
    groups.push({ etf, name, price: r4(bars.at(-1).close), phase: cp.phase, phaseKo: cp.phaseKo, earlyScore: cp.earlyScore, model:cp.model, warnings:cp.warnings, metrics: Object.fromEntries(Object.entries(cp.metrics).map(([k, v]) => [k, r4(v)])), members });
  }
  const PHASE_ORDER = { EARLY: 0, BASING: 1, LEADING: 2, NEUTRAL: 3, LATE: 4, DOWN: 5 };
  groups.sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || b.earlyScore - a.earlyScore);
  writeJson(path.join(outDir, 'sectors.json'), {
    asOf, generatedAt: new Date().toISOString(),
    model:'price-cycle-v2', method: '산업 실물 경기와 별개인 ETF 가격 국면 판정: 저점 이후 반등·200일선 이격·전환 지속성을 확인. 업종·테마 ETF 자체 차트로 국면 판정: 200일선 대비 위치, 50일선 방향과 200일선 대비, 3·12개월 수익률, 2년 고점 대비 하락폭, SPY 대비 강도. 종목은 최근 약 6개월 일간 수익률 상관이 가장 높은 ETF(시장 전체 상관보다 높을 때만)에 묶음.',
    caveat: 'ETF 국면은 업종 전체의 평균이며 개별 종목과 다를 수 있습니다. 사이클 초입 판정은 실패(재하락)도 흔합니다.',
    groups,
  });
  const sectorStocks = Object.fromEntries(Object.keys(BUSINESS_LINKS).map(ticker => {
    const row=rows.find(r=>r.ticker===ticker || r.symbol===ticker);
    const market=earlyMarket((cached.get(row?.symbol??ticker)??[]),asOf);
    const company= row ? companyFor(row) : null;const facts=earlyFacts(company,asOf);const yoy=quarterlyYoY(facts.revenueQuarterly).slice(-2);const review=financialReview(ticker,asOf,yoy.at(-1)?.end);
    return [ticker,{company:yoy.length?{period:yoy.at(-1).end,growth:yoy.at(-1).yoy,priorGrowth:yoy.at(-2)?.yoy??null,source:company?.source??'SEC',quality:review?.quality??'반복 제품 성장·일회성 효과 미검증'}:null,price:market.price,ret21:market.ret21,ret63:market.ret63,lastDate:market.lastDate,marketCap:row?.features.mcap??null,source:'야간 기준 종가·프로필 또는 보고 주식 수 추정 시총'}];
  }));
  writeJson(path.join(outDir,'sector-radar.json'),buildSectorRadar({asOf,groups,stocks:sectorStocks}));
  stats.sectors = { groups: groups.length, byPhase: groups.reduce((m, g) => ((m[g.phase] = (m[g.phase] ?? 0) + 1), m), {}), grouped: [...groupOf.values()].filter(Boolean).length };

  const PER_TYPE = 150;
  writeJson(path.join(outDir, 'setups.json'), {
    asOf, generatedAt: new Date().toISOString(), model: 'setups-v2', rules: { breakout: SETUP_RULES, pullback: PULLBACK_RULES, bottom: BOTTOM_RULES },
    weights: { chart: 0.55, story: 0.45 },
    method: {
      breakout: '6–18개월 바닥(깊이 12–50%, 저점 상승·변동성 수축·거래량 감소) 상단을 50일 평균 1.4배 이상 거래량으로 돌파.',
      base: '돌파 탭과 같은 바닥 조건(3년 고점 대비 크게 빠져 있거나 다년 저점 근처, 6–18개월 박스)을 만족하지만 아직 상단 6% 밖에 있는 종목. 박스 아래쪽 절반이면 바닥 근처(바닥+12% 이내)에서 분할매수 — 이미 바닥이면 지금, 조금 위면 지정가 대기. 위쪽 절반이면 상단 돌파 대기.',
      pullback: '상승 추세(200일선 위·상승, 50>200, 직전 30% 이상 상승) 종목이 최근 고점 대비 5–25% 조정 후 20일 EMA·50일선·이전 고점·오더블록 지지에 도달.',
      weekly_bottom: '최근 2년 고점 대비 35% 이상 하락 후 4주 이상 신저가 없음, 바닥 대비 20% 이내. 10주선 위 + 저점 상승이면 전환 시작.',
      monthly_bottom: '최근 5년 고점 대비 50% 이상 하락 후 2개월 이상 신저가 없음, 바닥 대비 25% 이내. 10개월선 위 + 저점 상승/이평 상승이면 전환 시작.',
      story: 'SEC 분기 매출 가속·흑자 전환·뉴스 관심·테마·의심받는 성장 가점, 희석·런웨이·위험 공시 감점.',
    },
    caveat: '돌파·눌림·바닥 매수 모두 실패가 흔합니다. 손절가를 지키는 것을 전제로 한 후보 목록이며 투자 자문이 아닙니다. 주봉·월봉의 마지막 봉은 진행 중인 봉입니다.',
    stats: stats.setups,
    earningsCalendar: { status: earningsStatus, from: earnFrom, to: earnTo, count: earnings.size, source: 'Finnhub /calendar/earnings' },
    candidates: TYPES.flatMap((t) => setups.filter((x) => x.type === t).slice(0, PER_TYPE)),
  });
  // small Markdown brief for chat assistants that read a URL (the JSON files are too large)
  try {
    const brief = buildBrief({ setups: readJson(path.join(outDir, 'setups.json')), sectors: readJson(path.join(outDir, 'sectors.json'), null), surges: readJson(path.join(outDir, 'volume-surges.json'), null), siteUrl: env.SITE_URL || null });
    fs.writeFileSync(path.join(outDir, 'brief.md'), brief);
  } catch (e) { stats.briefError = String(e?.message ?? e); }
  // 7b. paper-trading ledger: every name the early-turn / asset-pivot lists show is recorded once
  //     (append-only) and re-simulated nightly under one fixed rule set → a forward track record
  const paperDir = path.join(outDir, 'paper');
  const signals = readJson(path.join(paperDir, 'signals.json'), []);
  const simulate = (sg) => simulatePaperTrade(sg, (cached.get(sg.symbol) ?? []).filter((b) => b.time <= asOfSec), spyAsOf);
  const active = new Set(signals.filter((sg) => ['pending', 'open'].includes(simulate(sg).status)).map((sg) => sg.symbol));
  const ids = new Set(signals.map((sg) => sg.id));
  for (const mode of ['early', 'pivot']) for (const x of setups) {
    const id = `${asOf}:${x.symbol}:${mode}`;
    if (ids.has(id) || active.has(x.symbol) || earlyIssues(x, asOf, mode).length || !x.plan) continue;
    signals.push({ id, symbol: x.symbol, name: x.name, mode, type: x.type, stage: x.stage, signalDate: asOf, entry: x.plan.entry, stop: x.plan.stop, target: x.plan.target, entryType: x.plan.entryType ?? 'buy-stop', recordedAt: new Date().toISOString() });
    ids.add(id); active.add(x.symbol);
  }
  writeJson(path.join(paperDir, 'signals.json'), signals, true);
  const paperTrades = signals.map((sg) => ({ ...sg, result: simulate(sg) }));
  const rowBy = new Map(setups.map((x) => [x.symbol, x]));
  const actions = [];
  for (const t of paperTrades) {
    for (const e of t.result.events.filter((e) => e.date === asOf)) actions.push({ symbol: t.symbol, kind: e.kind, text: e.text });
    if (t.result.status === 'pending') actions.push({ symbol: t.symbol, kind: 'order', text: `${t.entryType === 'buy-stop' ? `$${t.entry} 이상 체결 시 매수(돌파 주문)` : `$${t.entry} 이하 지정가 매수`} · 무효화 $${t.stop} · ${t.signalDate} 신호` });
    const e = earnings.get(t.symbol);
    if (t.result.status === 'open' && e && weekdaysUntil(e.date) <= 5) actions.push({ symbol: t.symbol, kind: 'earnings', text: `보유 중 · 실적 발표 ${e.date} (${weekdaysUntil(e.date)}거래일 뒤) — 비중·손절 점검` });
    if (t.result.status === 'open' && !rowBy.has(t.symbol)) actions.push({ symbol: t.symbol, kind: 'note', text: '오늘 스캔 목록에서 빠짐 — 매도 규칙대로 관리' });
  }
  writeJson(path.join(paperDir, 'latest.json'), {
    asOf, generatedAt: new Date().toISOString(), rules: PAPER_RULES,
    method: '상승 초입·자산 전환형 목록에 오른 종목을 그날 한 번 기록(이후 수정 없음). 다음 거래일부터 10거래일 안에 주문 가격에 닿으면 체결, 그 전에 무효화 가격을 깨면 취소. 체결 뒤 +1R이면 손절가를 매수가로, +2R이면 절반 익절, 그 뒤 50일선 아래 종가면 나머지 매도. 40거래일 동안 +0.5R 미만이면 시간 손절, 최대 120거래일. 같은 날 손절과 익절이 겹치면 손절로 처리합니다.',
    caveat: '일봉 기준 모의 체결이며 수수료·호가 차이는 반영하지 않습니다. 마감 거래 30건 미만이면 성과를 판단할 수 없습니다.',
    summary: summarizePaper(paperTrades), actions,
    trades: paperTrades.slice(-200).reverse().map((t) => ({ ...t, result: { ...t.result, events: t.result.events.slice(-6) } })),
  });
  stats.paper = summarizePaper(paperTrades);
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

  // Independent research product: failure never invalidates existing outputs.
  try {
    const early = await runEarlyAlpha({ rows, companyBy, getBars: (s) => cached.get(s) ?? unpackBars(readJson(path.join(barsDir, `${safeName(s)}.json`), null)),
      spyBars: spy, asOf, now, outDir, env, fetchImpl, wait, newsBy });
    stats.earlyAlpha = early.stats;
    for(const [symbol,record]of companyBy){
      if(!record?.filingCheck)continue;const ticker=rows.find(r=>r.symbol===symbol)?.ticker??symbol;
      const file=path.join(outDir,'companies',`${ticker}.json`),body=readJson(file,null);
      if(body)writeJson(file,{...body,filings:record.filings??body.filings,filingCheck:record.filingCheck});
    }
    writeJson(path.join(outDir, 'early-alpha', 'status.json'), { asOf, ok: true, generatedAt: new Date(now).toISOString() });
  } catch (e) {
    stats.earlyAlpha = { error: String(e?.message ?? e) };
    writeJson(path.join(outDir, 'early-alpha', 'status.json'), { asOf, ok: false, error: stats.earlyAlpha.error, generatedAt: new Date(now).toISOString() });
    log(`EARLY ALPHA failed: ${stats.earlyAlpha.error}`);
  }

  state.lastIndexDate = asOf;
  state.lastRun = new Date().toISOString();
  writeJson(path.join(cacheDir, 'state.json'), state, true);
  stats.seconds = Math.round((Date.now() - t0) / 1000);
  writeJson(path.join(outDir, 'meta.json'), stats, true);
  return { asOf, stats, latest };
}
