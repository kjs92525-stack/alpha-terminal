import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMarketSnapshot, groupPerformance, themeMembership,marketCapEstimate } from '../packages/analysis/market-map.mjs';
import { publishCachedMap } from '../scripts/publish-market-map.mjs';

test('market map is independent of trading setups, excludes stale closes, and preserves unknown caps', () => {
  const f={price:100,lastDate:'2026-11-13',mcap:1e9,ret_1:.02,ret_5:.03,ret21:.04,ret63:.05};
  const data=buildMarketSnapshot({rows:[{symbol:'NVDA',features:f},{symbol:'NVDA',features:f},{symbol:'UNKNOWN',features:{...f,mcap:null,ret_1:null}},{symbol:'STALE',features:{...f,lastDate:'2026-11-12'}}],asOf:'2026-11-13',generatedAt:'2026-11-14',universe:4,source:'test'});
  assert.deepEqual(data.stocks.map(s=>s.symbol),['NVDA','UNKNOWN']);
  assert.equal(data.coverage.staleExcluded,1);
  assert.equal(data.coverage.withCap,1);
  assert.equal(data.stocks[1].mcap,null);
  assert.equal(data.stocks[1].ret1,null);
  assert.equal(data.stocks[0].ret21,.04);
});

test('business membership supports overlaps and never derives a theme from a price rise', () => {
  assert.deepEqual(themeMembership('NVDA').map(t=>t.id),['ai','semis']);
  assert.ok(themeMembership('VRT').some(t=>t.id==='power'&&t.group==='전력장비·냉각'));
  assert.ok(themeMembership('ISRG').some(t=>t.id==='robotics'));
  assert.deepEqual(themeMembership('NOTCLASSIFIED'),[]);
});

test('ADR cap uses an observed issuer cap anchor, never ordinary shares times an ADR price',()=>{
  const bars=[{time:Date.parse('2026-11-10')/1000,close:100},{time:Date.parse('2026-11-13')/1000,close:110}];
  const company={source:'Finnhub',facts:{sharesOutstanding:{value:10e9,form:'profile'}}};
  const a=marketCapEstimate({company,profile:{marketCap:100e9,fetchedAt:'2026-11-10T23:00:00Z'},bars,asOf:'2026-11-13'});
  assert.equal(a.mcap,110e9);
  assert.equal(marketCapEstimate({company,profile:null,bars,asOf:'2026-11-13'}).mcap,null);
  assert.equal(marketCapEstimate({company,profile:{marketCap:100e9,fetchedAt:'2026-11-20'},bars,asOf:'2026-11-13'}).mcap,null);
});

test('multiple listed share classes do not double-count issuer cap',()=>{
  const f={price:100,lastDate:'2026-11-13',mcap:1e9,adv20:1e8};
  const map=buildMarketSnapshot({rows:[{symbol:'GOOG',cik:'0001652044',features:f},{symbol:'GOOGL',cik:'1652044',features:{...f,adv20:2e8}}],asOf:'2026-11-13',generatedAt:'2026-11-14',universe:2,source:'test'});
  assert.equal(map.stocks.length,1);assert.equal(map.stocks[0].symbol,'GOOGL');
  assert.deepEqual(map.stocks[0].aliases,['GOOG']);assert.equal(map.coverage.shareClassesExcluded,1);
});

test('weighted returns exclude missing observations and expose the measured count', () => {
  const rows=[{mcap:300,ret1:.1},{mcap:100,ret1:-.1},{mcap:1000,ret1:null},{mcap:null,ret1:.2}];
  const cap=groupPerformance(rows,'ret1','cap');
  assert.ok(Math.abs(cap.value-.05)<1e-12);
  assert.equal(cap.measured,2);
  const equal=groupPerformance(rows,'ret1','equal');
  assert.equal(equal.measured,3);
  assert.ok(Math.abs(equal.value-.2/3)<1e-12);
  assert.equal(groupPerformance([{mcap:100,ret1:null}]).value,null);
});

test('cache refresh publishes only a map and truncates future bars at the published session', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-market-map-'));
  try{
    const dataDir=path.join(dir,'data'),cacheDir=path.join(dir,'cache');
    fs.mkdirSync(path.join(dataDir,'rankings'),{recursive:true});fs.mkdirSync(path.join(dataDir,'companies'));
    fs.mkdirSync(path.join(cacheDir,'bars'),{recursive:true});
    fs.writeFileSync(path.join(dataDir,'latest.json'),JSON.stringify({asOf:'2026-11-13',universe:1,sources:{prices:'fixture'}}));
    fs.writeFileSync(path.join(dataDir,'rankings','2026-11-13.json'),JSON.stringify({rows:[['NVDA','Information Technology']]}));
    const t=Date.parse('2026-11-13')/1000;
    const bars=Array.from({length:260},(_,i)=>[t-(259-i)*86400,100,101,99,100,1000]);
    bars.push([t+86400,1000,1000,1000,1000,1000]);
    fs.writeFileSync(path.join(cacheDir,'bars','NVDA.json'),JSON.stringify(bars));
    const before=fs.readFileSync(path.join(dataDir,'latest.json'),'utf8');
    const coverage=publishCachedMap({cacheDir,dataDir});
    const map=JSON.parse(fs.readFileSync(path.join(dataDir,'market-map.json')));
    assert.equal(coverage.priced,1);assert.equal(map.stocks[0].price,100);
    assert.equal(map.stocks[0].mcap,null);assert.equal(map.stocks[0].ret21,0);
    assert.equal(fs.readFileSync(path.join(dataDir,'latest.json'),'utf8'),before);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('cache refresh refuses missing data instead of publishing an empty successful map', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-market-empty-'));
  try{assert.throws(()=>publishCachedMap({cacheDir:dir,dataDir:dir}),/Published nightly/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
