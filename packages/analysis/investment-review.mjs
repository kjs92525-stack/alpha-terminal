import { financialReview } from './financial-review.mjs';
const finite = (v) => typeof v==='number' && Number.isFinite(v);
const money = (v) => `$${(v/1e6).toFixed(1)}M`;
export function investmentReview({ ticker, asOf, price, marketCap, status, risk, fundamentals=null, excluded=[], demo=false, reportPeriod=null }) {
  const latest = reportPeriod ?? fundamentals?.revenueQuarterly?.at(-1)?.end;
  const r=demo ? null : financialReview(ticker,asOf,latest);
  const checks=[]; const add=(label,state,text)=>checks.push({label,state,text});
  add('반복 이익',r ? (r.profitCap===25?'caution':'blocked'):'missing',r?.quality ?? '순이익에서 본업 이익·일회성 효과를 분리하지 못했습니다. 흑자만으로 지속 이익을 가정하지 않습니다.');
  add('현금과 생존',r?'caution':'missing',r?.liquidity ?? '최신 자유 사용 현금, 제한된 현금, 최근 현금 소진·설비투자·부채 만기를 함께 확인해야 합니다. 런웨이 한 숫자로 생존을 확정하지 않습니다.');
  add('희석과 우선 청구권','missing',r?.issuance ? `확인된 발행 ${r.issuance.toLocaleString('en-US')}주 외에 미행사 워런트·전환사채·ATM 잔액과 이후 발행을 아직 완전히 검증하지 못했습니다.` : '현재·잠재 주식 수와 부채·우선주·소송 등 보통주보다 우선하는 청구권의 최신 조건이 미확인입니다.');
  add('계약·수요의 실현',r?'caution':'missing',r?.confirm ?? '구속력·주문 금액·취소 조건·납기·생산 능력·고객 집중도와 실제 현금 회수를 원문에서 확인해야 합니다.');
  add('현재 가격과 가치','missing',r?.valuation ?? '사업 특성에 맞는 가치 평가와 현재 가격에 반영된 기대가 미확인입니다. 낮은 P/S와 큰 낙폭은 저평가의 증명이 아닙니다.');
  if (risk?.checked !== true) add('공시 수집 범위','missing','증자·중대 공시 수집이 불완전합니다. 뉴스나 공시 0건은 위험이 없다는 뜻이 아닙니다.');
  const cash=r ? r.cash+(r.investments??0) : null;
  const cashCoverage=finite(cash)&&finite(marketCap)&&marketCap>0 ? cash/marketCap : null;
  // Reverse earnings sensitivity only; neither a fair price nor a peer-derived multiple.
  // It uses common-equity value directly, so it must not add cash or deduct debt again.
  const sensitivities=!demo&&finite(marketCap)&&marketCap>0&&ticker!=='ARVN' ? [
    {name:'10배·희석 없음',multiple:10,dilution:0}, {name:'15배·주식 수 +20%',multiple:15,dilution:0.2}, {name:'20배·주식 수 +40%',multiple:20,dilution:0.4},
  ].map(s=>({...s,requiredProfit:marketCap*(1+s.dilution)/s.multiple})) : [];
  const stalePrice=!Number.isFinite(Date.parse(asOf)) || Date.parse(asOf)>Date.now() || Date.now()-Date.parse(asOf)>5*86400000;
  const verdict=demo?'예시 데이터 · 투자 판정 불가':status==='excluded'?'현재 조건에서 제외':stalePrice?'자료 갱신 전 판단 보류':'관찰 · 매수 근거 미완성';
  return {verdict,ready:false,summary:demo?'현재 화면은 시연 자료입니다. 실제 기업 투자 근거로 사용하지 않습니다.':excluded.length?excluded.join(' · '):'사업 변화는 검토할 수 있으나 정상 이익·완전 희석 주식 수·가치 범위가 확보되지 않아 현재 가격의 안전마진을 확정할 수 없습니다.',
    checks,report:r?{period:r.period,publishedAt:r.publishedAt,source:r.source}:null,
    cash,restricted:r?.restricted??null,cashCoverage,
    cashNote:r ? `보고 자금 ${money(cash)}${r.investments!==null?' (현금·시장성 증권)':' (현금 및 현금성 자산)'}. 부채·운영 비용·소송·희석을 차감한 청산가치나 주가 바닥이 아닙니다.` : '최신 원문에서 검증한 현금 자료가 없습니다.',
    sensitivities,price:finite(price)?price:null,stalePrice,
    doubt:r?.doubt ?? '시장이 왜 낮은 가격을 부여하는지 확인되지 않았습니다. 구조적인 사업 악화·자금 부족·주주 희석 가능성을 먼저 검증해야 합니다.',
    confirm:r?.confirm ?? '원문에 근거한 반복 주문, 정상 이익, 자유 사용 현금과 희석 조건을 확인한 뒤 가치 범위를 산정합니다.',
    invalidate:r?.invalidate ?? '사업 동력이나 자금 계획이 확인되지 않거나, 예상과 다른 계약 취소·현금 소진·증자가 나오면 투자 가설을 보류합니다.'};
}
