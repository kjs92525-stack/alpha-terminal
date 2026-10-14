import { useState } from 'react';
import { equityScenario, positionRisk } from '../../../../packages/analysis/decision-tools.mjs';
const value=(s:string)=>s.trim()===''?NaN:Number(s);
const money=(n:number|undefined)=>n===undefined?'—':`$${n.toLocaleString('en-US',{maximumFractionDigits:2})}`;
export function DecisionTools({ticker,price,marketCap,revenue,adv20,asOf}:{ticker:string;price:number|null;marketCap:number|null;revenue?:number|null;adv20?:number|null;asOf:string}){
 const [sales,setSales]=useState('');const [cases,setCases]=useState([{name:'보수',margin:'',pe:'',dilution:''},{name:'기준',margin:'',pe:'',dilution:''},{name:'낙관',margin:'',pe:'',dilution:''}]);
 const [form,setForm]=useState({balance:'',cash:'',entry:'',stop:'',risk:'0.5',openRisk:'0',exposure:'0',portfolio:'2',sector:'25',deadline:''});
 const edit=(k:keyof typeof form,v:string)=>setForm(f=>({...f,[k]:v}));
 const fresh=Number.isFinite(Date.parse(asOf))&&Date.parse(asOf)<=Date.now()&&Date.now()-Date.parse(asOf)<=5*86400000;
 const risk=positionRisk({balance:value(form.balance),cashAvailable:value(form.cash),entry:value(form.entry),stop:value(form.stop),riskPercent:value(form.risk),openRisk:value(form.openRisk),sectorExposure:value(form.exposure),portfolioLimit:value(form.portfolio),sectorLimit:value(form.sector),adv20});
 return <section className="decision-tools" aria-label={`${ticker} 가치 가정과 손실 계획`}>
  <details className="ea-fold"><summary>내 가정으로 가치 범위·안전마진 계산</summary>
   <p>분석가 전망·적정가가 아닌 직접 입력한 가정입니다. 정상 이익과 배수를 검증하기 전에는 매수 판정을 만들지 않습니다. 주식 수 증가에 따른 증자 대금·부채·우선주 효과는 별도로 추정해야 합니다.</p>
   {ticker==='ARVN'?<p>임상·라이선스 사업에는 이익 배수 계산을 적용하지 않습니다. 후보별 성공확률·회사 귀속 계약 수익·남은 개발 비용의 검증이 필요합니다.</p>:<>
    <p>참고 보고 매출 {revenue!=null?money(revenue):'미확인'} · 보고 기간을 확인하고 아래에는 가정한 연간 정상 매출을 입력하세요.</p>
    <label>가정 연간 매출 ($M)<input type="number" min="0" value={sales} onChange={e=>setSales(e.target.value)} /></label>
    <div className="decision-cases">{cases.map((c,i)=>{const result=fresh&&price&&marketCap?equityScenario({price,marketCap,revenue:value(sales)*1e6,netMargin:value(c.margin)/100,pe:value(c.pe),shareGrowth:value(c.dilution)/100}):null;return <article key={c.name}><b>{c.name} 가정</b>{[['margin','정상 순이익률 (%)'],['pe','가정 P/E'],['dilution','주식 수 증가 (%)']].map(([k,label])=><label key={k}>{label}<input type="number" min="0" value={c[k as 'margin'|'pe'|'dilution']} onChange={e=>setCases(cs=>cs.map((x,j)=>j===i?{...x,[k]:e.target.value}:x))} /></label>)}<p>{result?`가정 주당 가치 ${money(result.fairPrice)} · 현 가격 대비 ${(result.upside*100).toFixed(1)}% · 안전마진 ${(result.safetyMargin*100).toFixed(1)}%`:'현재 시세와 모든 가정을 입력한 뒤 계산합니다.'}</p></article>})}</div>
   </>}
  </details>
  <details className="ea-fold"><summary>진입·손절·보유 기한·계좌 손실 한도 계산</summary>
   <p>가상 계획입니다. 금액은 USD이며 기존 보유의 손실 위험과 같은 산업 노출을 직접 입력합니다. 예시 한도는 권장 비중이 아닙니다. 기준 종가 {money(price??undefined)} · {asOf}</p>
   <div className="decision-fields">{[['balance','계좌 총자산 ($)'],['cash','사용 가능 현금 ($)'],['entry','계획 진입가 ($)'],['stop','가설 무효화 손절가 ($)'],['risk','이 거래 손실 한도 (%)'],['openRisk','기존 보유 손절 기준 손실 ($)'],['exposure','같은 산업 기존 노출 ($)'],['portfolio','전체 손절 위험 한도 (%)'],['sector','같은 산업 노출 한도 (%)']].map(([k,label])=><label key={k}>{label}<input type="number" min="0" value={form[k as keyof typeof form]} onChange={e=>edit(k as keyof typeof form,e.target.value)} /></label>)}<label>재검토·보유 기한<input type="date" value={form.deadline} onChange={e=>edit('deadline',e.target.value)} /></label></div>
   <p>{!fresh?'시세 갱신 전 계산을 보류합니다.':!form.deadline?'보유 기한과 입력값을 확인하세요.':Date.parse(form.deadline)<Date.now()-86400000?'보유 기한이 지났습니다. 계획을 다시 검토하세요.':risk.valid?`한도 내 최대 ${risk.quantity}주 · 투입 ${money(risk.cost)} · 손절 기준 손실 ${money(risk.loss)} · 전체 위험 ${risk.portfolioRiskPercent?.toFixed(2)}% · 같은 산업 노출 ${risk.sectorPercent?.toFixed(1)}%`:risk.reason}</p>
   {fresh&&form.deadline&&risk.valid&&<p>손절가보다 10% 낮은 가격에서 체결된다는 별도 스트레스 가정의 손실 {money(risk.gapStressLoss)}. 갭·유동성 부족으로 실제 손실은 계획을 초과할 수 있습니다. {risk.liquidityKnown?'평균 거래대금의 1% 이내라는 모의 유동성 한도도 적용했습니다.':'거래대금이 없어 유동성 한도는 미검증입니다.'}</p>}
  </details>
 </section>;
}
