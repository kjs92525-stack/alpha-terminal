import { companyDossier, type DossierRow } from '../../../../packages/analysis/company-dossier.mjs';
import { MacroStory } from './MacroStory';
export function CompanyDossier({row,asOf}:{row:DossierRow;asOf:string}) {
  const d=companyDossier(row,asOf);if(!d)return null;
  return <section className="ea-story company-dossier" aria-label={`${row.ticker} 투자 논리 전문`}>
    <small>기업 원문 기반 해석 · 보고 {d.report.period} · 발표 {d.report.publishedAt} · 편집 검토 {d.story.reviewedAt}</small>
    <h3 className="ea-story-title">{d.headline}</h3>
    <p className="dossier-lead">{d.opening}</p>
    <MacroStory ticker={row.ticker} asOf={asOf} />
    <h3>산업의 기회가 이 회사의 돈이 되는 과정</h3><p>{d.mechanism}</p>
    <h3>변화는 어디까지 입증됐나</h3><p>{d.story.change}</p><p>{d.evidence}</p>
    <h3>낙관론과 반론, 무엇이 승부를 가르나 <small>분석 가설</small></h3><p>{d.disagreement}</p>
    <h3>좋은 이야기라도 이 가격에 살 만한가</h3><p>{d.priceBridge}</p><p>{d.price}</p>
    <div className="dossier-events"><h3>다음 실적·공시에서 판단을 바꿀 사건</h3><p><b>가설 강화</b> {d.report.confirm}</p><p><b>가설 약화</b> {d.report.invalidate}</p><p>공시가 없거나 수집에 실패한 상태는 조건 충족으로 처리하지 않습니다. 날짜가 확정되지 않은 사건을 예정된 성과로 보지 않습니다.</p></div>
    <div className="dossier-verdict"><h3>현재 판단</h3><p>{d.verdict}</p><p>{d.missing}</p></div>
    <details className="ea-fold"><summary>이 글의 사실 근거와 검증 범위</summary><p>기업 발표는 경영진 설명입니다. 계약 상대방의 확인·독립적인 경쟁력 검증·모든 최신 공시의 검토까지 완료했다는 뜻이 아닙니다. 산업 전망은 확정 주문과 구분합니다. 신규 분기 자료나 검토 유효기간이 지나면 이 글 대신 검증 대기 요약을 표시합니다.</p>{d.story.sources.map(s=><a className="ea-story-source" key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a>)}<a className="ea-story-source" href={d.report.source} target="_blank" rel="noreferrer">보고기간 {d.report.period} 재무 검증 원문 ↗</a></details>
  </section>;
}
