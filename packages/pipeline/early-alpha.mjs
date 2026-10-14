import fs from 'node:fs';
import path from 'node:path';
import { EARLY_MODEL, EARLY_RULES, earlyEligibility, scoreEarlyAlpha } from '../analysis/early-alpha.mjs';
import { fetchRetry, throttle } from './http.mjs';
import { makeFinnhubClient } from './finnhub.mjs';
import { classifyFiling } from '../analysis/sec.mjs';
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } };
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); };
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
export const EARLY_HORIZONS = [21, 63, 126];

// Independent metadata fallback. Successful transport is not a document audit.
export async function fetchEarlyFilings({symbol,asOf,env,fetchImpl,wait}) {
  const from=iso(Date.parse(asOf)/1000-365*86400);
  const client=makeFinnhubClient({apiKey:env.FINNHUB_API_KEY,fetchImpl,wait,minIntervalMs:Number(env.FINNHUB_MIN_INTERVAL_MS??1100)});
  const rows=await client.json(`/stock/filings?${new URLSearchParams({symbol,from,to:asOf})}`);
  if(!Array.isArray(rows))throw new Error('Finnhub filings invalid response');
  const end=Date.parse(asOf)+86400000-1;
  const filings=rows.filter(r=>r.form&&Number.isFinite(Date.parse(r.filedDate))&&Date.parse(r.acceptedDate??r.filedDate)<=end&&Date.parse(r.filedDate)>=Date.parse(from)).map(r=>({
    accession:r.accessNumber,form:r.form,filingDate:r.filedDate.slice(0,10),acceptedAt:r.acceptedDate??r.filedDate,
    url:/^https:\/\/(www\.)?sec\.gov\//.test(r.reportUrl??'')?r.reportUrl:null,...classifyFiling(r.form,r.items??''),
  }));
  return {filings,check:{status:'metadata_received',source:'Finnhub SEC filings',from,to:asOf,documents:'unreviewed'}};
}

// Independent paginated news reader. A truncated window is never a successful
// risk check. The end bound prevents post-asOf news crowding out historical items.
export async function fetchEarlyNews({ symbol, asOf, env, fetchImpl, wait }) {
  const items = []; let token = null; const gate = throttle(320);
  for (let page = 0; page < 5; page++) {
    await gate();
    const qs = new URLSearchParams({ symbols: symbol, start: new Date(Date.parse(asOf) - 90 * 86400000).toISOString(),
      end: new Date(Date.parse(asOf) + 86400000 - 1).toISOString(), limit: '50', sort: 'desc', include_content: 'false' });
    if (token) qs.set('page_token', token);
    const res = await fetchRetry(`https://data.alpaca.markets/v1beta1/news?${qs}`, { headers: { 'APCA-API-KEY-ID': env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY } }, { fetchImpl, wait, retries: 1, baseDelayMs: 500 });
    if (!res.ok) throw new Error(`Early news HTTP ${res.status}`);
    const json = await res.json();
    items.push(...(json.news ?? []).map((n) => ({ time: n.created_at, headline: n.headline ?? '', url: n.url ?? null, source: n.source ?? null })));
    token = json.next_page_token;
    if (!token) return { news: items, status: 'ok' };
  }
  return { news: items, status: 'truncated' };
}


// Match the benchmark's session dates exactly. Missing/delisted symbols remain
// in the denominator and never disappear from performance history.
export function earlyOutcome(entry, getBars, spyBars, asOf, horizon) {
  const end = Date.parse(asOf) / 1000; const start = Date.parse(entry.asOf) / 1000;
  const published=Date.parse(entry.publishedAt);
  const nyHour=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hour12:false});
  const openMs=t=>{const midday=new Date(t*1000+12*3600000);const hour=Number(nyHour.formatToParts(midday).find(p=>p.type==='hour').value)%24;return t*1000+(9.5+12-hour)*3600000;};
  const sessions = spyBars.filter((b) => b.time > start && b.time <= end && (!Number.isFinite(published)||openMs(b.time)>=published)).sort((a, b) => a.time - b.time).slice(0, horizon);
  if (sessions.length < horizon) return { status: 'pending', return: null, excess: null, mfe: null, mae: null };
  const stock = new Map((getBars(entry.symbol) ?? []).filter((b) => b.time <= end).map((b) => [b.time, b]));
  const window = sessions.map((b) => stock.get(b.time));
  if (window.some((b) => !b || !(b.open > 0) || !(b.close > 0))) return { status: 'missing', return: null, excess: null, mfe: null, mae: null };
  const price = window[0].open;
  const ret = window.at(-1).close / price - 1; const spy = sessions.at(-1).close / sessions[0].open - 1;
  return { status: 'complete', entryDate: iso(sessions[0].time), exitDate: iso(sessions.at(-1).time), entryPrice: price,
    return: ret, spyReturn: spy, excess: ret - spy, mfe: Math.max(...window.map((b) => b.high / price - 1)), mae: Math.min(...window.map((b) => b.low / price - 1)) };
}

export function publishEarlyAlpha({ candidates, outDir, asOf, generatedAt, getBars, spyBars, stats = {} }) {
  const root = path.join(outDir, 'early-alpha'); const ledgerDir = path.join(root, 'ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });
  const dates = fs.readdirSync(ledgerDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const previous = dates.map((f) => read(path.join(ledgerDir, f))).filter((l) => l.asOf < asOf);
  const firstSeen = new Map();
  for (const l of previous) for (const r of l.candidates) if (r.status === 'candidate' && !firstSeen.has(r.symbol)) firstSeen.set(r.symbol, l.asOf);
  const dayFile = path.join(ledgerDir, `${asOf}.json`);
  if (!fs.existsSync(dayFile)) {
    // Save all research candidates and their evidence; a later rerun cannot revise them.
    const frozen = candidates.map((r) => ({ ...r, firstSeen: r.status === 'candidate' ? firstSeen.get(r.symbol) ?? asOf : firstSeen.get(r.symbol) ?? null,
      isNew: r.status === 'candidate' && !firstSeen.has(r.symbol) }));
    write(dayFile, { asOf, model: EARLY_MODEL, generatedAt, candidates: frozen, stats });
  }
  const today = read(dayFile);
  const ledgers = [...previous, today];
  const discoveries = []; const seen = new Set();
  for (const l of ledgers) for (const r of l.candidates) {
    if (r.status !== 'candidate' || seen.has(r.symbol)) continue;
    seen.add(r.symbol); discoveries.push({ symbol: r.symbol, name: r.name, asOf: l.asOf, model: l.model, score: r.score,
      outcomes: Object.fromEntries(EARLY_HORIZONS.map((h) => [h, earlyOutcome({ ...r, asOf: l.asOf,publishedAt:l.generatedAt }, getBars, spyBars, asOf, h)])) });
  }
  const summary = Object.fromEntries(EARLY_HORIZONS.map((h) => {
    const outcomes = discoveries.map((r) => r.outcomes[h]); const done = outcomes.filter((o) => o.status === 'complete');
    const avg = (k) => done.length ? done.reduce((s, r) => s + r[k], 0) / done.length : null;
    return [h, { total: outcomes.length, complete: done.length, pending: outcomes.filter((o) => o.status === 'pending').length,
      missing: outcomes.filter((o) => o.status === 'missing').length, meanReturn: avg('return'), meanExcess: avg('excess'), winRate: done.length ? done.filter((o) => o.return > 0).length / done.length : null }];
  }));
  const performance = { asOf, summary, discoveries,evaluationModel:'publication-aware-v2',
    method: '최초 candidate 선정 1회만 추적. 기준일 다음 거래일 중 기록 시각 이후 처음 도래한 미국 정규장 시가 진입, 21/63/126거래일 종가. 같은 날짜 SPY 대비 초과수익·MFE·MAE. 비용 미반영. 누락·상장폐지는 missing으로 보존하며 완료 표본 평균에서 제외되어 편향 가능. 과거 백테스트 아님.' };
  write(path.join(root, 'performance.json'), performance);
  write(path.join(root, 'index.json'), { dates: ledgers.map((l) => l.asOf), firstSeen: Object.fromEntries(discoveries.map((r) => [r.symbol, r.asOf])) });
  // A failed same-day news check may be retried without changing the immutable
  // scores/cohort. Keep the original record and expose the refreshed evidence.
  const freshBy = new Map(candidates.map((r) => [r.symbol, r]));
  const revision = today.model !== EARLY_MODEL;
  const displayRows = (revision ? candidates.map(fresh => ({...fresh, firstSeen:today.candidates.find(r=>r.symbol===fresh.symbol)?.firstSeen ?? firstSeen.get(fresh.symbol) ?? null, isNew:false})) : today.candidates).map((r) => {
    const fresh = freshBy.get(r.symbol);
    if (revision && fresh) return {...fresh, firstSeen:r.firstSeen, isNew:false, warnings:[...fresh.warnings,'모델 재검토 점수 — 최초 일일 원장·성과 추적은 기존 기록 유지']};
    return r.newsStatus === 'error' && fresh?.newsStatus === 'ok' ? {
      ...r, evidence: fresh.evidence, enrichmentStatus: 'ok',
      risk: fresh.risk.level === 'high' ? fresh.risk : r.risk,
      warnings: [...new Set([...r.warnings, ...fresh.warnings, '뉴스 근거 재조회 완료 — 점수·선정 상태는 최초 일일 원장 기준 (다음 배치부터 재산정)'])],
    } : r;
  });
  if (revision) displayRows.sort((a,b)=>b.score-a.score || a.symbol.localeCompare(b.symbol));
  // Prospective research discovery has its own immutable cohort; never promote
  // unchecked names or mix these outcomes with verified-candidate history.
  const researchDir=path.join(root,'research-ledger');fs.mkdirSync(researchDir,{recursive:true});
  const history=fs.readdirSync(researchDir).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().map(f=>read(path.join(researchDir,f))).filter(l=>l.asOf<asOf);
  const firstResearch=new Map();for(const l of history)for(const r of l.rows)if(!firstResearch.has(r.symbol))firstResearch.set(r.symbol,l.asOf);
  const researchFile=path.join(researchDir,`${asOf}.json`);
  if(!fs.existsSync(researchFile))write(researchFile,{asOf,model:EARLY_MODEL,generatedAt,stage:'research_unverified',rows:candidates.filter(r=>r.researchCandidate).map(r=>({symbol:r.symbol,name:r.name,score:r.score,price:r.price,verification:r.verification,model:r.model}))});
  const researchToday=read(researchFile);const researchDiscoveries=[];const researchSeen=new Set();
  for(const l of [...history,researchToday])for(const r of l.rows){if(researchSeen.has(r.symbol))continue;researchSeen.add(r.symbol);researchDiscoveries.push({...r,asOf:l.asOf,publishedAt:l.generatedAt,stage:'research_unverified',outcomes:Object.fromEntries(EARLY_HORIZONS.map(h=>[h,earlyOutcome({...r,asOf:l.asOf,publishedAt:l.generatedAt},getBars,spyBars,asOf,h)]))});}
  const researchPerformance={method:'원문·희석 검증 대기 연구 후보의 최초 기록부터 별도 전향 추적. 매수 검증·전략 효과 입증이 아님. 기준일 다음 거래일 중 기록 시각 이후 처음 도래하는 미국 정규장 시가·21/63/126일 종가. 장 개시 후 생성한 기록은 이미 지난 시가를 사용하지 않음. 비용 미반영. 누락을 보존하며 완료 표본 평균에는 생존 편향 가능.',discoveries:researchDiscoveries,
    summary:Object.fromEntries(EARLY_HORIZONS.map(h=>{const outcomes=researchDiscoveries.map(r=>r.outcomes[h]);const done=outcomes.filter(o=>o.status==='complete');return[h,{total:outcomes.length,complete:done.length,pending:outcomes.filter(o=>o.status==='pending').length,missing:outcomes.filter(o=>o.status==='missing').length,meanReturn:done.length?done.reduce((a,o)=>a+o.return,0)/done.length:null,meanExcess:done.length?done.reduce((a,o)=>a+o.excess,0)/done.length:null}]}))};
  for(const r of displayRows){const observed=researchSeen.has(r.symbol);r.firstResearchSeen=observed?(firstResearch.get(r.symbol)??asOf):null;r.isNewResearch=Boolean(observed&&!firstResearch.has(r.symbol));}
  const latest = { ...today, model: revision ? EARLY_MODEL : today.model, ledgerModel:today.model, stats:revision ? {...stats,candidates:displayRows.filter(r=>r.status==='candidate').length} : today.stats, candidates: displayRows, enrichment: { generatedAt, newsRequests: stats.newsRequests ?? 0, newsFailures: stats.newsFailures ?? 0 }, rules: EARLY_RULES, performance,
    researchPerformance, refreshedAt: generatedAt, method: '성장 30 + 수익성 25 + 제목 기반 촉매 10 + 가격 소외 최대 15 + 매출 대비 가치 10 + 바닥 구조 10 − 위험 감점. 매출 15% 이상 성장·직전 양의 성장률 대비 가속을 구분하며 감소 기저 회복은 가속 가점에서 제외합니다. 큰 하락 이력은 필수 조건이 아닙니다. 연구 신규와 검증 후보·성과는 별도 기록합니다. 점수는 상승확률·투자 확신이 아닙니다.',
    caveat: '뉴스 제목과 공시 항목은 계약 구속력·규모·첫 상업화의 공식 확인이 아닙니다. 원문 검증 필수. 후보가 없으면 기준을 자동 완화하지 않습니다.' };
  write(path.join(root, 'latest.json'), latest);
  return latest;
}

export async function runEarlyAlpha({ rows, companyBy, getBars, spyBars, asOf, now, outDir, env, fetchImpl, wait, newsBy = new Map() }) {
  const budgetRaw = Number(env.EARLY_NEWS_MAX ?? 80);
  const budget = Number.isFinite(budgetRaw) ? Math.max(0, Math.min(500, Math.floor(budgetRaw))) : 80;
  const eligible = rows.filter((r) => !earlyEligibility(r, companyBy.get(r.symbol), getBars(r.symbol), asOf).excluded.length);
  // Prioritize actual business inflections, not charts or market capitalization rank.
  const pre = eligible.map((row) => ({ row, score: scoreEarlyAlpha({ row, company: companyBy.get(row.symbol), bars: getBars(row.symbol), asOf }).score }));
  pre.sort((a, b) => b.score - a.score || a.row.symbol.localeCompare(b.row.symbol));
  const checkFile=path.join(outDir,'early-alpha','checks.json');const lastChecks=read(checkFile,{});
  const headCount=Math.min(budget,Math.ceil(budget*.4));const head=pre.slice(0,headCount);const remaining=pre.slice(headCount).sort((a,b)=>String(lastChecks[a.row.symbol]?.asOf??'').localeCompare(String(lastChecks[b.row.symbol]?.asOf??''))||b.score-a.score||a.row.symbol.localeCompare(b.row.symbol));
  const selected=[...head,...remaining.slice(0,budget-head.length)];
  const checked = new Map(); let requests = 0; let failures = 0; const failureCodes = {};
  for (const { row } of selected) {
    try {
      // Fetch 90 days independently: existing setup news covers only 60 days and may have failed.
      const result = await fetchEarlyNews({ symbol: row.symbol, asOf, env, fetchImpl, wait });
      requests++; checked.set(row.symbol, result);
    } catch (e) {
      requests++; failures++; const code = /HTTP (\d+)/.exec(String(e?.message))?.[1] ?? 'network';
      failureCodes[code] = (failureCodes[code] ?? 0) + 1;
      checked.set(row.symbol, { news: [], status: 'error' });
    }
    lastChecks[row.symbol]={asOf,status:checked.get(row.symbol).status};
  }
  write(checkFile,lastChecks);
  const filingRaw=Number(env.EARLY_FILINGS_MAX??30);
  const filingBudget=env.FINNHUB_API_KEY?Math.max(0,Math.min(80,Number.isFinite(filingRaw)?Math.floor(filingRaw):30)):0;
  let filingRequests=0,filingFailures=0;
  const filingGate=throttle(Number(env.FINNHUB_MIN_INTERVAL_MS??1100));
  for(const {row}of selected.slice(0,filingBudget)){
    const original=companyBy.get(row.symbol);if(original?.source==='SEC')continue;
    filingRequests++;
    try{await filingGate();const r=await fetchEarlyFilings({symbol:row.symbol,asOf,env,fetchImpl,wait});companyBy.set(row.symbol,{...original,filings:[...(original?.filings??[]),...r.filings].filter((f,i,a)=>a.findIndex(x=>(x.accession??x.url)===(f.accession??f.url)&&x.form===f.form)===i).sort((a,b)=>String(b.acceptedAt??b.filingDate).localeCompare(String(a.acceptedAt??a.filingDate))),filingCheck:{...r.check,checkedAt:new Date(now).toISOString()}});}
    catch(e){filingFailures++;companyBy.set(row.symbol,{...original,filingCheck:{status:'error',source:'Finnhub SEC filings',checkedAt:new Date(now).toISOString()}});if(e.fatal||/HTTP (401|403)/.test(e.message))break;}
  }
  const candidates = pre.map(({ row }) => scoreEarlyAlpha({ row, company: companyBy.get(row.symbol), bars: getBars(row.symbol),
    news: checked.get(row.symbol)?.news ?? newsBy.get(row.symbol) ?? [], newsStatus: checked.get(row.symbol)?.status ?? 'not_checked', asOf }))
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const stats = { scanned: rows.length, eligible: eligible.length, candidates: candidates.filter((r) => r.status === 'candidate').length,researchCandidates:candidates.filter(r=>r.researchCandidate).length,filingRequests,filingFailures,filingMetadata:candidates.filter(r=>r.verification?.filings==='metadata_received').length,unverifiedRisk:candidates.filter(r=>!r.risk.checked).length, newsRequests: requests, newsFailures: failures, newsFailureCodes: failureCodes, newsTruncated: [...checked.values()].filter((x) => x.status === 'truncated').length, newsBudget: budget };
  return publishEarlyAlpha({ candidates, outDir, asOf, generatedAt: new Date(now).toISOString(), getBars, spyBars, stats });
}
