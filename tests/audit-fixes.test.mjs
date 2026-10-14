import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {scoreEarlyAlpha} from '../packages/analysis/early-alpha.mjs';
import {cyclePhase} from '../packages/analysis/cycle.mjs';
import {storySignals} from '../packages/analysis/story.mjs';
import {fetchEarlyFilings,runEarlyAlpha,earlyOutcome} from '../packages/pipeline/early-alpha.mjs';
import {industrialCycle} from '../packages/analysis/industrial-cycle.mjs';
import {positionRisk,equityScenario} from '../packages/analysis/decision-tools.mjs';
const asOf='2026-10-13',DAY=86400000,stamp=Date.parse(asOf)/1000;
const bars=Array.from({length:300},(_,i)=>({time:stamp-(299-i)*86400,open:10,close:10,high:10.1,low:9.9,volume:i<279?2e6:1e6}));
const p=(end,value,filed='2026-08-01')=>({end,value,filed,form:'10-Q'});
const row={symbol:'EARL',ticker:'EARL',name:'Research fixture',sector:'Industrials'};
const company={source:'SEC',fetchedAt:asOf,filings:[],facts:{sharesOutstanding:p(asOf,30e6,asOf),revenue:p('2026-06-30',400e6),cash:p('2026-06-30',20e6),operatingCashFlow:p('2026-06-30',1e6),revenueQuarterly:[p('2025-03-31',100e6),p('2025-06-30',100e6),p('2026-03-31',110e6),p('2026-06-30',140e6)],netIncomeQuarterly:[]}};
test('flat prices can reveal an inflection; negative-base +1% recovery cannot become a growth candidate',()=>{
 const r=scoreEarlyAlpha({row,company,bars,asOf,newsStatus:'ok'});assert.equal(r.status,'candidate');assert.equal(r.researchCandidate,true);assert.ok(!r.excluded.some(x=>/고점/.test(x)));
 assert.equal(scoreEarlyAlpha({row,company:{...company,fetchedAt:'2026-10-08'},bars,asOf,newsStatus:'ok'}).status,'watch');
 assert.equal(scoreEarlyAlpha({row,company:{...company,facts:{...company.facts,operatingCashFlow:p('2025-12-31',1e6,'2026-02-01')}},bars,asOf,newsStatus:'ok'}).status,'watch');
 const c=structuredClone(company);c.facts.revenueQuarterly[2].value=80e6;c.facts.revenueQuarterly[3].value=101e6;
 const low=scoreEarlyAlpha({row,company:c,bars:bars.map((b,i)=>({...b,high:i===80?15:b.high})),asOf,newsStatus:'ok'});
 assert.equal(low.components.growth,0);assert.equal(low.researchCandidate,false);assert.notEqual(low.status,'candidate');assert.ok(low.warnings.some(w=>/기저/.test(w)));
});
test('extended rebounds lose early status and sharp weakness is not a neutral pause',()=>{
 const series=xs=>xs.map((v,i)=>({time:stamp-(xs.length-1-i)*86400,open:v,close:v,high:v*1.01,low:v*.99,volume:1e6}));
 const spy=series(Array.from({length:600},(_,i)=>400+i*.1));
 const extended=Array.from({length:300},(_,i)=>100-i*.15).concat(Array.from({length:200},(_,i)=>55+3*Math.sin(i/10)),Array.from({length:100},(_,i)=>55+i*.12));
 const e=cyclePhase(series(extended),spy);assert.notEqual(e.phase,'EARLY');assert.ok(e.warnings.length);assert.ok(e.earlyScore>=0&&e.earlyScore<=100);
 const weak=Array.from({length:500},(_,i)=>100+i*.04).concat(Array.from({length:90},(_,i)=>120+i*.1),Array.from({length:10},(_,i)=>130-i*4));
 const w=cyclePhase(series(weak),spy);assert.ok(w.metrics.vs200<-.1);assert.ok(w.metrics.ma50vs200>-.02);assert.equal(w.phase,'DOWN');
});
test('review-capped profit cannot retain an operating turnaround conclusion; future headlines score nothing',()=>{
 const f={...company.facts,netIncomeQuarterly:[p('2025-06-28',-5.2e6),p('2026-06-27',.9e6)]};
 const s=storySignals({ticker:'KOPN',fundamentals:f,asOf});assert.doesNotMatch(s.narrative.takeaway,/흑자 전환 초기|이미 흑자/);assert.match(s.narrative.takeaway,/본업 반복 이익/);
 const future=storySignals({fundamentals:null,asOf,news:Array.from({length:5},(_,i)=>({time:'2026-10-20',headline:'AI contract win '+i}))});assert.equal(future.storyScore,0);assert.deepEqual(future.themes,[]);assert.equal(future.newsCount.week,0);
});
test('filings fallback bounds dates, flags registration and remains a metadata-only check',async()=>{
 const r=await fetchEarlyFilings({symbol:'EARL',asOf,env:{FINNHUB_API_KEY:'test',FINNHUB_MIN_INTERVAL_MS:'0'},wait:async()=>{},fetchImpl:async url=>{
  const u=new URL(url);assert.equal(u.searchParams.get('to'),asOf);assert.equal(u.searchParams.get('from'),'2025-10-13');
  return Response.json([{form:'S-3',accessNumber:'A',filedDate:'2026-10-01',reportUrl:'https://www.sec.gov/a'},{form:'S-3',accessNumber:'B',filedDate:'2026-10-14',reportUrl:'https://www.sec.gov/b'}]);
 }});
 assert.equal(r.filings.length,1);assert.equal(r.filings[0].category,'DILUTION');assert.equal(r.check.status,'metadata_received');assert.equal(r.check.documents,'unreviewed');
});
test('research discovery has immutable separate cohorts and rotates news outside the priority head',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-audit-'));
 try{
  const rows=[row,{...row,symbol:'Z1'},{...row,symbol:'Z2'}],seen=[];
  const args={rows,companyBy:new Map(rows.map(r=>[r.symbol,{...company,source:'Finnhub'}])),getBars:()=>bars,spyBars:bars,asOf,now:Date.parse(asOf),outDir:dir,env:{EARLY_NEWS_MAX:'2'},wait:async()=>{},fetchImpl:async url=>{seen.push(new URL(url).searchParams.get('symbols'));return Response.json({news:[],next_page_token:null});}};
  const one=await runEarlyAlpha(args);assert.deepEqual(seen,['EARL','Z1']);assert.equal(one.stats.candidates,0);assert.equal(one.stats.researchCandidates,3);assert.equal(one.researchPerformance.discoveries.length,3);assert.equal(one.performance.discoveries.length,0);
  const file=path.join(dir,'early-alpha','research-ledger',asOf+'.json'),before=fs.readFileSync(file,'utf8');seen.length=0;const two=await runEarlyAlpha(args);
  assert.deepEqual(seen,['EARL','Z2']);assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(two.researchPerformance.discoveries.length,3);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('publication after the opening cannot enter retroactively and NY daylight saving is respected',()=>{
 const sessions=['2026-10-13','2026-10-14'].map(d=>({...bars[0],time:Date.parse(d)/1000}));
 const r=earlyOutcome({symbol:'EARL',asOf:'2026-10-12',publishedAt:'2026-10-13T13:45:00Z'},()=>sessions,sessions,'2026-10-14',1);assert.equal(r.entryDate,'2026-10-14');
 const winter=['2026-02-10','2026-02-11'].map(d=>({...bars[0],time:Date.parse(d)/1000}));
 assert.equal(earlyOutcome({symbol:'EARL',asOf:'2026-02-09',publishedAt:'2026-02-10T14:15:00Z'},()=>winter,winter,'2026-02-11',1).entryDate,'2026-02-10');
});
test('industrial observations do not pretend to provide a complete physical cycle or leak forecasts',()=>{
 assert.equal(industrialCycle('semicap','2026-07-13').stage,'MISSING');const s=industrialCycle('semicap',asOf);assert.equal(s.stage,'PARTIAL');assert.equal(s.observations[0].kind,'forecast');assert.ok(s.missing.length>=4);
 const f=industrialCycle('grid',asOf,{POWL:{company:{period:'2026-12-31',growth:1,source:'fixture'}}});assert.equal(f.companies.length,0);
});
test('valuation is explicitly hypothetical; share dilution lowers the scenario and invalid inputs have no value',()=>{
 const i={price:10,marketCap:1e9,revenue:2e9,netMargin:.1,pe:15};const a=equityScenario(i),b=equityScenario({...i,shareGrowth:.2});assert.equal(a.fairPrice,30);assert.equal(b.fairPrice,25);assert.equal(b.safetyMargin,.6);assert.equal(a.assumptionOnly,true);
 assert.equal(equityScenario({...i,netMargin:-.1}),null);assert.equal(equityScenario({...i,marketCap:NaN}),null);
});
test('position size respects account, remaining cash, portfolio, sector, liquidity and a gap stress',()=>{
 const input={balance:10000,riskPercent:.5,entry:10,stop:9,adv20:1e6};const p=positionRisk(input);assert.equal(p.quantity,50);assert.equal(p.loss,50);assert.ok(p.gapStressLoss>p.loss);
 assert.equal(positionRisk({...input,cashAvailable:250}).quantity,25);assert.equal(positionRisk({...input,adv20:10000}).quantity,10);
 assert.equal(positionRisk({...input,openRisk:200}).valid,false);assert.equal(positionRisk({...input,sectorExposure:2500}).valid,false);assert.equal(positionRisk({...input,stop:11}).valid,false);
});
