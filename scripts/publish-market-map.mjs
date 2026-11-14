// Reuse the existing nightly cache and published universe. No provider API calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFeatures } from '../packages/pipeline/features.mjs';
import { buildMarketSnapshot } from '../packages/analysis/market-map.mjs';
const read=(p,fallback=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return fallback;}};
export function publishCachedMap({cacheDir,dataDir,now=new Date().toISOString()}){
  const latest=read(path.join(dataDir,'latest.json'));
  if(!latest?.asOf)throw Error('Published nightly snapshot is required');
  const ranking=read(path.join(dataDir,'rankings',`${latest.asOf}.json`));
  if(!Array.isArray(ranking?.rows))throw Error('Published price universe is required');
  const rows=[];
  for(const [symbol,sector] of ranking.rows){
    const raw=read(path.join(cacheDir,'bars',`${symbol.replace(/[^A-Z0-9.\-]/gi,'_')}.json`));
    if(!raw?.length)continue;
    const bars=raw.map(([time,open,high,low,close,volume])=>({time,open,high,low,close,volume})).filter(b=>b.time<=Date.parse(latest.asOf)/1000);
    const company=read(path.join(dataDir,'companies',`${symbol.replace('.','-')}.json`));
    const f=computeFeatures(bars,company,latest.asOf);if(!f)continue;
    const ret=k=>bars.length>k?bars.at(-1).close/bars.at(-1-k).close-1:null;
    rows.push({symbol,name:company?.name??symbol,sector,features:{...f,ret21:ret(21),ret63:ret(63)}});
  }
  if(rows.length<Math.min(20,ranking.rows.length))throw Error('Nightly bars cache missing or incomplete; wait for the next nightly pipeline');
  const snapshot=buildMarketSnapshot({rows,asOf:latest.asOf,generatedAt:now,universe:latest.universe,source:`${latest.sources?.prices??'Nightly daily bars'} · 기존 캐시 재사용 · 보고 주식 수 기반 추정 시총`});
  fs.writeFileSync(path.join(dataDir,'market-map.json'),JSON.stringify(snapshot));
  return snapshot.coverage;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
  console.log(publishCachedMap({cacheDir:arg('--cache','.pipeline-cache'),dataDir:arg('--data','data-branch')}));
}
