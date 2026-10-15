// Independent, closed-price chart context. Never manufactures OHLC or volume
// from a close-only index series and never substitutes QQQ for the Composite.
import { closedBars, marketMetrics } from './market-brief.mjs';
const finite=Number.isFinite,mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const pct=n=>`${n>=0?'+':''}${(n*100).toFixed(1)}%`,level=n=>finite(n)?n.toLocaleString('en-US',{maximumFractionDigits:2}):'자료 부족';
export function parseNasdaqCsv(text,asOf){
 const lines=String(text).trim().split(/\r?\n/);if(!/^(observation_date|DATE),NASDAQCOM\s*$/.test(lines[0]??''))return [];
 const m=new Map();for(const line of lines.slice(1)){const[d,c]=line.split(','),close=Number(c);if(/^\d{4}-\d{2}-\d{2}$/.test(d??'')&&finite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d&&d<=asOf&&c?.trim()&&finite(close)&&close>0)m.set(d,{time:Date.parse(d)/1000,close});}return [...m.values()].sort((a,b)=>a.time-b.time);
}
export function buildNasdaqContext({bars=[],qqqBars=[],asOf,now=Date.now()}){
 const index=closedBars(bars,asOf,now),proxy=closedBars(qqqBars,asOf,now);
 // A delayed index is displayed with its actual date; same-day QQQ remains a
 // separately named comparison, not a synthetic extension of the index.
 const useIndex=index.length>=22,b=useIndex?index:proxy;
 if(b.length<22)return null;
 const metrics=marketMetrics(b,asOf,now),c=b.map(x=>x.close),last=c.at(-1),n=c.length;
 let gain=0,loss=0,rsi=null;
 if(n>=15){for(let i=1;i<=14;i++){const d=c[i]-c[i-1];gain+=Math.max(d,0)/14;loss+=Math.max(-d,0)/14;}for(let i=15;i<n;i++){const d=c[i]-c[i-1];gain=(gain*13+Math.max(d,0))/14;loss=(loss*13+Math.max(-d,0))/14;}rsi=gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);}
 const priorHigh=Math.max(...c.slice(-21,-1)),priorLow=Math.min(...c.slice(-21,-1)),high252=n>=252?Math.max(...c.slice(-252)):null;
 const ma50Slope=n>=55?metrics.ma50/mean(c.slice(-55,-5))-1:null;
 const title=useIndex?'나스닥 종합지수 (NASDAQ Composite)':'QQQ · Nasdaq-100 ETF 대체 관찰';
 const paragraphs=[`${title} 종가는 ${level(last)}${useIndex?'포인트':'달러'}, 하루 ${pct(metrics.ret1)}, 5거래일 ${pct(metrics.ret5)}입니다. ${metrics.asOf!==asOf?`지수 공표가 지연돼 ${metrics.asOf}까지의 관측입니다. ${asOf} 시장 판단과 날짜를 섞지 않습니다.`:'가격 기준일과 같은 날의 관측입니다.'}`,
 `20일 평균 ${level(metrics.ma20)}, 50일 평균 ${level(metrics.ma50)}, 200일 평균 ${level(metrics.ma200)}와 비교합니다. ${metrics.ma200===null?'장기 추세를 판단할 200개 종가가 부족합니다.':last<metrics.ma200?'종가가 200일선 아래여서 단순한 단기 조정으로 단정하기 어렵습니다.':last<metrics.ma50?'장기 평균 위지만 50일선은 이탈해 중기 추세 회복 확인이 먼저입니다.':last<metrics.ma20?'50일·200일선 위를 지키지만 20일선을 밑돌아 장기 상승과 단기 조정이 공존합니다.':'단기·중기·장기 평균 위입니다. 평균선 위라는 사실만으로 가격이 싸거나 추가 상승이 보장되지는 않습니다.'}`,
 `직전 20거래일의 종가 범위는 ${level(priorLow)}~${level(priorHigh)}입니다. ${last<priorLow?'오늘 종가가 이 범위 하단을 깼습니다. 반등하더라도 하단과 20일선 회복 여부부터 봅니다.':last>priorHigh?'오늘 종가가 이 범위 상단을 넘었습니다. 돌파 유지와 시장 참여도 동반 여부를 확인합니다.':'종가가 범위 안에 있어 상단 돌파나 하단 이탈을 확인한 상태는 아닙니다.'} 이 값은 과거 종가 경계이며 반드시 지켜질 지지·저항이나 목표가가 아닙니다.`,
 `RSI(14·Wilder)는 ${rsi.toFixed(1)}입니다. ${rsi<30?'과매도 구간이어도 하락이 더 이어질 수 있어 역매수 근거로 단독 사용하지 않습니다.':rsi>70?'과열 구간이어도 상승 추세가 이어질 수 있어 매도 근거로 단독 사용하지 않습니다.':'모멘텀 보조지표이며 매매 신호로 단독 사용하지 않습니다.'} ${high252===null?'252개 종가가 부족해 52주 고점 대비 하락률은 계산하지 않습니다.':`252거래일 종가 고점 대비 ${pct(last/high252-1)}입니다.`}`];
 return {title,instrument:useIndex?'NASDAQCOM':'QQQ',unit:useIndex?'포인트':'USD',asOf:metrics.asOf,delayed:metrics.asOf!==asOf,source:useIndex?'Nasdaq, Inc. via FRED · 일별 종가':'Alpaca · QQQ ETF 종가',url:useIndex?'https://fred.stlouisfed.org/series/NASDAQCOM':'https://www.invesco.com/qqq-etf/en/about.html',metrics:{...metrics,rsi14:rsi,priorHigh20:priorHigh,priorLow20:priorLow,drawdown252:high252===null?null:last/high252-1,ma50Slope5:ma50Slope},series:b.slice(-300).map((x,i)=>{const at=n-Math.min(n,300)+i;return {time:x.time,close:x.close,ma20:at>=19?mean(c.slice(at-19,at+1)):null,ma50:at>=49?mean(c.slice(at-49,at+1)):null,ma200:at>=199?mean(c.slice(at-199,at+1)):null}}),paragraphs,note:'종가 선 차트입니다. 장중 고저·거래량·갭·분배일은 이 자료로 판정하지 않습니다. QQQ는 Nasdaq-100 추종 ETF이며 나스닥 종합지수와 구성·수익률이 다릅니다. 차트 해석은 기존 위험 판정과 별도 참고입니다.'};
}
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
export function parseBlsCpi(html,now=Date.now()){
 const text=String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
 const date=text.match(/8:30 a\.m\. \(ET\)\s+\w+,\s+(\w+) (\d{1,2}), (\d{4})/i);if(!date)return null;
 const month=MONTHS.findIndex(x=>x.toLowerCase()===date[1].toLowerCase());if(month<0)return null;
 const day=`${date[3]}-${String(month+1).padStart(2,'0')}-${date[2].padStart(2,'0')}`,noon=Date.parse(day+'T12:00:00Z');
 const nyHour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(new Date(noon)));
 const published=noon+(8-nyHour)*3600000+30*60000;if(!finite(published)||published>now||now-published>45*86400000)return null;
 const intro=text.split(/CONSUMER PRICE INDEX\s*[-–—]/i)[1]?.split(/Table A\./i)[0];if(!intro)return null;
 const period=intro.match(/^\s*([A-Z]+)\s+(\d{4})/),headlineM=intro.match(/CPI-U\) increased ([\d.]+) percent on a seasonally adjusted basis/i),headlineY=intro.match(/all items index increased ([\d.]+) percent before seasonal adjustment/i),coreM=intro.match(/index for all items less food and energy rose ([\d.]+) percent in/i),coreY=intro.match(/all items less food and energy index rose ([\d.]+) percent over the year/i);
 if(!period||![headlineM,headlineY,coreM,coreY].every(x=>x&&finite(Number(x[1]))))return null;
 return {publishedAt:new Date(published).toISOString(),period:`${period[2]}-${String(MONTHS.findIndex(x=>x.toUpperCase()===period[1])+1).padStart(2,'0')}`,headlineMonthly:Number(headlineM[1]),headlineAnnual:Number(headlineY[1]),coreMonthly:Number(coreM[1]),coreAnnual:Number(coreY[1]),source:'미국 노동통계국(BLS)',url:`https://www.bls.gov/news.release/archives/cpi_${String(month+1).padStart(2,'0')}${date[2].padStart(2,'0')}${date[3]}.htm`};
}
export const FRED_CPI='https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL,CPIAUCNS,CPILFESL,CPILFENS';
// Fallback when bls.gov refuses the runner: FRED's copy of the BLS indexes. Changes are computed from
// index levels (may differ from the rounded BLS release by 0.1%p); the release time is not in the file.
// Valid from the 8th of the next month (no release before that) until the 20th of the month after.
export function parseFredCpi(text,now=Date.now()){
 const lines=String(text).trim().split(/\r?\n/),head=(lines[0]??'').split(',').map(x=>x.trim().toUpperCase()),col=['CPIAUCSL','CPIAUCNS','CPILFESL','CPILFENS'].map(id=>head.indexOf(id));
 if(!/^(OBSERVATION_DATE|DATE)$/.test(head[0]??'')||col.some(i=>i<0))return null;
 const by=new Map(lines.slice(1).map(l=>l.split(',')).filter(r=>/^\d{4}-\d{2}-01$/.test(r[0]??'')).map(r=>[r[0],col.map(i=>r[i]?.trim()?Number(r[i]):NaN)]).filter(([,v])=>v.every(x=>finite(x)&&x>0)));
 const key=(y,m)=>new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);
 for(const d of [...by.keys()].sort().reverse()){const[y,m]=d.split('-').map(Number);if(now<Date.UTC(y,m,8))continue;const expires=Date.UTC(y,m+1,20);if(now>=expires)return null;
  const cur=by.get(d),prev=by.get(key(y,m-2)),year=by.get(key(y-1,m-1));if(!prev||!year)return null;const pct=(a,b)=>Math.round((a/b-1)*1000)/10;
  return {publishedAt:null,period:d.slice(0,7),headlineMonthly:pct(cur[0],prev[0]),headlineAnnual:pct(cur[1],year[1]),coreMonthly:pct(cur[2],prev[2]),coreAnnual:pct(cur[3],year[3]),source:'BLS CPI 지수 · FRED(세인트루이스 연준) 사본에서 계산',url:'https://fred.stlouisfed.org/series/CPIAUCSL',collection:'fred_derived',observedAt:new Date(now).toISOString(),expiresAt:new Date(expires).toISOString(),note:'지수 수준으로 직접 계산한 값이라 BLS 발표의 반올림 수치와 0.1%p 다를 수 있습니다. 발표 시각은 이 자료에 없습니다.'};}
 return null;
}
export function macroReading(cpi){if(!cpi)return null;const hot=cpi.headlineMonthly>=0.4&&cpi.coreMonthly>=0.3;return {...cpi,title:'물가 → 금리 기대 → 성장주·소형주의 자금 비용',fact:`${cpi.collection==='fred_derived'?'FRED에 실린 BLS 지수로 계산한':'BLS의'} ${cpi.period} CPI는 전월 대비 ${cpi.headlineMonthly.toFixed(1)}%(계절조정), 전년 대비 ${cpi.headlineAnnual.toFixed(1)}%(비조정)입니다. 식품·에너지를 뺀 근원 CPI는 각각 ${cpi.coreMonthly.toFixed(1)}%, ${cpi.coreAnnual.toFixed(1)}%입니다.`,interpretation:hot?'물가 압력이 다시 낮아지고 있다고 낙관하기 어려운 발표입니다. 금리 인하가 늦어지거나 더 높은 조달 금리가 유지되면, 먼 미래 이익에 높은 값을 주던 성장주의 현재가치와 적자 기업의 현금 생존기간이 동시에 압박받을 수 있습니다.':'한 달 물가만으로 완화 전환을 확정할 수 없습니다. 이후 발표와 실제 국채 금리·연준 결정을 함께 확인해야 합니다.',business:'AI 데이터센터·냉각 수요가 늘어도 주가가 함께 오르는 것은 아닙니다. 차입으로 GPU·설비를 먼저 사는 운영사는 이자와 감가상각을 낸 뒤 현금이 남는지, 냉각·전력 장비 공급사는 수주가 취소 불가능한 계약인지와 고객 투자 지연에 얼마나 노출되는지가 다릅니다. 작은 기업은 다음 12개월 만기·현금 소진·증자 조건까지 확인해야 합니다.',counterpoint:'수요의 구조적 성장과 단기 가격 조정은 공존할 수 있습니다. 물가 재둔화, 금리 부담 완화, 고객의 실제 투자 집행과 이익·현금흐름 개선이 확인되면 이 해석을 재검토합니다. CPI 발표만으로 금리 인상·경기 침체·AI 수요 붕괴를 확정하지 않습니다.',watch:['다음 CPI·고용과 연준의 실제 결정: 예상과 결과를 구분','국채 금리와 회사채 조달 조건: TLT·HYG 가격을 금리·스프레드 자체로 오인하지 않기','관심 기업의 확정 수주·가동률·매출총이익·현금 소진: 테마 수요가 주주 이익으로 남는지'],classification:'공식 발표 사실 + 조건부 분석 · 시장 판정 점수와 분리'};}
