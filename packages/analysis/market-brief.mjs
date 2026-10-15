// A transparent risk overlay for NEW US small-cap entries, not a forecasting
// model or a validated timing strategy. All inputs are closed, as-of prices.
import { isDailyBarClosed } from './market.mjs';
export const BRIEF_SECTORS=[['XLK','기술'],['XLC','통신'],['XLF','금융'],['XLV','헬스케어'],['XLE','에너지'],['XLI','산업재'],['XLY','경기소비'],['XLP','필수소비'],['XLB','소재'],['XLU','유틸리티'],['XLRE','부동산']];
export const MARKET_ETFS=['SPY','QQQ','IWM','RSP','HYG','LQD','TLT','UUP',...BRIEF_SECTORS.map(x=>x[0])];
export const MARKET_RULES={minBreadth:300,minCoverage:0.3,shockDay:-0.025,shockWeek:-0.05,weakBreadth:0.35,healthyBreadth:0.55,vixCaution:25,vixStress:35,realizedCaution:0.3,creditCaution:-0.02,confirmSessions:3,maxAgeHours:36,maxPriceAgeDays:4};
const DAY=86400000,finite=n=>typeof n==='number'&&Number.isFinite(n);
const day=t=>new Date(t*1000).toISOString().slice(0,10);
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const pct=x=>finite(x)?`${x>=0?'+':''}${(x*100).toFixed(1)}%`:'미확인';
let cutoffNow=null,cutoffEnd=null;
function closedEnd(now){if(cutoffNow!==now){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));const today=`${parts.year}-${parts.month}-${parts.day}`,start=Date.parse(today);cutoffEnd=isDailyBarClosed(start/1000,now)?start+DAY-1:start-1;cutoffNow=now;}return cutoffEnd;}
export function closedBars(bars,asOf,now=Date.now()){
 let end=Date.parse(asOf+'T23:59:59Z');if(!Number.isFinite(end))return [];
 end=Math.min(end,closedEnd(now));
 const m=new Map();for(const b of bars??[])if(finite(b.time)&&b.time*1000<=end&&finite(b.close)&&b.close>0)m.set(b.time,b);
 return [...m.values()].sort((a,b)=>a.time-b.time);
}
export function marketMetrics(bars,asOf,now=Date.now()){
 const b=closedBars(bars,asOf,now),c=b.map(x=>x.close),n=c.length,last=b.at(-1);
 if(!n)return null;
 const ma=k=>n>=k?mean(c.slice(-k)):null,ret=k=>n>k?c.at(-1)/c.at(-1-k)-1:null;
 const rr=c.slice(-21).slice(1).map((v,i)=>Math.log(v/c.slice(-21)[i]));
 const rv=rr.length===20?Math.sqrt(rr.reduce((s,r)=>s+(r-mean(rr))**2,0)/19)*Math.sqrt(252):null;
 return {asOf:day(last.time),close:c.at(-1),ret1:ret(1),ret5:ret(5),ret21:ret(21),ma20:ma(20),ma50:ma(50),ma200:ma(200),realized20:rv,
   above50:ma(50)===null?null:c.at(-1)>ma(50),above200:ma(200)===null?null:c.at(-1)>ma(200),
   confirmation:b.slice(-3).length===3&&[0,1,2].every(i=>n-i>=200&&c[n-1-i]>mean(c.slice(n-50-i,n-i))&&c[n-1-i]>mean(c.slice(n-200-i,n-i)))};
}
export function marketBreadth({symbols,getBars,asOf,now=Date.now()}){
 let sample=0,above20=0,above50=0,above200=0,advancing=0,declining=0,highs=0,lows=0;
 const unique=[...new Set(symbols)];
 for(const s of unique){const b=closedBars(getBars(s),asOf,now);if(b.length<200||day(b.at(-1).time)!==asOf)continue;
  const c=b.map(x=>x.close),last=c.at(-1),adv=mean(b.slice(-20).map(x=>finite(x.volume)&&x.volume>=0?x.volume*x.close:0));
  if(last<1||adv<1e6)continue;sample++;if(last>mean(c.slice(-20)))above20++;if(last>mean(c.slice(-50)))above50++;if(last>mean(c.slice(-200)))above200++;
  if(last>c.at(-2))advancing++;if(last<c.at(-2))declining++;
  if(c.length>=252){if(last>=Math.max(...c.slice(-252)))highs++;if(last<=Math.min(...c.slice(-252)))lows++;}
 }
 return {asOf,sample,universe:unique.length,coverage:unique.length?sample/unique.length:0,above20:sample?above20/sample:null,above50:sample?above50/sample:null,above200:sample?above200/sample:null,advancing,declining,highs,lows,
   method:'현재 상장 보통주 중 당일 종가·200봉 이상·가격 $1 이상·20일 평균 거래대금 $1M 이상인 표본. 거래소 공식 A/D 또는 지수 구성종목 통계가 아님. 신규 상장·저유동성 제외. 52주 신고저는 종가 기준이며 현 상장집합의 통계는 역사적 백테스트에 쓸 수 없음.'};
}
export function briefingFreshness(data,now=Date.now()){
 if(!data)return {fresh:false,reason:'시황 자료를 아직 확보하지 못했습니다.'};
 const generated=Date.parse(data.generatedAt),price=Date.parse(data.asOf+'T00:00:00Z');
 if(!finite(generated)||generated>now+5*60000||!finite(price)||price>now)return {fresh:false,reason:'시황 기준 시각이 유효하지 않습니다.'};
 if(now-generated>MARKET_RULES.maxAgeHours*3600000)return {fresh:false,reason:'36시간 이상 갱신되지 않았습니다. 이전 긍정 판정을 사용하지 않습니다.'};
 if(now-price>MARKET_RULES.maxPriceAgeDays*DAY)return {fresh:false,reason:'가격 기준일이 4일 넘게 지났습니다. 휴장 또는 수집 지연을 확인할 때까지 대기합니다.'};
 return {fresh:true,reason:null};
}
export function buildMarketBrief({barsBy={},breadth=null,vix=null,news=[],newsStatus='not_checked',asOf,now=Date.now(),source='Alpaca Market Data v2 (adjustment=all)'}){
 const metrics=Object.fromEntries(MARKET_ETFS.map(s=>[s,marketMetrics(barsBy[s],asOf,now)]));
 const missing=[];for(const s of ['SPY','QQQ','IWM'])if(!metrics[s]||metrics[s].asOf!==asOf||metrics[s].ma200===null)missing.push(`${s} 당일·200일 가격`);
 const b=breadth?.asOf===asOf&&finite(breadth.sample)&&breadth.sample>=MARKET_RULES.minBreadth&&finite(breadth.coverage)&&breadth.coverage>=MARKET_RULES.minCoverage&&breadth.coverage<=1&&[breadth.above50,breadth.above200].every(x=>finite(x)&&x>=0&&x<=1)?breadth:null;
 if(!b)missing.push('충분한 당일 시장 참여도 표본');
 const v=vix?.asOf===asOf&&finite(vix.close)&&vix.close>0?vix:null;
 const hyg=metrics.HYG,lqd=metrics.LQD;
 const credit=hyg?.asOf===asOf&&lqd?.asOf===asOf&&finite(hyg.ret21)&&finite(lqd.ret21)?hyg.ret21-lqd.ret21:null;
 const spy=metrics.SPY?.asOf===asOf?metrics.SPY:null,qqq=metrics.QQQ?.asOf===asOf?metrics.QQQ:null,iwm=metrics.IWM?.asOf===asOf?metrics.IWM:null;
 const stress=[],caution=[];
 if(finite(spy?.ret1)&&spy.ret1<=MARKET_RULES.shockDay)stress.push(`대형주 하루 ${pct(spy.ret1)} 급락`);
 if(finite(spy?.ret5)&&spy.ret5<=MARKET_RULES.shockWeek)stress.push(`대형주 5거래일 ${pct(spy.ret5)} 하락`);
 if(spy?.above200===false&&qqq?.above200===false)stress.push('대형주·성장주가 모두 200일선 아래');
 if(b&&finite(b.above50)&&b.above50<0.35&&iwm?.above50===false)stress.push(`50일선 위 종목이 ${(b.above50*100).toFixed(0)}%에 그치고 소형주 추세도 약함`);
 if(v&&v.close>=35&&b&&finite(b.above50)&&b.above50<0.5)stress.push('높은 예상 변동성과 약한 참여도가 겹침');
 if(spy?.above50===false)caution.push('대형주가 50일선 아래');
 if(iwm?.above50===false)caution.push('소형주가 50일선 아래');
 if(b&&finite(b.above50)&&b.above50<0.55)caution.push('50일선 위 종목이 55% 미만');
 if(b&&b.above200<0.45)caution.push('200일선 위 종목이 45% 미만');
 if(v&&v.close>=25)caution.push(`VIX ${v.close.toFixed(1)}로 예상 변동성 부담`);
 if(finite(spy?.realized20)&&spy.realized20>=0.3)caution.push('20일 실현 변동성이 연율 30% 이상');
 if(credit!==null&&credit<=-0.02)caution.push('고수익채 ETF가 투자등급채보다 21일간 2%p 이상 약함');
 if(!v)caution.push('당일 VIX 자료 미확인');if(credit===null)caution.push('당일 채권 상대성과 미확인');
 const confirmed=['SPY','QQQ','IWM'].every(s=>metrics[s]?.confirmation);
 if(!confirmed)caution.push('대형주·성장주·소형주의 3거래일 추세 확인이 미충족');
 let state=stress.length?'WAIT':missing.length?'UNKNOWN':caution.length?'LIMIT':'SELECTIVE';
 const freshness=briefingFreshness({asOf,generatedAt:new Date(now).toISOString()},now);
 if(!freshness.fresh){state='UNKNOWN';missing.push(freshness.reason);}
 const labels={WAIT:'신규 진입 대기',UNKNOWN:'자료 확인 전 진입 대기',LIMIT:'신규 진입 축소',SELECTIVE:'선별 진입 검토'};
 const reasons=state==='UNKNOWN'?missing:stress.length?stress:caution.length?caution:['주요 지수 추세·시장 참여도·변동성 조건이 함께 충족'];
 const actions=state==='WAIT'||state==='UNKNOWN'?['새 매수와 손실 만회를 위한 물타기는 대기합니다.','관심 종목과 사업 가설은 계속 추적하고, 시장과 종목 조건이 회복되는지 확인합니다.']:state==='LIMIT'?['평소보다 신규 진입을 줄이고, 추격 대신 확인된 종목만 검토합니다.','진입 전 계좌 손실 한도·유동성·이벤트 및 증자 위험을 다시 확인합니다.']:['시장 조건을 통과한 상태이며 개별 종목의 매수 신호는 아닙니다.','사업 근거·가격·희석·손실 한도를 통과한 종목만 선별합니다.'];
 const paragraphs=[];
 if(spy?.asOf===asOf&&finite(spy.ret1))paragraphs.push(`대형주를 보는 SPY는 하루 ${pct(spy.ret1)}, 5거래일 ${pct(spy.ret5)}입니다. ${spy.above200===null?'장기 추세 자료가 부족합니다.':spy.above200?'200일선 위에 있습니다.':'200일선 아래여서 장기 가격 추세가 약합니다.'}`);
 if(iwm?.asOf===asOf&&finite(iwm.ret21)&&finite(spy?.ret21))paragraphs.push(`소형주 IWM의 21거래일 성과는 ${pct(iwm.ret21)}로 SPY 대비 ${pct(iwm.ret21-spy.ret21).replace('%','%p')}입니다. ${iwm.ret21<spy.ret21?'지수 상승이 소형주의 기회로 똑같이 이어진다고 보기 어렵습니다.':'상대성과는 개선됐지만 각 종목의 수익·현금 검증은 별개입니다.'}`);
 if(b&&finite(b.above50))paragraphs.push(`당일 조건을 충족한 ${b.sample.toLocaleString('ko-KR')}개 종목 중 ${(b.above50*100).toFixed(0)}%가 50일선 위입니다. ${b.above50<0.5?'다수 종목의 추세가 약해 몇몇 대형주가 지수를 끌어올리는 장인지 주의해야 합니다.':'상승 참여는 과반이지만 저유동성·신규 상장 제외 표본이라는 한계가 있습니다.'}`);
 if(v)paragraphs.push(`VIX는 ${v.close.toFixed(1)}입니다. 향후 약 30일의 옵션 내재 예상 변동성으로 방향·하락 확률이 아닙니다. ${v.close>=25?'높은 진폭은 같은 매수 금액에서도 손실 변동을 키울 수 있습니다.':'낮은 수치만으로 안전한 시장이라고 결론내리지 않습니다.'}`);
 return {model:'market-brief-v1',asOf,generatedAt:new Date(now).toISOString(),decision:{state,label:labels[state],scope:'미국 소형주 신규 진입을 위한 보수적 위험 점검',reasons,actions},
  story:{lead:state==='WAIT'?'좋은 기업을 찾는 일과 오늘 새 위험을 떠안는 일은 다릅니다. 시장의 훼손 신호가 겹쳐 지금은 신규 진입을 기다리는 쪽으로 판정했습니다.':state==='UNKNOWN'?'확인되지 않은 시장을 좋은 시장으로 표시하지 않습니다. 필요한 자료가 확보될 때까지 신규 진입 판단을 보류합니다.':state==='LIMIT'?'시장 전체가 한 방향으로 좋아졌다고 보기 어렵습니다. 기업 스토리가 좋아도 시장 변동과 소형주 약세가 성과를 누를 수 있어 진입을 줄이는 환경입니다.':'시장 추세와 참여도 조건은 비교적 양호합니다. 이 판정은 좋은 종목을 고를 여건을 뜻하며, 급등 종목 추격이나 모든 종목 매수를 정당화하지 않습니다.',paragraphs},
  resume:['SPY·QQQ·IWM이 각각 50일·200일선 위를 3거래일 유지','당일 표본의 50일선 상회 비율 55% 이상·200일선 상회 45% 이상','당일 VIX 25 미만·실현 변동성 연율 30% 미만·채권 상대성과 경고 해소','자료가 당일 기준으로 충분하고 최신성 조건 충족'],
  holding:'신규 진입 판정입니다. 보유 종목을 일괄 매도하는 신호가 아닙니다. 개별 사업 가설 훼손·현금 필요·이벤트·사전에 정한 손실 한도를 별도로 검토합니다.',
  metrics,sectors:BRIEF_SECTORS.flatMap(([ticker,name])=>{const m=metrics[ticker];return m?.asOf===asOf&&finite(m.ret1)?[{ticker,name,ret1:m.ret1,ret21:m.ret21}]:[]}).sort((a,b)=>b.ret1-a.ret1),breadth:b,vix:v,vixObserved:vix?.asOf<=asOf&&finite(vix.close)?vix:null,credit:{relative21:credit,note:'HYG−LQD ETF 21거래일 수익률 차이. 듀레이션·가격·배당 등도 영향을 주므로 실제 신용스프레드가 아님.'},news,newsStatus,missing,
  sources:[{label:source,url:'https://docs.alpaca.markets/us/docs/about-market-data-api'},{label:'Cboe VIX 일별 종가·방법',url:'https://www.cboe.com/tradable_products/vix/faqs'},...(vix?.source?.includes('FRED')?[{label:'Cboe VIXCLS / FRED, St. Louis Fed · 공표 지연 가능',url:'https://fred.stlouisfed.org/series/VIXCLS'}]:[])],rules:MARKET_RULES,
  caveat:'편집 규칙 기반 위험 관리이며 하락 예측·최적 타이밍·초과수익이 검증된 전략이 아닙니다. 임계값은 운영 기준으로 과적합·재진입 지연·급반등 누락이 가능합니다. 뉴스 제목으로 시장 변동의 원인을 확정하지 않습니다. 실시간·장중 판정이 아닙니다.'};
}
