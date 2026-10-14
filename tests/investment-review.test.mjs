import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { financialReview } from '../packages/analysis/financial-review.mjs';
import { investmentReview } from '../packages/analysis/investment-review.mjs';
import { scoreEarlyAlpha, EARLY_MODEL } from '../packages/analysis/early-alpha.mjs';
import { publishEarlyAlpha } from '../packages/pipeline/early-alpha.mjs';
import { quarterlyFlow } from '../packages/pipeline/finnhub.mjs';
import { narrate } from '../packages/analysis/story.mjs';
const asOf='2026-10-13';
const point=(end,value)=>({end,value,filed:end==='2026-06-30'?'2026-08-10':end,form:'10-Q'});
const company={source:'SEC',fetchedAt:asOf,filings:[],facts:{sharesOutstanding:point('2026-06-30',5e7),cash:point('2026-06-30',1e8),operatingCashFlow:point('2026-06-30',-1e7),revenue:point('2026-06-30',1e8),revenueQuarterly:[point('2025-03-31',10),point('2025-06-30',10),point('2026-03-31',12),point('2026-06-30',30)],netIncomeQuarterly:[point('2025-06-30',-5),point('2026-06-30',2)]}};
const end=Date.parse(asOf)/1000;const bars=Array.from({length:260},(_,i)=>({time:end-(259-i)*86400,open:10,close:10,high:i<190?20:10.1,low:9,volume:2e5}));
const score=(ticker)=>scoreEarlyAlpha({row:{symbol:ticker,ticker,name:ticker,sector:'Industrials'},company,bars,newsStatus:'ok',asOf});
test('nonrecurring income cannot score as durable growth/turnaround; actual issuance has a sourced penalty',()=>{
  assert.equal(score('ARVN').components.growth,0); assert.equal(score('ARVN').components.profitability,0);
  assert.equal(score('FF').components.profitability,0);
  assert.equal(score('KOPN').components.growth,10); assert.equal(score('KOPN').components.profitability,0);
  assert.equal(score('ICHR').components.penalty,-15); assert.equal(score('ICHR').risk.level,'high');
  assert.equal(score('UNREVIEWED').components.profitability,10);
});
test('review facts reject future publication, stale period and newer quarter',()=>{
  assert.equal(financialReview('FF','2026-08-09','2026-06-30'),null);
  assert.equal(financialReview('FF',asOf,'2026-09-30'),null);
  assert.equal(financialReview('FF','2027-06-01'),null);
});
test('restricted cash excluded; cash and investments explicit; pricing remains incomplete',()=>{
  const input={ticker:'KOPN',asOf,price:4,marketCap:800e6};const r=investmentReview(input);
  assert.equal(r.cash,24.3e6);assert.equal(r.restricted,26e6);assert.equal(r.ready,false);
  assert.match(r.checks[0].text,/영업손실/);
  const ar=investmentReview({...input,ticker:'ARVN'});
  assert.equal(ar.cash,567.9e6);assert.deepEqual(ar.sensitivities,[]);
  assert.equal(investmentReview({...input,demo:true}).verdict,'예시 데이터 · 투자 판정 불가');
  assert.match(investmentReview({...input,status:'excluded',excluded:['현금 부족']}).summary,/현금 부족/);
  assert.equal(investmentReview({...input,ticker:'UNKNOWN'}).cash,null);
  assert.equal(investmentReview({...input,reportPeriod:'2026-09-30'}).cash,null);
});
test('reverse earnings accounts for dilution without inventing valuation or adding cash again',()=>{
  const r=investmentReview({ticker:'FF',asOf,price:10,marketCap:100e6});
  assert.equal(r.sensitivities[0].requiredProfit,10e6);
  assert.equal(r.sensitivities[1].requiredProfit,8e6);
  assert.equal(r.sensitivities[2].requiredProfit,7e6);
  assert.equal(r.ready,false);
});
test('explicit full-year duration derives loss-making Q4 despite positive annual profit',()=>{
  const rows=[['2025-01-01','2025-03-31',10],['2025-04-01','2025-06-30',10],['2025-07-01','2025-09-30',10],['2025-01-01','2025-12-31',10]].map(([start,end,ni],i)=>({year:2025,start,end,ni,filed:end,form:i===3?'10-K':'10-Q'}));
  assert.equal(quarterlyFlow(rows,'ni').at(-1).value,-20);
});
test('nonmonotonic or missing-quarter series never claims consecutive acceleration',()=>{
  for(const yoy of [[{end:'2026-01-01',yoy:0.1},{end:'2026-04-01',yoy:0.05},{end:'2026-07-01',yoy:0.3}],[{end:'2022-01-01',yoy:0.1},{end:'2026-07-01',yoy:0.3}]]){
    const s=narrate({f:{},yoy,ni:[],news:[],themes:[]});assert.ok(!s.lines.some(x=>/연속 빨라/.test(x)));
  }
});
test('model revision updates displayed scores while preserving immutable original cohort',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-ledger-'));
  try{
    const row=score('FF');const args={outDir:dir,asOf,generatedAt:asOf,getBars:()=>[],spyBars:[]};
    publishEarlyAlpha({...args,candidates:[{...row,status:'candidate',score:90}]});
    const file=path.join(dir,'early-alpha','ledger',asOf+'.json');const old=JSON.parse(fs.readFileSync(file));old.model='early-alpha-v1';fs.writeFileSync(file,JSON.stringify(old));const before=fs.readFileSync(file,'utf8');
    const latest=publishEarlyAlpha({...args,candidates:[{...row,status:'watch',score:40}],stats:{candidates:0}});
    assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(latest.candidates[0].score,40);assert.equal(latest.candidates[0].isNew,false);assert.equal(latest.performance.discoveries[0].score,90);assert.equal(latest.model,EARLY_MODEL);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
