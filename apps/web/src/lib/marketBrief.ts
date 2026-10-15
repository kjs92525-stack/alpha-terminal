import { useCallback,useEffect,useState } from 'react';
import { SNAPSHOT_BASE } from './snapshot';
import type { MarketBrief } from '../../../../packages/analysis/market-brief.mjs';
let cached:MarketBrief|null=null,at=0,inflight:Promise<MarketBrief>|null=null;
export function fetchMarketBrief(force=false):Promise<MarketBrief>{
 if(!force&&cached&&Date.now()-at<60000)return Promise.resolve(cached);
 if(inflight)return inflight;
 inflight=fetch(`${SNAPSHOT_BASE}/market-brief/latest.json`,{cache:'no-cache',signal:AbortSignal.timeout(15000)}).then(async r=>{
  if(!r.ok)throw Error('시황 브리핑을 불러오지 못했습니다.');const d=await r.json();
  if(d.model!=='market-brief-v1'||!['WAIT','UNKNOWN','LIMIT','SELECTIVE'].includes(d.decision?.state)||!Array.isArray(d.story?.paragraphs)||!Array.isArray(d.decision?.reasons)||!Array.isArray(d.decision?.actions)||!Array.isArray(d.sectors)||!Array.isArray(d.resume)||!Array.isArray(d.news)||!Array.isArray(d.sources)||!d.metrics||!d.credit)throw Error('시황 자료 형식 확인이 필요합니다.');
  cached=d;at=Date.now();return d as MarketBrief;
 }).catch(e=>{cached=null;at=0;throw e}).finally(()=>{inflight=null});return inflight;
}
export function useMarketBrief(){
 const[data,setData]=useState<MarketBrief|null>(cached),[error,setError]=useState(''),[loading,setLoading]=useState(true),[now,setNow]=useState(Date.now());
 const refresh=useCallback(()=>{setLoading(true);setError('');return fetchMarketBrief(true).then(setData).catch(e=>{setData(null);setError(e.message)}).finally(()=>{setLoading(false);setNow(Date.now())})},[]);
 useEffect(()=>{let alive=true;fetchMarketBrief().then(d=>{if(alive)setData(d)}).catch(e=>{if(alive){setData(null);setError(e.message)}}).finally(()=>{if(alive)setLoading(false)});const onVisible=()=>{setNow(Date.now());if(document.visibilityState==='visible')void refresh()};document.addEventListener('visibilitychange',onVisible);const clock=setInterval(()=>setNow(Date.now()),60000);const poll=setInterval(()=>{if(document.visibilityState==='visible')void refresh()},15*60000);return()=>{alive=false;document.removeEventListener('visibilitychange',onVisible);clearInterval(clock);clearInterval(poll)}},[refresh]);
 return {data,error,loading,now,refresh};
}
