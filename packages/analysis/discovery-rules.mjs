// Shared discovery rules: the same checks decide what the site lists and what the nightly
// paper-trade ledger records, so the track record measures exactly what is shown.
import { businessStory } from './business-stories.mjs';
import { businessEvidence, EVENT_EVIDENCE as EV } from './business-evidence.mjs';
const pp=(x)=>`${x>=0?'+':''}${(x*100).toFixed(1)}%p`;

export function earlyIssues(row,asOf,mode='early'){
 const issues=[];if(businessStory(row.symbol,asOf)?.model==='treasury')issues.push('자산 보유형 · 주당 NAV 원문 검증 필요');const type=row.type??'breakout',q=row.narrative?.quality;
 if(!row.plan||![row.plan.entry,row.plan.stop,row.plan.target,row.plan.riskPct,row.plan.rMultiple].every(v=>typeof v==='number'&&Number.isFinite(v))||row.plan.stop>=row.plan.entry||row.plan.target<=row.plan.entry||row.plan.riskPct <= 0||row.plan.riskPct > 0.15||row.plan.rMultiple < 1.5)issues.push('진입·무효화·보상 가정 부족');
 if(row.priceAsOf!==asOf)issues.push('당일 종가 미확인');
 if(row.ret1==null||row.ret5==null||!Number.isFinite(row.ret1)||!Number.isFinite(row.ret5))issues.push('최근 급등 확인 자료 부족');
 else if(row.ret1>0.12||row.ret5>0.2)issues.push('하루 +12%·5거래일 +20% 초과');
 if(type==='pullback')issues.push('상승 후 눌림목');
 if(row.mcap==null||!Number.isFinite(row.mcap)||row.mcap<25e6||row.mcap>5e9)issues.push('시총 $25M~$5B 범위 밖·미확인');
 if(row.ret63==null||!Number.isFinite(row.ret63)||row.ret21==null||!Number.isFinite(row.ret21))issues.push('추격 여부 자료 부족');
 else if(row.ret63>0.35||row.ret21>0.2)issues.push('63일 +35%·21일 +20% 초과');
 if(mode==='pivot'){
  // asset pivot (IREN-type): the change is contracts / build-out, not this quarter's profit
  const p=row.assetPivot;if(!p?.pivot)issues.push(p?.acquisition?'인수·합병 기사 — 사업 전환 아님':'대형 계약·설비 확장 근거 없음');
  if(p?.pivot&&p.selfFunded!==true&&!(typeof p.fundedMonths==='number'&&p.fundedMonths>=18))issues.push('설비투자 포함 현금 18개월 미만·미확인');
 }else{
 // the validated definition (filing event study): sales growth > 5% YoY and 2%p faster than the
 // prior quarter, from a quarter ended within ~8 months; income improvement alone showed no excess
 const ev=businessEvidence(row,asOf);
 if(q?.growthBlocked)issues.push('매출 비교 불가(사업 범위 변화) — 원문 확인 필요');
 else if(!ev.revAccel)issues.push(ev.niImproved?`이익 개선만 · 매출 가속 없음 (과거 120일 SPY ${pp(EV.niOnly.excess120)})`:'현재 분기 매출 가속 근거 부족');
 }
 // offering / shelf filings lagged SPY by ~8-9%p over 120 sessions (edge event study)
 if(row.edge?.dilution?.offering)issues.push(`최근 증자 설명서(424B) — 과거 120일 SPY ${pp(EV.offering424B.excess120)}`);
 else if(row.edge?.dilution?.shelf)issues.push(`증자 대기 등록(S-3) — 과거 120일 SPY ${pp(EV.shelfRegistration.excess120)}`);
 if(mode==='early'||mode==='pivot'){
  // a report inside the holding window turns the entry into a bet on the report
  if(row.earningsChecked===false)issues.push('실적 발표일 미확인');
  else if(row.earnings&&row.earnings.sessions<=5)issues.push(`실적 발표 ${row.earnings.sessions}거래일 앞 — 발표 후 판단`);
  if(!['BREAKOUT','POST_BREAKOUT','NEAR_PIVOT','TURNING'].includes(row.stage))issues.push('전환·돌파 확인 전');
  if(row.provisional)issues.push('진행 중인 주봉·월봉');
  if(['weekly_bottom','monthly_bottom'].includes(type)&&(!row.higherLow||!row.aboveMa))issues.push('저점 상승·평균선 회복 미확인');
  if(row.stage==='POST_BREAKOUT'&&(row.extension==null||row.extension>0.08))issues.push('돌파 후 이격 8% 초과·미확인');
 }else if(mode==='watch'&&!['IN_BASE','AT_BOTTOM','TURNING','NEAR_PIVOT'].includes(row.stage))issues.push('바닥 관찰 단계 아님');
 return issues;
}
