// Business taxonomy, not a news sentiment classifier. Membership is editorial and
// non-exhaustive; it does not establish segment revenue, market share or upside.
export const THEME_REVIEWED_AT = '2026-11-14';
export const MARKET_THEMES = [
  { id:'ai', name:'AI 인프라', short:'AI', etf:'IGV', proxy:'소프트웨어 가격 참고 · AI 산업 전체를 대표하지 않음', mechanism:'모델 사용량 증가가 연산·네트워크·클라우드 지출로 이어지는지 확인합니다.', confirm:'AI 관련 매출·수주 증가와 설비투자 후 현금 회수', risk:'설비 과잉, 고객 집중, 높은 투자비와 수익화 지연', groups:[['가속기·설계','NVDA AMD AVGO MRVL ARM'],['클라우드·플랫폼','MSFT AMZN GOOGL GOOG ORCL'],['네트워크·서버','ANET DELL HPE SMCI CRDO'],['데이터·소프트웨어','PLTR SNOW MDB DDOG NOW']] },
  { id:'semis', name:'반도체', short:'반도체', etf:'SMH', proxy:'미국 상장 반도체 ETF', mechanism:'연산·메모리 수요가 출하·가격·가동률을 거쳐 이익으로 이어지는 구조입니다.', confirm:'재고 일수 감소, 매출총이익률 개선, 수주와 고객 설비투자', risk:'재고 순환, 수출 규제, 고객의 주문 중복', groups:[['팹리스·IP','NVDA AMD AVGO MRVL ARM QCOM MCHP MPWR'],['메모리·저장장치','MU WDC SNDK STX'],['파운드리·IDM','TSM INTC GFS TXN ADI NXPI ON STM'],['장비·공정','ASML AMAT LRCX KLAC TER ACLS ACMR COHU']] },
  { id:'power', name:'전력·데이터센터', short:'전력', etf:'XLU', proxy:'유틸리티 ETF · 전력 장비·데이터센터 전체와 다름', mechanism:'데이터센터 증설과 전력망 투자가 냉각·전기장비·발전 수요로 연결될 수 있습니다.', confirm:'수주잔고의 매출 전환, 신규 발전 계약, 원가 전가와 현금흐름', risk:'인허가 지연, 프로젝트 취소, 원가 상승과 조달 부담', groups:[['전력장비·냉각','ETN VRT HUBB NVT GEV ABB'],['전력망·시공','PWR EME FIX MYRG'],['발전·전력공급','CEG VST NRG TLN NEE DUK SO'],['원전·연료','CCJ LEU BWXT OKLO SMR']] },
  { id:'robotics', name:'로봇·자동화', short:'로봇', etf:'BOTZ', proxy:'글로벌 로봇·AI ETF · 미국 기업만으로 구성되지 않음', mechanism:'인건비·정밀도·생산성 요구가 자동화 투자를 늘리는지 확인합니다.', confirm:'양산 고객, 반복 주문, 설치 기반과 서비스 매출, 수익성', risk:'실증에서 양산으로의 전환 지연, 고객 투자 위축, 희석', groups:[['산업 자동화','ROK EMR HON ABB SYM CGNX'],['의료·서비스 로봇','ISRG SYK ZBH SERV'],['자율주행·모빌리티','TSLA AUR MBLY OUST LAZR']] },
  { id:'defense', name:'방산·우주', short:'방산·우주', etf:'ITA', proxy:'미국 항공우주·방산 ETF', mechanism:'정부 예산과 상업 계약이 수주잔고에서 납품·현금으로 전환되는지 봅니다.', confirm:'예산 확정, 계약 범위, 납기, 계약별 마진과 현금 수금', risk:'고정가 계약 손실, 발사 실패, 정책 변경, 자금 소진', groups:[['방산·항공','LMT NOC RTX GD LHX HII AVAV KTOS'],['우주·위성','RKLB ASTS RDW LUNR PL BKSY IRDM VSAT']] },
  { id:'health', name:'헬스케어·바이오', short:'헬스케어', etf:'XLV', proxy:'미국 헬스케어 업종 ETF', mechanism:'처방·시술·진단 수요와 연구개발 성과를 반복 매출과 구분해 봅니다.', confirm:'처방·시술 증가, 임상 단계와 통계 결과, 현금 보유기간', risk:'임상 실패, 약가 정책, 특허 만료, 연구개발 자금 조달', groups:[['의약품','LLY NVO ABBV JNJ MRK PFE AMGN GILD VRTX REGN'],['의료기기·진단','ISRG SYK MDT BSX DXCM ABT TMO DHR'],['임상·바이오','CRSP NTLA BEAM RXRX ACHV ABCL']] },
  { id:'consumer', name:'소비·플랫폼', short:'소비', etf:'XLY', proxy:'미국 경기소비재 ETF', mechanism:'소비자의 구매력이 판매량·객단가·플랫폼 수익으로 이어지는지 확인합니다.', confirm:'동일점포 매출, 이용자당 수익, 마진과 재고 회전', risk:'소비 둔화, 할인 경쟁, 광고·판촉비 증가', groups:[['소비·유통','AMZN COST WMT TGT HD LOW NKE SBUX MCD'],['플랫폼·광고','META GOOGL GOOG NFLX UBER DASH ABNB']] },
  { id:'finance', name:'금융·핀테크', short:'금융', etf:'XLF', proxy:'미국 금융 업종 ETF', mechanism:'금리·신용·거래 활동이 순이자이익과 수수료 수익에 미치는 변화를 봅니다.', confirm:'예금 조달비용, 연체율·충당금, 거래량과 수수료율', risk:'대손 증가, 자금 조달 불안, 규제와 가격 경쟁', groups:[['은행·결제','JPM BAC C WFC GS MS V MA AXP'],['핀테크·거래','SOFI HOOD COIN PYPL XYZ AFRM UPST']] },
];

const n = v => typeof v === 'number' && Number.isFinite(v);
// Known share-class aliases also cover legacy/mis-mapped CIKs in older caches.
const CLASS_ISSUER = Object.fromEntries([
  ['GOOGL','GOOG'],['BRK.A','BRK.B'],['FOX','FOXA'],['NWS','NWSA'],
  ['HEI','HEI.A'],['LEN','LEN.B'],['UA','UAA'],['BF.A','BF.B'],
].flatMap(classes=>classes.map(symbol=>[symbol,`class:${classes[0]}`])));
/** ADR ratios and profile market-cap currencies are not retained in the old
 * cache. Do not assume a foreign cap is USD. Domestic-reporting issuers can use
 * a dated profile anchor; foreign/unknown bases remain unverified. */
export function marketCapEstimate({company,profile,bars,asOf}) {
  const current=bars.at(-1)?.close, observed=Date.parse(profile?.fetchedAt);
  const forms=[...(company?.filings??[]),...(company?.facts?.revenueQuarterly??[]),...(company?.facts?.netIncomeQuarterly??[]),company?.facts?.revenue].filter(Boolean).map(f=>f.form??'');
  const domestic=forms.some(f=>/^10-[KQ](?:\s|\/|$)/.test(f));
  const foreign=forms.some(f=>/^(20-F|40-F|6-K)/.test(f));
  if(foreign||!domestic)return {mcap:null,source:'통화·주식 단위 미확인',note:'ADR/해외 발행사 및 보고 양식 미확인 종목은 프로필 통화·예탁비율 검증 전 시총 합산 제외'};
  const cap=profile?.marketCap??(profile?.profile?.marketCapitalization*1e6);
  if(n(cap)&&cap>0&&n(current)&&Number.isFinite(observed)&&observed<=Date.parse(asOf)+86400000){
    const anchor=bars.filter(b=>b.time*1000<=observed).at(-1);
    if(anchor?.close>0&&observed-anchor.time*1000<=7*86400000&&Date.parse(asOf)-observed<=120*86400000)
      return {mcap:cap*current/anchor.close,source:'프로필 회사 시총 × 기준일/프로필시점 조정종가',note:`프로필 관측 ${profile.fetchedAt.slice(0,10)} · 가격비율 추정, 이후 주식 수 변화 미반영`};
  }
  const shares=company?.facts?.sharesOutstanding;
  if(company?.source==='Finnhub'||shares?.form==='profile')
    return {mcap:null,source:'미확인',note:'ADR 비율·주식 수 기준 또는 프로필 시점 교차 확인 필요'};
  if(n(shares?.value)&&shares.value>0&&n(current)&&shares.end&&Date.parse(shares.end)<=Date.parse(asOf)&&Date.parse(asOf)-Date.parse(shares.end)<=400*86400000)
    return {mcap:shares.value*current,source:'보고 주식 수 × 종가',note:`주식 수 보고 ${shares.end} · 복수 클래스·이후 발행 변동은 별도 검토`};
  return {mcap:null,source:'미확인',note:'사용 가능한 시총 기준 자료 없음'};
}
export function themeMembership(symbol) {
  const ticker = String(symbol).toUpperCase().replace('-', '.');
  return MARKET_THEMES.flatMap(t => t.groups.filter(([,syms])=>syms.split(' ').includes(ticker)).map(([group])=>({id:t.id,name:t.name,group})));
}

// Publish the broad price universe BEFORE chart-pattern selection. Missing facts
// stay missing; stale prices cannot silently masquerade as today's return.
export function buildMarketSnapshot({rows,asOf,generatedAt,universe,source}) {
  const unique = new Map();
  const issuers=new Map();
  const sorted=[...rows].sort((a,b)=>(b.features?.adv20??0)-(a.features?.adv20??0));
  let stale = 0;
  let shareClasses=0;
  for (const r of sorted) {
    const f=r.features;
    if(!f || f.lastDate!==asOf){stale++;continue;}
    if(!n(f.price)||f.price<=0||unique.has(r.symbol))continue;
    const issuer=CLASS_ISSUER[r.symbol]||(r.cik?String(r.cik).replace(/^0+/,''):null);
    if(issuer&&issuers.has(issuer)){
      issuers.get(issuer).aliases.push(r.symbol);shareClasses++;continue;
    }
    const stock={
      aliases:[],
      symbol:r.symbol,name:r.name||r.symbol,sector:r.sector||'Unknown',exchange:r.exchange||null,
      price:f.price,priceAsOf:f.lastDate,mcap:n(f.mcap)&&f.mcap>0?Math.round(f.mcap):null,
      ret1:n(f.ret_1)?f.ret_1:null,ret5:n(f.ret_5)?f.ret_5:null,
      ret21:n(f.ret21)?f.ret21:null,ret63:n(f.ret63)?f.ret63:null,
      adv20:n(f.adv20)?f.adv20:null,revenueGrowth:n(f.rev_growth)?f.rev_growth:null,
      mcapSource:f.mcapSource??'보고 주식 수/프로필 기반 추정',mcapNote:f.mcapNote??'',
      themes:themeMembership(r.symbol),
    };
    unique.set(r.symbol,stock);if(issuer)issuers.set(issuer,stock);
  }
  const stocks=[...unique.values()].sort((a,b)=>(b.mcap??0)-(a.mcap??0));
  return {model:'market-map-v1',asOf,generatedAt,universe,source,
    coverage:{priced:stocks.length,withCap:stocks.filter(s=>s.mcap!==null).length,staleExcluded:stale,shareClassesExcluded:shareClasses},
    classification:{reviewedAt:THEME_REVIEWED_AT,method:'미국 거래소 상장 종목 · 사업 연결 편집 분류(중복 가능), 업종은 SIC/공급자 근사 분류. 부문 매출 비중을 뜻하지 않음'},stocks};
}

export function groupPerformance(stocks,period='ret1',size='cap') {
  const measured=stocks.filter(s=>n(s[period])&&(size==='equal'||n(s.mcap)&&s.mcap>0));
  const denominator=measured.reduce((sum,s)=>sum+(size==='equal'?1:s.mcap),0);
  return {value:denominator?measured.reduce((sum,s)=>sum+s[period]*(size==='equal'?1:s.mcap),0)/denominator:null,
    measured:measured.length,total:stocks.length,advancing:measured.filter(s=>s[period]>0).length,declining:measured.filter(s=>s[period]<0).length};
}
