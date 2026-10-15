import fs from 'node:fs';
import { reviewedMarketEvents, reviewedCpi } from '../analysis/market-events.mjs';
import { parseNasdaqCsv, buildNasdaqContext, parseBlsCpi, parseFredCpi, FRED_CPI, macroReading } from '../analysis/market-context.mjs';
import path from 'node:path';
import { MARKET_ETFS,buildMarketBrief } from '../analysis/market-brief.mjs';
import { isDailyBarClosed } from '../analysis/market.mjs';
import { fetchDailyBars } from './alpaca.mjs';
export const VIX_CSV='https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv';
export const FRED_VIX='https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS';
const read=(f,fallback=null)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return fallback}};
const write=(f,x)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(x))};
export function parseVix(text,asOf){
 const lines=String(text).trim().split(/\r?\n/);if(!/^DATE,OPEN,HIGH,LOW,CLOSE/i.test(lines[0]??''))return null;
 const rows=[];for(const l of lines.slice(1)){const[d,,, ,c]=l.split(',');const parts=d?.split('/');if(parts?.length!==3)continue;const date=`${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`,close=Number(c);if(date<=asOf&&Number.isFinite(close)&&close>0)rows.push({asOf:date,close,source:'Cboe VIX daily history',url:VIX_CSV});}return rows.sort((a,b)=>a.asOf.localeCompare(b.asOf)).at(-1)??null;
}
export function parseFredVix(text,asOf){const lines=String(text).trim().split(/\r?\n/);if(!/^(observation_date|DATE),VIXCLS/i.test(lines[0]??''))return null;return lines.slice(1).flatMap(line=>{const[d,c]=line.split(','),close=Number(c);return /^\d{4}-\d{2}-\d{2}$/.test(d??'')&&d<=asOf&&c?.trim()&&Number.isFinite(close)&&close>0?[{asOf:d,close,source:'Cboe VIXCLS via FRED, St. Louis Fed',url:'https://fred.stlouisfed.org/series/VIXCLS'}]:[]}).sort((a,b)=>a.asOf.localeCompare(b.asOf)).at(-1)??null;}
const TOPICS=[[/\b(fed|fomc|interest rate|treasury|yield|inflation|cpi|pce)\b/i,'금리·물가','금리·물가 변화는 소형주의 조달 비용과 이익 배수 가정을 바꿀 수 있습니다. 기사 제목만으로 변화 방향을 확정하지 않습니다.'],[/\b(war|iran|israel|russia|ukraine|tariff|oil|sanction)\b/i,'정세·에너지','정세·통상 변화는 수요뿐 아니라 원료·물류 비용도 바꿀 수 있습니다. 관련 종목의 실제 매출 귀속과 비용 노출을 따로 확인합니다.'],[/\b(earnings|revenue|outlook|guidance|payroll|unemployment)\b/i,'경기·실적','경기·실적 전망이 수요와 자금 여건에 영향을 줄 수 있습니다. 한 기업의 실적을 시장 전체로 일반화하지 않습니다.']];
export function selectMarketNews(rows,now){
 const priority=r=>/\b(cpi|inflation|fomc)\b/i.test(r.headline)?40:/\b(fed|treasury|yield|nasdaq|s&p)\b/i.test(r.headline)?30:/\b(oil|tariff|earnings|payroll)\b/i.test(r.headline)?20:0;
 const seen=new Set(),publishers=new Set();return (Array.isArray(rows)?rows:[]).filter(r=>r&&Number.isFinite(r.datetime)&&r.datetime*1000<=now&&now-r.datetime*1000<=72*3600000&&/^https:\/\//.test(r.url??'')&&typeof r.headline==='string'&&typeof r.source==='string').sort((a,b)=>priority(b)-priority(a)||b.datetime-a.datetime).flatMap(r=>{
 const topic=TOPICS.find(([re])=>re.test(r.headline));const publisher=r.source.toLowerCase().trim();if(!topic||seen.has(r.url)||publishers.has(publisher)||!publisher||r.headline.trim().split(/\s+/).length>20)return [];seen.add(r.url);publishers.add(publisher);
 return [{headline:r.headline,url:r.url,source:r.source,publishedAt:new Date(r.datetime*1000).toISOString(),topic:topic[1],implication:topic[2],confidence:'headline_only'}];}).slice(0,5);
}
export async function publishMarketBrief({barsBy,breadth,asOf,outDir,env={},fetchImpl=fetch,now=Date.now(),source}){
 let vix=null,news=[],newsStatus='not_configured',nasdaqBars=[],cpi=null,fredCpi=null;
 // Public sources are independent: failed context must not suppress price risk.
 const contextResults=await Promise.allSettled([
  (async()=>{const start=new Date(Date.parse(asOf)-480*86400000).toISOString().slice(0,10);const r=await fetchImpl(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=NASDAQCOM&cosd=${start}&coed=${asOf}`,{signal:AbortSignal.timeout(15000)});if(r.ok)nasdaqBars=parseNasdaqCsv(await r.text(),asOf)})(),
  (async()=>{for(const url of ['https://www.bls.gov/news.release/cpi.nr0.htm','https://www.bls.gov/news.release/cpi.htm',reviewedCpi(now)?.url].filter(Boolean)){try{const r=await fetchImpl(url,{signal:AbortSignal.timeout(10000)});if(r.ok)cpi=parseBlsCpi(await r.text(),now);if(cpi)break}catch{}}})(),
  (async()=>{const r=await fetchImpl(FRED_CPI,{signal:AbortSignal.timeout(15000)});if(r.ok)fredCpi=parseFredCpi(await r.text(),now)})()
 ]);
 // newest period wins; for the same period: live BLS release > reviewed snapshot > FRED-derived
 const rank=c=>c.collection==='fred_derived'?0:c.collection==='reviewed_snapshot'?1:2;
 cpi=[cpi,reviewedCpi(now),fredCpi].filter(Boolean).sort((a,b)=>b.period.localeCompare(a.period)||rank(b)-rank(a))[0]??null;
 const contextStatus={cpiFred:fredCpi?'ok':contextResults[2].status==='rejected'?'error':'unavailable',nasdaq:nasdaqBars.length>=22?'ok':contextResults[0].status==='rejected'?'error':'unavailable',cpi:cpi?(cpi.collection==='reviewed_snapshot'||cpi.collection==='fred_derived'?cpi.collection:'ok'):contextResults[1].status==='rejected'&&contextResults[2].status==='rejected'?'error':'unavailable'};
 try{const r=await fetchImpl(VIX_CSV,{signal:AbortSignal.timeout(15000)});if(r.ok)vix=parseVix(await r.text(),asOf);}catch{}
 if(!vix||vix.asOf!==asOf){try{const start=new Date(Date.parse(asOf)-10*86400000).toISOString().slice(0,10);const r=await fetchImpl(`${FRED_VIX}&cosd=${start}&coed=${asOf}`,{signal:AbortSignal.timeout(15000)});if(r.ok){const f=parseFredVix(await r.text(),asOf);if(f&&(!vix||f.asOf>vix.asOf))vix=f}}catch{}}
 if(env.FINNHUB_API_KEY){try{const r=await fetchImpl('https://finnhub.io/api/v1/news?category=general',{headers:{'X-Finnhub-Token':env.FINNHUB_API_KEY},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('news unavailable');const data=await r.json();if(!Array.isArray(data))throw Error('news schema');news=selectMarketNews(data,now);newsStatus=news.length?'ok':'no_recent_relevant_headlines';}catch{newsStatus='error';}}
 const brief=buildMarketBrief({barsBy,breadth,vix,news,newsStatus,asOf,now,source});
 brief.nasdaq=buildNasdaqContext({bars:nasdaqBars,qqqBars:barsBy?.QQQ,asOf,now});
 brief.macro=macroReading(cpi);brief.reviewedEvents=reviewedMarketEvents(now);brief.contextStatus=contextStatus;
 write(path.join(outDir,'market-brief','latest.json'),brief);
 // Daily reports may refresh, unlike immutable recommendation ledgers.
 const kst=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 write(path.join(outDir,'market-brief','history',`${kst}.json`),brief);
 return brief;
}
export async function runMarketBrief({outDir,env=process.env,fetchImpl=fetch,now=Date.now(),wait}){
 let barsBy={},source='Alpaca Market Data v2 (adjustment=all)';
 try{const r=await fetchDailyBars({symbols:MARKET_ETFS,start:new Date(now-450*86400000).toISOString().slice(0,10),end:new Date(now-20*60000).toISOString(),keyId:env.ALPACA_KEY_ID,secretKey:env.ALPACA_SECRET_KEY,feed:env.ALPACA_FEED||'sip',fetchImpl,wait});barsBy=r.bars;source=`Alpaca ${r.feed} · adjustment=all · 지연 종가`; }catch{}
 const closed=(barsBy.SPY??[]).filter(b=>isDailyBarClosed(b.time,now));
 const previous=read(path.join(outDir,'market-brief/latest.json'));
 const asOf=closed.length?new Date(closed.at(-1).time*1000).toISOString().slice(0,10):previous?.asOf??new Date(now).toISOString().slice(0,10);
 return publishMarketBrief({barsBy,breadth:read(path.join(outDir,'market-breadth.json')),asOf,outDir,env,fetchImpl,now,source});
}
