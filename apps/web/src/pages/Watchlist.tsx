import { useMemo, useState } from 'react';
import { ArrowUpRight, Bookmark, Trash2 } from 'lucide-react';
import type { MarketStock } from '../../../../packages/analysis/market-map.mjs';
import { useTerminal } from '../lib/store';
import { useResearchData, uniqueSetups, financialFlags } from '../lib/research';
import { fmtPct, fmtPrice } from '../lib/format';
import { StockBrief } from '../components/StockBrief';

export function Watchlist() {
  const {watchlist,toggleWatch,select,setPage}=useTerminal(),{market,setups,error,loading}=useResearchData();
  const [selected,setSelected]=useState<MarketStock|null>(null);
  const setupBy=useMemo(()=>uniqueSetups(setups),[setups]);
  return <div><div className="rd-page-note"><Bookmark size={20}/><div><b>가격 알림보다, 가설을 계속 확인하는 목록</b><p>저장한 기업의 실적 변화와 자금 조달 위험을 함께 봅니다. 새 공시를 모두 검토한 목록이라는 뜻은 아닙니다.</p></div><span>{watchlist.length}개 저장</span></div>{error&&<p className="rd-notice" role="alert">{error}</p>}{loading&&!market&&<div className="rd-empty">관심종목 데이터를 확인하고 있습니다…</div>}{!watchlist.length&&<div className="rd-empty large"><Bookmark size={34}/><h2>관심을, 검토할 목록으로.</h2><p>시장맵의 기업 요약에서 저장하면 여기에 표시됩니다.</p><button className="rd-button primary" onClick={()=>setPage('market-map')}>미국 주식 시장맵 열기 <ArrowUpRight size={15}/></button></div>}
    <div className="watchlist-grid">{watchlist.map(symbol=>{const s=market?.stocks.find(s=>s.symbol===symbol),flags=financialFlags(setupBy.get(symbol));return <article className="watch-card" key={symbol}><div className="watch-card-heading"><button onClick={()=>{if(s)setSelected(s);else{select(symbol);setPage('research');}}}><b>{symbol}</b><small>{s?.name??'시세 스냅샷 미수집'}</small></button><button className="rd-icon" aria-label={`${symbol} 관심종목 해제`} onClick={()=>toggleWatch(symbol)}><Trash2 size={16}/></button></div><div className="watch-price"><strong>{s?`$${fmtPrice(s.price)}`:'—'}</strong><span className={(s?.ret1??0)>0?'rd-rise':'rd-fall'}>{fmtPct(s?.ret1??null)}</span><small>{s?.priceAsOf??'기준일 미확인'}</small></div><div className="pick-observation"><small>실적 변화</small><p>{flags.positive.join(' · ')||'최신 분기 개선 신호 미확인'}</p></div><div className="pick-counter"><small>위험·다음 확인</small><p>{flags.risks.slice(0,2).join(' · ')||'가격·가치·공시 원문 검토'}</p></div><button className="industry-open" onClick={()=>{if(s)setSelected(s);else{select(symbol);setPage('research');}}}>기업 검토 이어가기 <ArrowUpRight size={15}/></button></article>;})}</div>
    {selected&&<StockBrief stock={selected} row={setupBy.get(selected.symbol)} asOf={market?.asOf??''} onClose={()=>setSelected(null)}/>}
  </div>;
}
