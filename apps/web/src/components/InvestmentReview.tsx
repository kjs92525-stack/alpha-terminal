import { investmentReview, type InvestmentInput } from '../../../../packages/analysis/investment-review.mjs';
const stateLabel:Record<string,string>={caution:'추가 검증',blocked:'반복성 미확인',missing:'미확인'};
export function InvestmentReviewPanel({input}:{input:InvestmentInput}) {
  const r=investmentReview(input);
  return <section className="investment-review" aria-label="투자 판단 검토">
    <small>INVESTMENT REVIEW · 기준 {input.asOf}</small>
    <h3>{r.verdict}</h3><p>{r.summary}</p>
    {r.report && <p className="review-source">원문 검토: 보고기간 {r.report.period} · 발표 {r.report.publishedAt} <a href={r.report.source} target="_blank" rel="noreferrer">검증 근거 ↗</a></p>}
    <h4>시장이 의심할 이유</h4><p>{r.doubt}</p>
    <h4>판단을 바꿀 확인 조건</h4><p>{r.confirm}</p>
    <h4>투자 가설을 접을 조건</h4><p>{r.invalidate}</p>
    <details className="ea-fold"><summary>현금·이익·희석·가치 검토 {r.checks.length}항목</summary>{r.checks.map(c=><div className="review-check" key={c.label}><b>{c.label} <span>{stateLabel[c.state]}</span></b><p>{c.text}</p></div>)}</details>
    <details className="ea-fold"><summary>현재 가격이 요구하는 이익과 현금 비교</summary>
      <p>기준 종가 {r.price===null?'미확인':`$${r.price.toFixed(2)}`} · 시총 {input.marketCap===null?'미확인':`$${(input.marketCap/1e6).toFixed(1)}M`} (주식 수 추정 오차 가능)</p>
      <p>{r.cashNote}</p>{r.restricted!==null&&<p>제한된 현금 ${(r.restricted/1e6).toFixed(1)}M은 위 금액에 더하지 않았습니다.</p>}
      {r.cashCoverage!==null&&<p>보고 자금/현재 시총 {(r.cashCoverage*100).toFixed(1)}% — 현금이 미래 비용으로 소진되므로 저평가 판정에 사용하지 않습니다.</p>}
      {r.sensitivities.length?<><p>아래는 가상의 P/E와 향후 주식 수 증가를 가정했을 때, 현재 주가를 유지하기 위해 필요한 연간 정상 순이익입니다. 비교 기업의 적정 배수·실적 전망·목표가가 아닙니다. 증자 대금에 따른 사업 변화도 별도로 검토해야 합니다.</p><div className="ea-table-wrap"><table className="ea-table"><thead><tr><th>가정</th><th>필요 연간 이익</th></tr></thead><tbody>{r.sensitivities.map(s=><tr key={s.name}><td>{s.name}</td><td>${(s.requiredProfit/1e6).toFixed(1)}M</td></tr>)}</tbody></table></div></>:<p>계약·임상 단계 사업은 후보물질별 성공확률과 회사 귀속 현금흐름으로 평가해야 합니다. 해당 가정이 없어 적정가를 제시하지 않습니다.</p>}
      <p>보수·기준·낙관 가치 범위와 안전마진은 아직 산정되지 않았습니다. 자료 부족을 0원 가치나 매수 신호로 취급하지 않습니다.</p>
    </details>
  </section>;
}
