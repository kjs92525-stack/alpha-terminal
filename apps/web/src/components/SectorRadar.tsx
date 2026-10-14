import { useEffect, useState } from 'react';
import { buildSectorRadar, type SectorRadar as RadarData } from '../../../../packages/analysis/sector-stories.mjs';
import { fetchSectors, SNAPSHOT_BASE } from '../lib/snapshot';
import { useTerminal } from '../lib/store';
import { fmtPct, fmtUsd } from '../lib/format';
export function SectorRadar(){
 const {select,setPage}=useTerminal();const [data,setData]=useState<RadarData|null>(null);const [error,setError]=useState('');
 useEffect(()=>{const ctrl=new AbortController();(async()=>{
  const r=await fetch(`${SNAPSHOT_BASE}/sector-radar.json`,{signal:ctrl.signal,cache:'no-cache'});
  if(r.ok){setData(await r.json());return;}
  if(r.status!==404)throw new Error(`섹터 스토리 HTTP ${r.status}`);
  const sectors=await fetchSectors();if(!ctrl.signal.aborted)setData(buildSectorRadar({asOf:sectors.asOf,groups:sectors.groups}));
 })().catch(e=>{if(!ctrl.signal.aborted)setError(e.message);});return()=>ctrl.abort();},[]);
 return <section className="panel sector-radar" aria-label="섹터 스토리와 관련 기업">
  <div className="pad-box"><span className="section-overline">NEXT CYCLE · INDUSTRY THESIS</span><h2>다음 사이클을 준비하는 산업과 기업</h2><p className="muted">산업 수요와 주가 국면을 함께 보고 관찰 우선순위를 정합니다. 관련 기업은 사업 원문으로 연결하며 매수 검증은 별도입니다.</p>{data&&<small>시세 기준 {data.asOf} · 산업 자료 검토 2026-10-14</small>}</div>
  {error&&<p className="pad-box" role="alert">{error}</p>}{!data&&!error&&<p className="pad-box">산업 스토리를 불러오는 중…</p>}
  {data&&!data.ideas.length&&<p className="pad-box">산업 원문 자료의 유효기간이 지나 재검토가 필요합니다.</p>}
  {data?.ideas.map(idea=><details className="sector-idea" key={idea.id}><summary><b>{idea.name}</b><span>{idea.stance}</span><p>{idea.headline}</p><small>관련 관찰 기업: {idea.related.map(r=>r.ticker).join(' · ')}</small></summary>
   <div className="sector-idea-body"><h3>세계정세·정책·수요의 변화</h3><p>{idea.world}</p><h3>어떻게 기업 이익이 되나</h3><p>{idea.chain}</p>
   <h3>가격은 얼마나 따라왔나</h3><p>ETF는 광범위한 업종의 가격 대용 지표이며 해당 세부 산업이나 개별 기업의 실적 사이클을 그대로 나타내지 않습니다.</p>{idea.proxies.length?idea.proxies.map(g=><p key={g.etf}>{g.etf}: {g.phaseKo} · 3개월 {fmtPct(g.metrics.ret3m)} · SPY 대비 {fmtPct(g.metrics.rs3m)}</p>):<p>ETF 국면 데이터 부족 — 초입 판정을 보류합니다.</p>}
   <h3>사이클 전환의 확인 신호</h3><p>{idea.leading}</p><h3>가설이 틀리는 경우</h3><p>{idea.failure}</p>
   {idea.sources.filter(s=>s.date<=data.asOf).map(s=><a className="ea-story-source" key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label} · {s.date} ↗</a>)}
   <h3>사업 연결로 고른 관찰 기업</h3>{idea.related.map(r=><article className="sector-stock" key={r.ticker}><h4>{r.ticker} · {r.name}</h4><p>{r.link}</p><p>{r.fact}</p><small>원문 발표 {r.date} · {r.role}</small><p>시세일 {r.lastDate??'미확인'} · 종가 {r.price!=null?`$${r.price.toFixed(2)}`:'미확인'} · 시총 {fmtUsd(r.marketCap??null)} · 3개월 {fmtPct(r.ret63??null)}</p><small>{r.source??'시세 수집 대기'}</small>{r.warnings.map(w=><p className="sector-warning" key={w}>{w}</p>)}<p>다음 확인: {r.next}</p><p>위험: {r.risk}</p><a href={r.url} target="_blank" rel="noreferrer">기업 연결 근거 ↗</a><button className="ea-button" onClick={()=>{select(r.ticker);setPage('research');}}>기업 분석 열기 ↗</button></article>)}
   <button className="ea-collapse" onClick={e=>{const detail=e.currentTarget.closest('details');if(detail){detail.open=false;(detail.querySelector('summary') as HTMLElement)?.focus({preventScroll:true});detail.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}}}>이 산업 스토리 접기 ▴</button>
   </div></details>)}
  {data&&<p className="footnote pad">{data.method} 가격·국면은 야간 자동 갱신됩니다. 산업·기업 연결 원문은 현재 검토된 세 산업·여섯 기업이며, 새 원문을 자동으로 심층 검증하는 기능은 아닙니다.</p>}
 </section>;
}
