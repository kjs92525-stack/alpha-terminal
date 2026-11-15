import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCycleResearch,cycleResearchTickers} from '../packages/analysis/next-cycle-research.mjs';

const now=Date.parse('2026-11-15T12:00:00Z');
const base={symbol:'PDYN',filed:'2026-11-10',prevYoY:4.69,revYoY:8.95,niImproved:false,ret63:-.5224,posIn52w:.0586,dilution:null,dilutionChecked:false};
const sector={sector:'Industrials'};
test('all current candidate and watch names have distinct business, earnings bridge, tests and primary source',()=>{
  const current='PDYN FEIM SATL AEVA BKSY ASLE AVO SEB COCO MAMA TPB FRPT NWN TLN VST OGE AEE EVRG DJT RUM IMAX AAOI CURI GTN AGPU NRIX NAKA NAMS ALEC FDMT'.split(' ');
  assert.equal(cycleResearchTickers().length,30);
  const rows=current.map(symbol=>buildCycleResearch({...base,symbol},sector,'2026-11-13',now));
  assert.equal(new Set(rows.map(r=>r.profile.business)).size,30);
  for(const {profile:p} of rows){assert.ok(p.business.length>20);assert.ok(p.upside.length>30);assert.ok(p.earnings.length>20);assert.equal(p.confirm.length,3);assert.ok(p.risk.length>30);assert.ok(p.valuation.length>20);for(const s of p.sources)assert.equal(new URL(s.url).protocol,'https:');}
});
test('analysis separates an observed growth spike and weak price from a buy thesis',()=>{
  const r=buildCycleResearch(base,sector,'2026-11-13',now);
  assert.ok(r.observations.some(t=>t.includes('+895.0%')));
  assert.ok(r.observations.some(t=>t.includes('순이익의 전년 동기 개선이 확인되지')));
  assert.ok(r.cautions.some(t=>t.includes('기저')));
  assert.ok(r.cautions.some(t=>t.includes('하락')));
  assert.ok(r.cautions.some(t=>t.includes('위험이 없다는 뜻은 아닙니다')));
  assert.equal(r.status,'조건부 재평가 가설');
  assert.equal(r.reviewAfterSnapshot,true);
});
test('improved net income is not relabeled a profit turnaround; no detected offering is not a clean bill',()=>{
  const r=buildCycleResearch({...base,niImproved:true,dilutionChecked:true},sector,'2026-11-13',now);
  assert.ok(r.observations.some(t=>t.includes('흑자 전환·반복 영업이익 확인과는 다릅니다')));
  assert.ok(r.cautions.some(t=>t.includes('향후 조달')));
  const offering=buildCycleResearch({...base,dilution:'424B'},sector,'2026-11-13',now);
  assert.ok(offering.cautions.some(t=>t.includes('424B')));
});
test('business transitions cannot be used as evidence of healthcare recovery',()=>{
  for(const symbol of ['AGPU','NAKA']){
    const r=buildCycleResearch({...base,symbol},{sector:'Health Care'},'2026-11-13',now);
    assert.equal(r.sectorMismatch,true);assert.equal(r.status,'업종 재검토 필요');
    assert.ok(r.cautions[0].includes('헬스케어 회복 수혜 근거로 사용하지'));
  }
});
test('future filings, unknown businesses, future reviews and expired editorial profiles do not become evidence',()=>{
  const future=buildCycleResearch({...base,filed:'2026-12-01'},sector,'2026-11-13',now);
  assert.ok(!future.observations.some(t=>t.includes('YoY')));
  const unknown=buildCycleResearch({...base,symbol:'NOT_REVIEWED'},sector,'2026-11-13',now);
  assert.equal(unknown.profile,null);assert.equal(unknown.status,'사업 검토 대기');
  const before=buildCycleResearch(base,sector,'2026-11-13',Date.parse('2026-11-14'));
  assert.equal(before.profile,null);
  const expired=buildCycleResearch(base,sector,'2026-11-13',Date.parse('2027-06-01'));
  assert.equal(expired.profile,null);
  const futurePrice=buildCycleResearch(base,sector,'2027-01-01',now);
  assert.equal(futurePrice.observations.length,0);
});
test('primary-source financial evidence is dated and future releases cannot leak into a snapshot',()=>{
  const feim=buildCycleResearch({...base,symbol:'FEIM'},sector,'2026-11-13',now);
  assert.ok(feim.officialFacts[0].text.includes('1억2,900만'));
  assert.ok(feim.officialFacts[0].meaning.includes('납품 일정'));
  assert.deepEqual(buildCycleResearch({...base,symbol:'FEIM'},sector,'2026-09-01',now).officialFacts,[]);
  const coco=buildCycleResearch({...base,symbol:'COCO'},sector,'2026-11-13',now);
  assert.equal(coco.officialFacts[0].kind,'guidance');
  assert.ok(coco.officialFacts[0].meaning.includes('실현된 추가 이익이 아니'));
  assert.deepEqual(buildCycleResearch({...base,symbol:'FEIM'},sector,'2026-11-13',Date.parse('2026-11-14')).officialFacts,[]);
});
