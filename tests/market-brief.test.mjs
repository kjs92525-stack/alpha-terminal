import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {buildMarketBrief,marketMetrics,marketBreadth,briefingFreshness,MARKET_ETFS} from '../packages/analysis/market-brief.mjs';
import {parseVix,parseFredVix,selectMarketNews,runMarketBrief,publishMarketBrief} from '../packages/pipeline/market-brief.mjs';
const asOf='2026-10-14',now=Date.parse('2026-10-15T01:45:00Z'),end=Date.parse(asOf)/1000;
const bars=(slope=0.1)=>Array.from({length:280},(_,i)=>({time:end-(279-i)*86400,close:100+i*slope,open:100+i*slope,high:101+i*slope,low:99+i*slope,volume:1e6}));
const good=()=>Object.fromEntries(MARKET_ETFS.map(s=>[s,bars(s==='HYG'||s==='LQD'?0.01:0.1)]));
const breadth={asOf,sample:1000,universe:2000,coverage:0.5,above50:0.7,above200:0.6};
const build=(changes={})=>buildMarketBrief({barsBy:good(),breadth,vix:{asOf,close:18},asOf,now,...changes});
test('healthy confirmed market permits selective review; weak small-cap breadth waits',()=>{
 const a=build();assert.equal(a.decision.state,'SELECTIVE');assert.match(a.holding,/일괄/);assert.match(a.caveat,/검증된 전략이 아닙니다/);
 const b=good();b.IWM=bars(-0.1);const d=build({barsBy:b,breadth:{...breadth,above50:0.2}});assert.equal(d.decision.state,'WAIT');assert.match(d.decision.reasons.join(' '),/소형주/);
});
test('crash blocks new risk, while isolated high VIX only reduces risk',()=>{
 const b=good();b.SPY.at(-1).close*=0.9;assert.equal(build({barsBy:b}).decision.state,'WAIT');
 assert.equal(build({vix:{asOf,close:40}}).decision.state,'LIMIT');
 assert.equal(build({vix:{asOf,close:40},breadth:{...breadth,above50:0.4}}).decision.state,'WAIT');
});
test('future bars cannot change snapshots; an unfinished US session is not final',()=>{
 const b=good();const before=build({barsBy:b});b.SPY.push({...b.SPY.at(-1),time:end+86400,close:1});assert.deepEqual(build({barsBy:b}),before);
 assert.equal(marketMetrics(b.SPY,'2026-10-15',Date.parse('2026-10-15T17:00Z')).asOf,asOf);
 assert.equal(marketMetrics(b.SPY,'2026-10-16',Date.parse('2026-10-15T17:00Z')).asOf,asOf);
});
test('missing history, stale dates and insufficient breadth never turn green or fabricate breadth stress',()=>{
 for(const override of [{breadth:null},{breadth:{...breadth,asOf:'2026-10-13'}},{breadth:{...breadth,sample:2,above50:0}},{breadth:{...breadth,coverage:NaN}},{barsBy:{}}])assert.equal(build(override).decision.state,'UNKNOWN');
 assert.equal(build({vix:{asOf:'2026-10-13',close:10}}).decision.state,'LIMIT');
 assert.equal(briefingFreshness(build(),now+37*3600000).fresh,false);
 assert.equal(briefingFreshness({...build(),generatedAt:new Date(now+3600000).toISOString()},now).fresh,false);
 assert.equal(build({asOf:'2026-10-01'}).decision.state,'UNKNOWN');
});
test('re-entry requires three sessions and long-term breadth, not one rebound',()=>{
 const b=good();b.IWM.at(-2).close=1;assert.equal(build({barsBy:b}).decision.state,'LIMIT');
 assert.equal(build({breadth:{...breadth,above200:0.2}}).decision.state,'LIMIT');
});
test('breadth deduplicates symbols and excludes stale, illiquid and insufficient histories',()=>{
 const b=bars(),stale=b.slice(0,-1),illiquid=b.map(x=>({...x,volume:1}));
 const d=marketBreadth({symbols:['A','A','B','C','D'],getBars:s=>({A:b,B:stale,C:illiquid,D:[]})[s],asOf,now});assert.equal(d.sample,1);assert.equal(d.universe,4);assert.equal(d.above50,1);assert.equal(d.advancing,1);
});
test('VIX preserves date; news is dated, unique, relevant and never a causal market input',()=>{
 assert.equal(parseVix('DATE,OPEN,HIGH,LOW,CLOSE\n10/13/2026,1,2,1,19\n10/14/2026,1,2,1,20\n10/15/2026,1,2,1,90',asOf).close,20);
 assert.equal(parseVix('error',asOf),null);const rows=[{datetime:now/1000,headline:'Fed rate expectations change',source:'Reuters',url:'https://example.com/a'},{datetime:now/1000,headline:'Oil war risks rise',source:'Reuters',url:'https://example.com/b'},{datetime:now/1000+3600,headline:'Fed future',source:'CNBC',url:'https://example.com/future'}];
 assert.equal(parseFredVix('observation_date,VIXCLS\n2026-10-13,19\n2026-10-14,.\n2026-10-15,50',asOf).asOf,'2026-10-13');
 const news=selectMarketNews(rows,now);assert.equal(news.length,1);assert.equal(news[0].confidence,'headline_only');assert.equal(build({news}).decision.state,build().decision.state);
});
test('daily publisher writes KST history and replaces old positive state safely on collection failure',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'market-brief-'));try{
 const success=await publishMarketBrief({barsBy:good(),breadth,asOf,outDir:tmp,now,fetchImpl:async()=>new Response('DATE,OPEN,HIGH,LOW,CLOSE\n10/14/2026,1,2,1,18')});assert.equal(success.decision.state,'SELECTIVE');assert.ok(fs.existsSync(path.join(tmp,'market-brief/history/2026-10-15.json')));
 const d=await runMarketBrief({outDir:tmp,env:{},now,wait:async()=>{},fetchImpl:async()=>{throw Error('offline')}});assert.equal(d.decision.state,'UNKNOWN');assert.equal(JSON.parse(fs.readFileSync(path.join(tmp,'market-brief/latest.json'),'utf8')).decision.state,'UNKNOWN');
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
test('FRED fallback preserves publication lag and attributes Cboe observations instead of inventing same-day VIX',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vix-fallback-'));try{
 for(const date of ['2026-10-13',asOf]){const d=await publishMarketBrief({barsBy:good(),breadth,asOf,outDir:tmp,now,fetchImpl:async url=>new Response(String(url).includes('fredgraph.csv')?`observation_date,VIXCLS\n${date},18`:'<html>challenge</html>')});
 assert.equal(d.vixObserved.asOf,date);assert.equal(d.decision.state,date===asOf?'SELECTIVE':'LIMIT');assert.ok(d.sources.some(s=>s.url.includes('fred.stlouisfed.org')));}
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
