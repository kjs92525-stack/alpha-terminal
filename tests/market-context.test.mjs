import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseNasdaqCsv,buildNasdaqContext,parseBlsCpi,parseFredCpi,macroReading} from '../packages/analysis/market-context.mjs';
import {reviewedMarketEvents,reviewedCpi} from '../packages/analysis/market-events.mjs';
import {buildMarketBrief,MARKET_ETFS} from '../packages/analysis/market-brief.mjs';
import {publishMarketBrief,selectMarketNews} from '../packages/pipeline/market-brief.mjs';
const now=Date.parse('2026-10-15T05:00Z'),asOf='2026-10-14',end=Date.parse(asOf)/1000;
const bars=Array.from({length:280},(_,i)=>({time:end-(279-i)*86400,close:100+i,volume:1e6}));
const cpi=`<html>8:30 a.m. (ET) Wednesday, October 14, 2026 CONSUMER PRICE INDEX - SEPTEMBER 2026 The Consumer Price Index for All Urban Consumers (CPI-U) increased 0.6 percent on a seasonally adjusted basis in September. Over the last 12 months, the all items index increased 3.7 percent before seasonal adjustment. The index for all items less food and energy rose 0.3 percent in September. The all items less food and energy index rose 2.6 percent over the year. Table A.</html>`;
test('Nasdaq CSV rejects invalid values, future dates and wrong series; deduplicates without synthetic candles',()=>{
 const b=parseNasdaqCsv('observation_date,NASDAQCOM\n2026-10-13,.\n2026-10-14,26692.87\n2026-10-14,26692.87\n2026-10-15,1\n2026-99-01,1',asOf);assert.deepEqual(b,[{time:end,close:26692.87}]);assert.deepEqual(parseNasdaqCsv('DATE,VIXCLS\n2026-10-14,18',asOf),[]);
});
test('close chart computes moving averages and RSI without future leakage; proxy and delayed index remain explicit',()=>{
 const a=buildNasdaqContext({bars,asOf,now});assert.equal(a.instrument,'NASDAQCOM');assert.equal(a.metrics.ma20,369.5);assert.equal(a.metrics.ma50,354.5);assert.equal(a.metrics.rsi14,100);assert.equal(a.metrics.priorHigh20,378);assert.equal(a.metrics.drawdown252,0);assert.equal(a.series[0].ma200,null);assert.ok(!('volume' in a.series[0]));
 assert.deepEqual(buildNasdaqContext({bars:[...bars,{time:end+86400,close:1}],asOf,now}),a);
 const delayed=buildNasdaqContext({bars:bars.slice(0,-1),qqqBars:bars,asOf,now});assert.equal(delayed.instrument,'NASDAQCOM');assert.equal(delayed.delayed,true);assert.match(delayed.paragraphs[0],/공표가 지연/);
 const fallback=buildNasdaqContext({qqqBars:bars,asOf,now});assert.equal(fallback.instrument,'QQQ');assert.match(fallback.title,/대체/);assert.equal(buildNasdaqContext({bars:bars.slice(0,3),asOf,now}),null);
 const flat=buildNasdaqContext({bars:bars.map(b=>({...b,close:10})),asOf,now});assert.equal(flat.metrics.rsi14,50);
});
test('BLS parser preserves monthly/annual and seasonal bases, real release time, rejects stale/future or changed layout',()=>{
 const d=parseBlsCpi(cpi,now);assert.equal(d.publishedAt,'2026-10-14T12:30:00.000Z');assert.equal(d.period,'2026-09');assert.equal(d.headlineMonthly,0.6);assert.equal(d.coreAnnual,2.6);assert.match(macroReading(d).fact,/季|계절조정/);assert.match(macroReading(d).counterpoint,/확정하지/);
 assert.equal(parseBlsCpi(cpi,Date.parse('2026-10-14T12:29Z')),null);assert.equal(parseBlsCpi(cpi,now+46*86400000),null);assert.equal(parseBlsCpi('<html>Access Denied</html>',now),null);assert.equal(parseBlsCpi(cpi.replace('CPI-U)','WRONG)'),now),null);
 const winter=cpi.replace('October 14, 2026','December 14, 2026');assert.equal(parseBlsCpi(winter,Date.parse('2026-12-15')).publishedAt,'2026-12-14T13:30:00.000Z');
});
test('reviewed news is unavailable before review or after expiry and never pretends to be live automated analysis',()=>{
 assert.equal(reviewedMarketEvents(Date.parse('2026-10-14T19:00Z')).length,0);assert.equal(reviewedMarketEvents(now).length,2);assert.equal(reviewedMarketEvents(now+7*86400000).length,0);assert.match(reviewedMarketEvents(now)[0].classification,/자동 속보 아님/);
});
test('growth shock is checked independently of SPY and long-term averages',()=>{
 const barsBy=()=>Object.fromEntries(MARKET_ETFS.map(s=>[s,bars.map(x=>({...x}))]));const base={asOf,now,breadth:{asOf,sample:1000,coverage:0.5,above50:0.7,above200:0.7},vix:{asOf,close:18}};
 let b=barsBy();b.QQQ.at(-1).close*=0.96;assert.equal(buildMarketBrief({...base,barsBy:b}).decision.state,'WAIT');
 b=barsBy();b.QQQ[b.QQQ.length-6].close=b.QQQ.at(-1).close/0.96;assert.equal(buildMarketBrief({...base,barsBy:b}).decision.state,'LIMIT');
});
test('news relevance outranks recency and irrelevant layoffs do not count as macro jobs data',()=>{
 const row=(headline,url,datetime)=>({headline,url,datetime,source:'Reuters'});const r=selectMarketNews([row('Russia war diplomacy','https://example.com/a',now/1000),row('CPI inflation rises','https://example.com/b',now/1000-3600)],now);assert.equal(r[0].headline,'CPI inflation rises');assert.equal(selectMarketNews([row('Former boss cuts jobs','https://example.com/c',now/1000)],now).length,0);
});
test('publisher adds independently sourced context; unavailable optional sources do not fabricate an index or CPI',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'context-'));const csv='observation_date,NASDAQCOM\n'+bars.map(x=>`${new Date(x.time*1000).toISOString().slice(0,10)},${x.close}`).join('\n');
 try{const d=await publishMarketBrief({barsBy:{QQQ:bars},asOf,now,outDir:tmp,fetchImpl:async url=>new Response(String(url).includes('NASDAQCOM')?csv:String(url).includes('bls.gov')?cpi:'error')});assert.equal(d.nasdaq.instrument,'NASDAQCOM');assert.equal(d.macro.period,'2026-09');assert.equal(d.contextStatus.cpi,'ok');
 const f=await publishMarketBrief({barsBy:{QQQ:bars},asOf,now:Date.parse('2026-10-18T05:00Z'),outDir:tmp,fetchImpl:async()=>{throw Error('offline')}});assert.equal(f.nasdaq.instrument,'QQQ');assert.equal(f.macro,null);assert.equal(f.contextStatus.nasdaq,'error');assert.equal(f.decision.state,'UNKNOWN');
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});

test('verified CPI fallback is dated, short lived and distinguishes blocked collection from a live successful fetch',async()=>{
 assert.equal(reviewedCpi(Date.parse('2026-10-14')),null);assert.equal(reviewedCpi(Date.parse('2026-10-18')),null);assert.equal(reviewedCpi(now).collection,'reviewed_snapshot');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cpi-reviewed-'));try{const d=await publishMarketBrief({barsBy:{},asOf,now,outDir:tmp,fetchImpl:async()=>new Response('Access denied',{status:403})});assert.equal(d.contextStatus.cpi,'reviewed_snapshot');assert.equal(d.macro.headlineAnnual,3.7);assert.match(d.macro.source,/검토본/);assert.equal(d.macro.collection,'reviewed_snapshot');}finally{fs.rmSync(tmp,{recursive:true,force:true})}
});

test('CPI fallback from FRED: changes from index levels, valid only between release window and the next one',()=>{
 const rows=[['2025-09-01',100,100,100,100],['2026-08-01',103.0,103.5,102.4,102.6],['2026-09-01',103.62,103.7,102.71,102.67]];
 const csv='observation_date,CPIAUCSL,CPIAUCNS,CPILFESL,CPILFENS\n'+rows.map(r=>r.join(',')).join('\n');
 const now=Date.parse('2026-10-18T00:00:00Z'),d=parseFredCpi(csv,now);
 assert.equal(d.period,'2026-09');assert.equal(d.headlineMonthly,0.6);assert.equal(d.headlineAnnual,3.7);assert.equal(d.coreMonthly,0.3);assert.equal(d.coreAnnual,2.7);
 assert.equal(d.publishedAt,null);assert.equal(d.collection,'fred_derived');assert.equal(d.expiresAt,'2026-11-20T00:00:00.000Z');
 assert.match(macroReading(d).fact,/FRED에 실린 BLS 지수로 계산한 2026-09 CPI/);
 assert.equal(parseFredCpi(csv,Date.parse('2026-11-20T00:00:00Z')),null,'next release should exist by now');
 assert.equal(parseFredCpi(csv,Date.parse('2026-10-05T00:00:00Z'))?.period,undefined,'September cannot be out before ~Oct 8 and August has no year-ago row');
 assert.equal(parseFredCpi(csv.replace('103.62','.'),now),null,'missing value');
 assert.equal(parseFredCpi('<html>blocked</html>',now),null);assert.equal(parseFredCpi(csv.replace('CPILFENS','OTHER'),now),null);
});

test('pipeline: reviewed CPI snapshot wins while valid; after it expires FRED keeps CPI instead of dropping it',async()=>{
 const csv='observation_date,CPIAUCSL,CPIAUCNS,CPILFESL,CPILFENS\n2025-09-01,100,100,100,100\n2026-08-01,103.0,103.5,102.4,102.6\n2026-09-01,103.62,103.7,102.71,102.67';
 const fetchImpl=async url=>String(url).includes('CPIAUCSL')?new Response(csv):new Response('Access denied',{status:403});
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cpi-fred-'));
 try{
  const during=await publishMarketBrief({barsBy:{},asOf,now,outDir:tmp,fetchImpl});
  assert.equal(during.macro.collection,'reviewed_snapshot');assert.equal(during.contextStatus.cpi,'reviewed_snapshot');
  const after=await publishMarketBrief({barsBy:{},asOf,now:Date.parse('2026-10-18T00:00Z'),outDir:tmp,fetchImpl});
  assert.equal(after.macro.collection,'fred_derived');assert.equal(after.contextStatus.cpi,'fred_derived');assert.equal(after.macro.period,'2026-09');
  const none=await publishMarketBrief({barsBy:{},asOf,now:Date.parse('2026-10-18T00:00Z'),outDir:tmp,fetchImpl:async()=>new Response('no',{status:403})});
  assert.equal(none.macro,null);assert.equal(none.contextStatus.cpi,'unavailable');
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
