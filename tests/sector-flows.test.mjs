import test from 'node:test';
import assert from 'node:assert/strict';
import {sectorFlowReport} from '../packages/analysis/sector-flows.mjs';
test('reviewed flow window is independent of price returns and hides future/expired reports',()=>{
 for(const day of ['2026-10-14','2026-10-21','invalid'])assert.equal(sectorFlowReport(day).rows.length,0);
 const r=sectorFlowReport('2026-10-15');assert.equal(r.status,'reviewed');assert.equal(r.rows.length,11);assert.equal(r.periodEnd,'2026-10-09');assert.equal(r.rows[0].etf,'XLK');assert.equal(r.rows[0].netMillions,1500);
 assert.ok(r.rows.every((v,i,a)=>!i||a[i-1].netMillions>=v.netMillions));
 assert.match(r.quality,/미완료/);assert.ok(!('price' in r.rows[0]));
});
test('each leading flow story includes a cash transmission path, failure and primary evidence',()=>{
 const rows=sectorFlowReport('2026-10-15').rows.filter(x=>x.story);assert.equal(rows.length,4);
 for(const {story:s} of rows){for(const key of ['story','evidence','profits','check','failure','related'])assert.ok(s[key].length>35);assert.ok(s.sources.length);assert.ok(s.sources.every(x=>x.date<='2026-10-15'&&x.url.startsWith('https://')))}
 assert.match(rows.find(r=>r.etf==='XLE').story.story,/수요를 깎/);
 assert.match(rows.find(r=>r.etf==='XLU').story.failure,/증자/);
});
