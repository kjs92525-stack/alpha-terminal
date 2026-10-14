import test from 'node:test';
import assert from 'node:assert/strict';
import { businessStory,businessTickers } from '../packages/analysis/business-stories.mjs';
test('business explanations never leak into older snapshots and expire without review',()=>{
 assert.equal(businessStory('WLDN','2026-10-13'),null);
 assert.ok(businessStory('WLDN','2026-10-14'));
 assert.equal(businessStory('WLDN','bad'),null);
 assert.equal(businessStory('WLDN','2027-05-01'),null);
 assert.equal(businessStory('UNKNOWN','2026-10-14'),null);
});
test('every current editorial profile carries a distinct business, primary link and testable failure',()=>{
 const rows=businessTickers().map(t=>businessStory(t,'2026-10-14'));
 assert.equal(rows.length,104);assert.equal(new Set(rows.map(r=>r.business)).size,104);
 for(const r of rows){assert.ok(r.url.startsWith('https://'));assert.ok(r.demand.length>20);assert.ok(r.risk.length>20);assert.ok(r.indicators.length>=3);assert.match(r.interpretation,/조건부/);assert.match(r.limitation,/별개/);}
});
test('changed identities and economic models do not reuse old business or generic industrial metrics',()=>{
 const move=businessStory('MOVE','2026-10-14'),dch=businessStory('DCH','2026-10-14');
 assert.equal(move.model,'infrastructure');assert.match(move.risk,/합병 전/);assert.match(dch.risk,/새 결합/);
 assert.equal(businessStory('ATOM','2026-10-14').model,'licensing');
 assert.match(businessStory('MPB','2026-10-14').economics,/은행의 안전성/);
 assert.match(businessStory('ABTC','2026-10-14').economics,/주당/);
 assert.match(businessStory('TWFG','2026-10-14').risk,/직접 인수/);
 assert.match(businessStory('PCT','2026-10-14').risk,/수율/);
});
test('a new financial period keeps business context without promoting an unverified quarterly thesis',()=>{
 const stable=businessStory('RDVT','2026-10-14'),next=businessStory('RDVT','2026-11-10');
 assert.equal(stable.business,next.business);assert.match(next.limitation,/최신 분기 실적의 원문 검증과 별개/);
});
