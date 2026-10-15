import { useEffect, useState } from 'react';
import { sectorFlowReport } from '../../../../packages/analysis/sector-flows.mjs';
import { fetchSectors, type Sectors } from '../lib/snapshot';
import { fmtPct } from '../lib/format';
export function SectorFlows(){
 const report=sectorFlowReport();const [prices,setPrices]=useState<Sectors|null>(null);const [error,setError]=useState(false);
 useEffect(()=>{let active=true;fetchSectors().then(d=>{if(active)setPrices(d)}).catch(()=>{if(active)setError(true)});return()=>{active=false}},[]);
 const priceAge=prices?(Date.now()-Date.parse(prices.asOf+'T00:00:00Z'))/86400000:Infinity;
 const usablePrices=priceAge>=0&&priceAge<=4;
 return <section className="panel sector-flows" aria-label="최근 섹터 자금 흐름과 사업 분석">
  <div className="pad-box"><span className="section-overline">CAPITAL FLOWS · REVIEWED WEEK</span><h2>최근 돈이 모인 섹터 · 왜 이익이 될까</h2>
  <p>검토한 주간 집계에서는 기술·에너지·커뮤니케이션·유틸리티 순으로 순유입이 컸습니다. 유입은 관심의 흔적이며 상승 초입이나 적정 가격을 보증하지 않습니다.</p>
  <p className="muted">집계 {report.periodStart}~{report.periodEnd} · 보도 {report.publishedAt} · 검토 {report.reviewedAt} · 유효 {report.expiresAt}까지</p>
  <p className="small">대표 SPDR 섹터 ETF 11개의 달러 순유입 비교입니다. 섹터 전체 자금·기관 전체 매수·AUM 대비 강도 순위가 아닙니다. {report.quality}.</p>
  <a href={report.url} target="_blank" rel="noreferrer">{report.source} 원문 ↗</a>
  {report.status!=='reviewed'?<p role="status">{report.status==='expired'?'주간 자금 자료가 만료됐습니다. 최신 유입 순위는 재검토 전까지 숨깁니다.':'현재 날짜에 검토 완료된 자금 자료가 없습니다.'}</p>:<p>이번 주의 전환 여부는 아직 미확인입니다. 아래 가격은 {usablePrices?prices?.asOf:'최신값 미확인'} 기준으로 별도 비교합니다. 최신 시세가 주간 유입을 갱신하지는 않습니다.</p>}</div>
  {report.rows.filter(r=>r.story).map(r=>{const s=r.story!;const g=usablePrices?prices?.groups.find(g=>g.etf===r.etf):null;return <details className="sector-idea" key={r.etf}>
   <summary><b>{r.name} · {r.etf}</b><span>주간 순유입 ${(r.netMillions/1000).toFixed(2)}B · 보도 기준</span><p>{s.headline}</p><small>{g?`${g.phaseKo} · 3개월 ${fmtPct(g.metrics.ret3m)} · SPY 대비 ${fmtPct(g.metrics.rs3m)}`:'가격 국면 확인 대기'}</small></summary>
   <div className="sector-idea-body"><h3>사업 스토리 · 조건부 분석</h3><p>{s.story}</p><h3>원문에서 확인한 사실·전망</h3><p>{s.evidence}</p><h3>기업 이익과 주주 현금으로 이어지는 경로</h3><p>{s.profits}</p><h3>진입 전에 확인할 것</h3><p>{s.check}</p><p>{g?`${g.phaseKo}: 200일선 대비 ${fmtPct(g.metrics.vs200)}. 가격 국면은 실적 사이클과 별도이며 바닥 확정 판정이 아닙니다.`:'현재 가격·밸류에이션을 확인하지 못했으므로 진입 판단은 보류합니다.'}</p><h3>스토리가 깨지는 조건</h3><p>{s.failure}</p><h3>관련 사업 관찰</h3><p>{s.related}</p>{s.sources.map(source=><a className="ea-story-source" href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label} · {source.date} ↗</a>)}
   <button className="ea-collapse" onClick={e=>{const d=e.currentTarget.closest('details');if(d){d.open=false;(d.querySelector('summary') as HTMLElement)?.focus({preventScroll:true});d.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}}}>다 읽었어요 · 섹터 접기 ▴</button></div>
  </details>})}
  {report.status==='reviewed'&&<details className="sector-idea"><summary>나머지 섹터 순유입 보기</summary><div className="sector-idea-body">{report.rows.filter(r=>!r.story).map(r=><p key={r.etf}>{r.name} ({r.etf}) · ${r.netMillions.toFixed(2)}M · 개별 사업 심층 검토 대기</p>)}</div></details>}
  <p className="footnote pad">가격 국면은 야간 자동 갱신합니다.{error?' 현재 가격 자료를 불러오지 못했습니다.':''} 자금 순유입과 위 사업 스토리는 검토된 자료이며 자동 일별 수급 피드가 아닙니다. 유효기간 이후 순위를 숨깁니다. 거래량·ETF 가격 상승·운용자산 증가를 순유입으로 대체하지 않습니다. 시장 브리핑의 위험 국면과 개별 기업 공시·희석·가격 검증을 함께 확인하세요.</p>
 </section>;
}
