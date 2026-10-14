import { businessStory } from '../../../../packages/analysis/business-stories.mjs';
interface Row {ticker:string;name?:string;reportPeriod?:string|null;reasons?:Array<{factor:string;points:number;text:string}>}
export function BusinessStory({row,asOf}:{row:Row;asOf:string}){
 const s=businessStory(row.ticker,asOf);if(!s)return null;
 const growth=row.reasons?.find(r=>r.factor==='growth'&&r.points>0);
 const profit=row.reasons?.find(r=>r.factor==='profitability'&&r.points>0);
 return <section className="ea-story business-story" aria-label={`${row.ticker} 사업과 투자 가설`}>
  <small>기업별 사업 설명 · 자료 확인 2026-10-15 한국시간 · 가격 기준 {asOf}</small>
  <h3 className="ea-story-title">{row.ticker}는 무엇으로 돈을 버는 회사인가</h3><p className="dossier-lead">{s.business}</p>
  <h3>고객이 왜 돈을 쓰는가</h3><p>{s.demand}</p>
  <h3>수요가 이익·주당 가치로 이어지는 과정 <small>조건부 분석</small></h3><p>{s.economics}</p>
  <h3>지금 실적은 이 이야기를 입증하는가</h3>
  <p>{row.reportPeriod?`${row.reportPeriod} 보고기간의 자동 재무 신호입니다. `:'최신 보고기간 연결이 확인되지 않았습니다. '}{growth?growth.text+'. ':'매출 성장의 확인 가능한 가점은 없습니다. '}{profit?profit.text+'. ':'반복 수익성 개선의 확인 가능한 가점은 없습니다. '}</p>
  <p>이 수치는 위 제품의 고객 주문이나 본업 반복 이익을 입증하지 않습니다. 인수·사업 전환·일회성 효과를 제거한 동일 사업 자료와 대조해야 합니다.</p>
  <h3>다음 실적에서 가설을 판정할 지표</h3><ul className="business-checks">{s.indicators.map(x=><li key={x}>{x.trim()}</li>)}</ul>
  <p>이 지표가 함께 개선되면 가설이 강해집니다. 관련 부문 수치가 없으면 확인된 것으로 처리하지 않습니다.</p>
  <div className="ea-story-risk"><h3>이야기가 깨지는 지점</h3><p>{s.risk}</p></div>
  <a className="ea-story-source" href={s.url} target="_blank" rel="noreferrer">{s.sourceLabel} ↗</a>
  <details className="ea-fold"><summary>자료와 해석의 범위</summary><p>날짜 없는 사업 페이지의 확인일은 발표일이 아닙니다. 기업 홈페이지 설명은 독립적으로 입증된 경쟁력과 구분합니다. 2026-10-14 이전 기준일에는 이 사업 설명을 과거 자료로 소급 표시하지 않습니다.</p><p>{s.interpretation}</p><p>{s.limitation}</p></details>
 </section>;
}
