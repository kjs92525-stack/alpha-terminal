import { ArrowUpRight, Bookmark, Check, ExternalLink } from 'lucide-react';
import { buildCycleResearch } from '../../../../packages/analysis/next-cycle-research.mjs';
import type { NextCycleStock, NextCycleSector } from '../lib/snapshot';
import { useTerminal } from '../lib/store';
import { fmtPct, fmtPrice } from '../lib/format';

export function NextCycleCompany({stock,sector,asOf,initialOpen=false}:{stock:NextCycleStock;sector:NextCycleSector;asOf:string;initialOpen?:boolean}) {
  const {select,setPage,watchlist,toggleWatch}=useTerminal();
  const r=buildCycleResearch(stock,sector,asOf),p=r.profile;
  const research=()=>{select(stock.symbol);setPage('research');};
  const chart=()=>{select(stock.symbol);setPage('charts');};
  return <article className={`cycle-company${r.sectorMismatch?' needs-review':''}`} aria-label={`${stock.symbol} 사업과 재평가 분석`}>
    <header className="cycle-company-header"><div><span className="cycle-company-state">{r.status}</span><h3><button onClick={research}>{stock.symbol}<ArrowUpRight size={15}/></button></h3><p>{stock.name}</p></div><button className="rd-icon" aria-label={`${stock.symbol} 관심종목 ${watchlist.includes(stock.symbol)?'해제':'저장'}`} onClick={()=>toggleWatch(stock.symbol)}>{watchlist.includes(stock.symbol)?<Check size={16}/>:<Bookmark size={16}/>}</button></header>
    <div className="cycle-company-price"><b>${fmtPrice(stock.price)}</b><span className={(stock.ret63??0)>=0?'rd-rise':'rd-fall'}>{fmtPct(stock.ret63)}<small>3개월</small></span><small>{asOf} 종가</small></div>
    <section className="cycle-business"><small>무엇으로 돈을 버나</small><p>{p?.business??'기업별 사업 원문을 검토하지 못했습니다. 이름이나 업종만으로 사업과 상승 근거를 추정하지 않습니다.'}</p></section>
    <section className="cycle-upside"><small>오를 수 있는 사업상의 근거 · 조건부 해석</small><p>{p?.upside??'원문 검토 후 기업별 재평가 경로를 추가합니다.'}</p></section>
    {r.sectorMismatch&&<p className="cycle-alert">현재 사업과 기존 업종 분류 불일치 — 업종 수혜 판단 보류</p>}
    <details className="cycle-company-detail" open={initialOpen}>
      <summary>근거·재무·반론 분석 <span>펼쳐보기</span></summary>
      <div className="cycle-company-detail-body">
        <section><h4>01. 지금 확인되는 변화 <span>스캐너 자동 집계</span></h4><ul>{r.observations.map(t=><li key={t}>{t}</li>)}</ul></section>
        {!!r.officialFacts.length&&<section className="cycle-official-facts"><h4>회사 발표에서 추가로 확인한 근거</h4>{r.officialFacts.map(f=><div key={f.url}><small>{f.date} · {f.kind==='guidance'?'경영진 전망 · 실현 수치 아님':'회사 발표 수치 · 독립 감사 판단과 구분'}</small><p>{f.text}</p><p><b>투자 가설과의 연결</b> {f.meaning}</p><a href={f.url} target="_blank" rel="noreferrer">해당 발표 원문 <ExternalLink size={12}/></a></div>)}</section>}
        {p&&<><section><h4>02. 매출이 이익·현금이 되는 과정</h4><p>{p.earnings}</p></section><section className="cycle-confirm"><h4>03. 다음 공시에서 가설을 강화할 조건</h4><ol>{p.confirm.map(t=><li key={t}>{t}</li>)}</ol></section><section className="cycle-counter"><h4>04. 가설을 접거나 낮춰 볼 이유</h4><p>{p.risk}</p></section><section><h4>05. 현재 가격에서도 성립하나</h4><p>{p.valuation}</p><small className="cycle-data-note">적정가·상승 확률은 산정하지 않았습니다. 하락률이나 매출 증가율만으로 싸다고 결론내리지 않습니다.</small></section></>}
        <section className="cycle-data-check"><h4>추가 확인이 필요한 항목</h4><ul>{r.cautions.map(t=><li key={t}>{t}</li>)}</ul></section>
        <div className="cycle-verdict"><b>현재 판단</b><p>{r.conclusion}</p></div>
        {p&&<div className="cycle-research-sources"><small>사업 원문 확인 {p.reviewedAt} · 가격·후보 집계 {asOf}{r.reviewAfterSnapshot?' · 가격 기준일 이후의 현재 사업 검토':''}</small>{p.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label}<ExternalLink size={12}/></a>)}<p>원문 링크는 사업·제품 설명의 근거입니다. 위 자동 집계 수치를 해당 원문에서 모두 대조했다는 뜻은 아닙니다. 확인일은 날짜 없는 페이지의 발표일이 아닙니다.</p></div>}
      </div>
    </details>
    <div className="cycle-company-actions"><button className="rd-button" onClick={research}>기업 전체 분석 <ArrowUpRight size={14}/></button><button className="rd-text-link" onClick={chart}>가격 구조 확인 <ArrowUpRight size={14}/></button></div>
  </article>;
}
