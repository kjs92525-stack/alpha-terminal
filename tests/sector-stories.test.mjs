import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSectorRadar,companyMacro,sectorStory,businessLink } from '../packages/analysis/sector-stories.mjs';
const asOf='2026-10-13';
const group=(etf,phase)=>({etf,phase,phaseKo:phase,metrics:{ret3m:0,rs3m:0,vs200:0}});
test('industrial demand does not force an early price-cycle classification',()=>{
 const r=buildSectorRadar({asOf,groups:[group('SMH','LEADING'),group('ITA','NEUTRAL'),group('PAVE','EARLY')]});
 assert.equal(r.ideas[0].id,'grid');
 assert.match(r.ideas.find(x=>x.id==='semicap').stance,/초입 아님/);
 assert.match(r.ideas.find(x=>x.id==='defense').stance,/미확인/);
 const unknown=buildSectorRadar({asOf});assert.ok(unknown.ideas.every(x=>x.phase==='UNKNOWN'));
});
test('future publications and expired business sources are not presented as evidence',()=>{
 assert.equal(sectorStory('semicap','2026-07-13'),null);
 assert.equal(sectorStory('grid','2027-02-07'),null);
 assert.equal(businessLink('AVAV','2026-09-08'),null);
 assert.equal(companyMacro('ICHR','2027-06-01'),null);
 assert.equal(companyMacro('UNKNOWN',asOf),null);
});
test('related-company warnings retain stale/future quotes, microcaps, large caps and prior rallies',()=>{
 const r=buildSectorRadar({asOf,stocks:{ICHR:{lastDate:asOf,price:51,marketCap:1.8e9,ret63:0},UCTT:{lastDate:asOf,marketCap:3e9,ret63:.8},KOPN:{lastDate:'2026-10-14',marketCap:NaN},AVAV:{lastDate:asOf,marketCap:5e7}}});
 const rows=r.ideas.flatMap(x=>x.related);
 assert.deepEqual(rows.find(x=>x.ticker==='ICHR').warnings,[]);
 assert.ok(rows.find(x=>x.ticker==='UCTT').warnings.some(x=>/급등/.test(x)));
 assert.ok(rows.find(x=>x.ticker==='UCTT').warnings.some(x=>/범위 밖/.test(x)));
 assert.ok(rows.find(x=>x.ticker==='KOPN').warnings.some(x=>/오래됨/.test(x)));
 assert.ok(rows.find(x=>x.ticker==='KOPN').warnings.some(x=>/미확인/.test(x)));
 assert.ok(rows.find(x=>x.ticker==='AVAV').warnings.some(x=>/범위 밖/.test(x)));
});
test('macro company stories preserve conditional transmission paths and company-specific failure modes',()=>{
 for(const t of ['FF','KODK','ARVN','ICHR','KOPN'])assert.ok(companyMacro(t,asOf)?.sector.chain);
 assert.match(companyMacro('KOPN',asOf).link.fact,/제품 매출.*2%/);
 assert.match(companyMacro('ARVN',asOf).sector.world,/조건부/);
 assert.match(companyMacro('FF',asOf).sector.chain,/자동적인 수혜/);
 assert.match(companyMacro('NVT',asOf).link.fact,/확정 고객 주문과 다릅니다/);
});
