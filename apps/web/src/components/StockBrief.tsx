import { useEffect, useRef } from 'react';
import { ArrowUpRight, Bookmark, Check, ExternalLink, X } from 'lucide-react';
import { MARKET_THEMES, type MarketStock } from '../../../../packages/analysis/market-map.mjs';
import type { SetupRow } from '../lib/snapshot';
import { financialFlags } from '../lib/research';
import { useTerminal } from '../lib/store';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';

export function StockBrief({ stock, row, asOf, onClose }: { stock: MarketStock; row?: SetupRow; asOf: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { select, setPage, watchlist, toggleWatch } = useTerminal();
  const flags = financialFlags(row), theme = MARKET_THEMES.find(t => t.id === stock.themes[0]?.id);
  const news = (row?.news ?? []).filter(n => n.url && n.time?.slice(0,10) <= asOf).slice(0,3);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  const open = () => { select(stock.symbol); setPage('research'); onClose(); };
  return <dialog ref={ref} className="stock-dialog" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="stock-brief-title">
    <div className="stock-dialog-body">
      <div className="brief-heading"><span className="section-label">COMPANY BRIEF / {asOf}</span><button className="rd-icon" aria-label="기업 요약 닫기" onClick={onClose}><X size={20} /></button></div>
      <h2 id="stock-brief-title">{stock.symbol} <span>{stock.name}</span></h2>
      <div className="brief-price"><strong>${fmtPrice(stock.price)}</strong><span className={stock.ret1 != null && stock.ret1 > 0 ? 'rd-rise' : 'rd-fall'}>{fmtPct(stock.ret1)} <small>1일</small></span><button className="rd-button" onClick={() => toggleWatch(stock.symbol)}>{watchlist.includes(stock.symbol) ? <Check size={15} /> : <Bookmark size={15} />}{watchlist.includes(stock.symbol) ? '관심 등록됨' : '관심종목 저장'}</button></div>
      <div className="rd-tags">{stock.themes.map(t => <span key={t.id}>{t.name} / {t.group}</span>)}{!stock.themes.length && <span>사업 테마 분류 대기</span>}</div>
      <div className="brief-metrics"><div><small>시가총액 · 추정</small><b>{fmtUsd(stock.mcap)}</b></div><div><small>1개월 / 3개월</small><b>{fmtPct(stock.ret21)} / {fmtPct(stock.ret63)}</b></div><div><small>20일 평균 거래대금</small><b>{fmtUsd(stock.adv20)}</b></div></div>
      {stock.mcapSource && <p className="rd-muted">시총: {stock.mcapSource}. {stock.mcapNote}</p>}
      {!!stock.aliases?.length && <p className="rd-muted">같은 발행사 {stock.aliases.join(' · ')}는 시총 중복 합산을 피하기 위해 유동성이 큰 대표 티커로 표시합니다.</p>}
      <section><span className="section-label">01 / BUSINESS CONNECTION</span><h3>무엇이 이 기업의 수요를 바꾸나</h3><p>{theme?.mechanism ?? '이 기업의 사업과 산업 수요를 연결하는 편집 검토가 아직 없습니다. 원문 사업보고서를 확인하세요.'}</p>{theme && <p className="brief-question"><b>다음 확인</b> {theme.confirm}</p>}<small className="rd-muted">사업 연결은 분석 가설입니다. 테마 편입이 관련 매출 비중이나 수익 증가를 입증하지 않습니다.</small></section>
      <section><span className="section-label">02 / OBSERVATIONS</span><h3>가격과 재무에서 확인된 변화</h3><p>종가 기준 {stock.priceAsOf || asOf} · 일간 {fmtPct(stock.ret1)}. <b>가격 변동의 직접적인 원인은 확인되지 않았습니다.</b></p><div className="rd-tags">{flags.positive.length ? flags.positive.map(t => <span className="positive" key={t}>{t}</span>) : <span>최근 분기 실적 개선 신호 미확인</span>}</div>{row?.revenueYoY?.length ? <div className="brief-quarters">{row.revenueYoY.slice(-3).map(q => <div key={q.end}><small>{q.end} 매출 YoY</small><b>{fmtPct(q.yoy)}</b></div>)}</div> : <p className="rd-muted">분기 매출 변화는 아직 연결되지 않았습니다. 미확인은 실적 부진이나 안전함을 뜻하지 않습니다.</p>}{stock.revenueGrowth != null && <p>수집된 보고기간 매출 성장률 {fmtPct(stock.revenueGrowth)} · 연간/TTM 기준, 분기 가속과 구분</p>}</section>
      <section className="brief-risk"><span className="section-label">03 / COUNTER THESIS</span><h3>투자 가설을 다시 볼 이유</h3><p>{theme?.risk ?? '사업 지속성, 재무 건전성, 주식 수 증가와 적정 가치 검토가 필요합니다.'}</p><ul>{flags.risks.map(t => <li key={t}>{t}</li>)}</ul>{row?.edge?.dilution && !row.edge.dilution.offering && !row.edge.dilution.shelf && <p>수집된 공시 창에서 발행·등록 신호가 탐지되지 않았습니다. 향후 증자 가능성까지 배제하지 않습니다.</p>}</section>
      {!!news.length && <section><span className="section-label">RELATED HEADLINES / 인과관계 미검증</span>{news.map(n => <a className="brief-source" key={n.url} href={n.url} target="_blank" rel="noreferrer">{n.headline}<small>{n.time.slice(0,10)} <ExternalLink size={12} /></small></a>)}</section>}
      <div className="brief-source-row"><a href={`https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(stock.symbol.replace('.','-'))}&owner=exclude`} target="_blank" rel="noreferrer">SEC 공시 원문 <ExternalLink size={12} /></a><span>야간 지연 시세 · 실시간 아님</span></div>
      <button className="rd-button primary full" onClick={open}>기업 리서치 전체 보기 <ArrowUpRight size={16} /></button>
    </div>
  </dialog>;
}
