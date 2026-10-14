// Primary observations are dated levels/forecasts, not a fabricated time series.
// Supplier financial growth is a separate panel, not the whole industry's cycle.
const OBSERVATIONS={
 grid:[{kind:'order',label:'Powell 데이터센터 주문',value:'$400M 초과 · FY2026 Q3',date:'2026-08-03',url:'https://powellindustriesinc.gcs-web.com/news-releases/news-release-details/powell-industries-announces-third-quarter-fiscal-2026-results'},
 {kind:'capacity_plan',label:'nVent 액체 냉각 생산 공간 확대',value:'설비 준비 · 확정 주문 아님',date:'2026-07-31',url:'https://investors.nvent.com/press-releases/press-release-details/2026/nVent-Expands-Data-Center-Liquid-Cooling-Capacity/default.aspx'}],
 semicap:[{kind:'forecast',label:'SEMI 장비 투자 전망',value:'산업 전망 · 개별 업체 수주 아님',date:'2026-07-14',url:'https://www.semi.org/en/semi-press-release/global-semiconductor-equipment-sales-forecast-to-reach-a-record-229-billion-dollars-in-2028-semi-reports'}],
 defense:[{kind:'backlog',label:'AeroVironment 예산 확정 잔고',value:'$1.5B · FY2027 Q1',date:'2026-09-09',url:'https://investor.avinc.com/news-releases/news-release-details/aerovironment-announces-fiscal-2027-first-quarter-results'},
 {kind:'prototype',label:'Kopin 시제품 주문',value:'고객 평가 단계 · 양산 별도',date:'2026-08-10',url:'https://www.kopin.com/press-releases/kopin-corporation-reports-second-quarter-2026-financial-results/'}],
};
export function industrialCycle(id,asOf,stocks={}){
 const cutoff=Date.parse(asOf);const observations=(OBSERVATIONS[id]??[]).filter(o=>Date.parse(o.date)<=cutoff&&cutoff-Date.parse(o.date)<=180*86400000);
 const contracts=observations.some(o=>o.kind==='order'||o.kind==='backlog');
 const companies=Object.entries(stocks).filter(([,q])=>q.company&&Date.parse(q.company.period)<=cutoff&&cutoff-Date.parse(q.company.period)<=200*86400000).map(([ticker,q])=>({ticker,...q.company}));
 return {stage:observations.length?'PARTIAL':'MISSING',label:contracts?'수주·잔고 근거 있음 · 산업 방향 미판정':observations.length?'수요 전망·평가 근거 · 산업 방향 미판정':'산업 근거 갱신 필요',
 observations,companies,missing:['동일 범위의 수주 증감·취소 추이','재고·납기 추이','생산 가동률','정상 마진·현금 추이'],
 note:'단일 주문·전망·가격 상승으로 산업 회복을 확정하지 않습니다. 아래 재무는 선택된 연결 기업만의 보고 수치이며 업종 전체나 반복 제품 성장의 증명이 아닙니다.'};
}
