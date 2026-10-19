import test from 'node:test';
import assert from 'node:assert/strict';
import { companyDossier as dossierAt } from '../packages/analysis/company-dossier.mjs';
// the price-freshness check reads the clock; pin it to the day after the fixtures' as-of date
const companyDossier=(r,asOf)=>dossierAt(r,asOf,Date.parse('2026-10-14T12:00:00Z'));
const row={ticker:'ICHR',name:'Ichor',status:'watch',evidence:[],reasons:[],risk:{level:'unknown',checked:false},marketCap:1.8e9,reportPeriod:'2026-06-26'};
test('company thesis ties economics to price and competing explanations without a buy verdict',()=>{
  const d=companyDossier(row,'2026-10-13');
  assert.equal(d.ready,false);assert.match(d.priceBridge,/120.0M/);assert.match(d.priceBridge,/가정/);
  assert.match(d.evidence,/0.8%포인트/);assert.match(d.disagreement,/ATM/);assert.match(d.verdict,/부족/);
  assert.match(companyDossier({...row,marketCap:900e6},'2026-10-13').priceBridge,/60.0M/);
  assert.doesNotMatch(companyDossier({...row,marketCap:NaN},'2026-10-13').priceBridge,/NaN/);
});
test('editorial dossier disappears for unknown companies, demo, future source, expired or superseding financial quarter',()=>{
  for(const r of [{...row,ticker:'UNKNOWN'},{...row,demo:true},{...row,reportPeriod:'2026-09-30'},{...row,evidence:[{kind:'financial',publishedAt:'2026-10-15',period:'2026-09-30'}]}]) {
    assert.equal(companyDossier(r,'2026-10-16'),null);
  }
  assert.equal(companyDossier(row,'2026-08-01'),null);
  assert.equal(companyDossier(row,'2027-01-01'),null);
});
test('excluded status and stale prices cannot become a favorable current-price conclusion',()=>{
  assert.match(companyDossier({...row,status:'excluded'},'2026-10-13').verdict,/제외/);
  assert.match(companyDossier(row,'2026-09-01').priceBridge,/보류/);
});
test('dossiers distinguish prototype, commodity policy, senior claims and clinical uncertainty',()=>{
  const get=ticker=>companyDossier({...row,ticker,reportPeriod:undefined},'2026-10-13');
  assert.match(get('KOPN').mechanism,/시제품.*보장이 아닙니다/);
  assert.match(get('FF').evidence,/고객 자금 지원/);
  assert.match(get('KODK').price,/우선주/);
  assert.match(get('ARVN').priceBridge,/개발 비용/);
  assert.doesNotMatch(get('ARVN').priceBridge,/15배/);
});
