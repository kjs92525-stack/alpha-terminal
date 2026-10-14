import test from 'node:test';
import assert from 'node:assert/strict';
import { demandStory } from '../packages/analysis/demand-stories.mjs';
import { companyDossier } from '../packages/analysis/company-dossier.mjs';
test('product explanations reject future and expired source sets rather than leaking later evidence',()=>{
 assert.equal(demandStory('KOPN','2026-10-07'),null);
 assert.ok(demandStory('KOPN','2026-10-08'));
 assert.equal(demandStory('KOPN','2027-06-01'),null);
 assert.equal(demandStory('ICHR','invalid'),null);
 assert.equal(demandStory('UNKNOWN','2026-10-13'),null);
 for(const ticker of ['ICHR','KOPN','FF','KODK','ARVN','NVT','POWL','UCTT','AVAV']){
  const story=demandStory(ticker,'2026-10-13');
  assert.ok(story);assert.ok(story.sources.every(s=>s.date<='2026-10-13'));
 }
});
test('later product explanation is absent before publication while known financial dossier remains dated',()=>{
 const row={ticker:'KOPN',name:'Kopin',status:'watch',evidence:[],reasons:[],risk:{level:'unknown',checked:false},marketCap:7e8};
 const before=companyDossier(row,'2026-10-07');const after=companyDossier(row,'2026-10-13');
 assert.equal(before.business,null);assert.doesNotMatch(before.mechanism,/AUSA/);
 assert.ok(after.business);assert.equal(after.report.period,'2026-06-27');assert.equal(after.ready,false);
});
