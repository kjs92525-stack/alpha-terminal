import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseNasdaqCsv,buildNasdaqContext,parseBlsCpi,macroReading} from '../packages/analysis/market-context.mjs';
import {reviewedMarketEvents} from '../packages/analysis/market-events.mjs';
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
 const f=await publishMarketBrief({barsBy:{QQQ:bars},asOf,now,outDir:tmp,fetchImpl:async()=>{throw Error('offline')}});assert.equal(f.nasdaq.instrument,'QQQ');assert.equal(f.macro,null);assert.equal(f.contextStatus.nasdaq,'error');assert.equal(f.decision.state,'UNKNOWN');
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
