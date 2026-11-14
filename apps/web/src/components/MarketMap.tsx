import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, LayoutGrid, List, RefreshCw, Search, X } from 'lucide-react';
import { MARKET_THEMES, groupPerformance, type MarketStock } from '../../../../packages/analysis/market-map.mjs';
import { briefingFreshness } from '../../../../packages/analysis/market-brief.mjs';
import { SECTOR_KO } from '../lib/snapshot';
import { useResearchData, uniqueSetups } from '../lib/research';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { useTerminal } from '../lib/store';
import { StockBrief } from './StockBrief';
import './MarketMap.css';

type Period = 'ret1' | 'ret5' | 'ret21' | 'ret63';
type Rect = { x: number; y: number; w: number; h: number };
const PERIODS: { key: Period; label: string }[] = [{key:'ret1',label:'1일'},{key:'ret5',label:'5일'},{key:'ret21',label:'1개월'},{key:'ret63',label:'3개월'}];
const pos = (r: Rect, b: Rect) => ({left:`${(r.x-b.x)/b.w*100}%`,top:`${(r.y-b.y)/b.h*100}%`,width:`${r.w/b.w*100}%`,height:`${r.h/b.h*100}%`});
function pack<T>(items:T[], weight:(v:T)=>number, rect:Rect):Array<{item:T;rect:Rect}> {
  if(!items.length||rect.w<=0||rect.h<=0)return [];
  if(items.length===1)return [{item:items[0],rect}];
  const sorted=[...items].sort((a,b)=>weight(b)-weight(a)), total=sorted.reduce((n,s)=>n+weight(s),0);
  if(!total)return [];
  let used=0,cut=1;
  for(let i=0;i<sorted.length-1;i++){used+=weight(sorted[i]);cut=i+1;if(used>=total/2)break;}
  const f=used/total, horizontal=rect.w>=rect.h;
  const a=horizontal?{...rect,w:rect.w*f}:{...rect,h:rect.h*f};
  const b=horizontal?{...rect,x:rect.x+a.w,w:rect.w-a.w}:{...rect,y:rect.y+a.h,h:rect.h-a.h};
  return [...pack(sorted.slice(0,cut),weight,a),...pack(sorted.slice(cut),weight,b)];
}
const tone=(n:number|null)=>n===null?'':n>0?'rd-rise':n<0?'rd-fall':'';
function tileColor(ret:number|null,period:Period){
  if(ret===null)return '#343c4c';
  const max=period==='ret1'?.05:period==='ret5'?.12:period==='ret21'?.25:.5;
  const alpha=.32+.62*Math.min(Math.abs(ret)/max,1);
  return ret>0?`rgba(213,79,87,${alpha})`:ret<0?`rgba(60,112,194,${alpha})`:'#343c4c';
}

export function MarketMap({compact=false}:{compact?:boolean}) {
  const {mapTheme,setMapTheme,setPage}=useTerminal();
  const {market,setups,error,loading,refresh}=useResearchData();
  const [view,setView]=useState<'sector'|'theme'>(()=>mapTheme?'theme':'sector');
  const [period,setPeriod]=useState<Period>('ret1'),[size,setSize]=useState<'cap'|'equal'>('cap');
  const [display,setDisplay]=useState<'map'|'list'>(()=>!compact&&window.matchMedia('(max-width:600px)').matches?'list':'map');
  const [focus,setFocus]=useState(''),[q,setQ]=useState(''),[selected,setSelected]=useState<MarketStock|null>(null);
  const setupBy=useMemo(()=>uniqueSetups(setups),[setups]);
  const theme=MARKET_THEMES.find(t=>t.id===mapTheme);
  const filtered=useMemo(()=>{
    const query=q.toLowerCase().trim();
    return (market?.stocks??[]).filter(s=>(!theme||s.themes.some(t=>t.id===theme.id))&&(!query||`${s.symbol} ${s.name} ${s.aliases?.join(' ')??''}`.toLowerCase().includes(query))&&(size==='equal'||s.mcap!==null&&s.mcap>0));
  },[market,theme,q,size]);
  const rows=useMemo(()=>[...filtered].sort((a,b)=>(b.mcap??0)-(a.mcap??0)).slice(0,compact?64:240),[filtered,compact]);
  const groups=useMemo(()=>{
    const all=new Map<string,MarketStock[]>();
    for(const stock of rows){
      const key=theme?stock.themes.find(t=>t.id===theme.id)!.group:view==='sector'?(SECTOR_KO[stock.sector]||stock.sector):stock.themes[0]?.name||'사업 분류 대기';
      all.set(key,[...(all.get(key)??[]),stock]);
    }
    return [...all].map(([key,stocks])=>({key,stocks,weight:stocks.reduce((sum,s)=>sum+(size==='equal'?1:s.mcap??0),0)}));
  },[rows,theme,view,size]);
  const weight=(s:MarketStock)=>size==='equal'?1:s.mcap??0;
  const root={x:0,y:0,w:1.8,h:1}, blocks=pack(focus?groups.filter(g=>g.key===focus):groups,g=>g.weight,root);
  const stats=groupPerformance(rows,period,size),fresh=briefingFreshness(market);
  const pickTheme=(id:string)=>{setMapTheme(id);setFocus('');setView(id?'theme':'sector');};
  const displayed=focus?rows.filter(s=>groups.find(g=>g.key===focus)?.stocks.includes(s)):rows;
  return <section className={`usmap panel${compact?' is-compact':''}`} aria-label="미국 주식 히트맵">
    <header className="usmap-header"><div><div className="section-label">MARKET AT A GLANCE</div><h2>{theme?theme.name:'미국 시장의 온도'}<span className="usmap-asof">{market?.asOf??'데이터 확인 중'} · 종가</span></h2><p>크기는 시가총액, 색은 가격 변화. 산업의 움직임부터 살펴보세요.</p></div><div className="usmap-header-actions">{compact&&<button className="rd-button" onClick={()=>setPage('market-map')}>시장맵 열기 <ArrowUpRight size={15}/></button>}<button className="rd-icon" aria-label="히트맵 새로고침" disabled={loading} onClick={()=>void refresh()}><RefreshCw size={16}/></button></div></header>
    {!compact&&<div className="usmap-themes" aria-label="사업 테마 필터"><button className={!theme?'active':''} aria-pressed={!theme} onClick={()=>pickTheme('')}>전체 시장</button>{MARKET_THEMES.map(t=><button key={t.id} className={theme?.id===t.id?'active':''} aria-pressed={theme?.id===t.id} onClick={()=>pickTheme(t.id)}>{t.short}</button>)}</div>}
    <div className="usmap-controls"><div className="usmap-segment" role="group" aria-label="지도 분류"><button className={view==='sector'?'active':''} aria-pressed={view==='sector'} onClick={()=>{setView('sector');setMapTheme('');setFocus('');}}>업종맵</button><button className={view==='theme'?'active':''} aria-pressed={view==='theme'} onClick={()=>{setView('theme');setFocus('');}}>테마맵</button></div><div className="usmap-segment" role="group" aria-label="가격 변동 기간">{PERIODS.map(p=><button key={p.key} className={period===p.key?'active':''} aria-pressed={period===p.key} onClick={()=>setPeriod(p.key)}>{p.label}</button>)}</div><div className="usmap-segment" role="group" aria-label="사각형 크기 기준"><button className={size==='cap'?'active':''} aria-pressed={size==='cap'} onClick={()=>setSize('cap')}>시총 비중</button><button className={size==='equal'?'active':''} aria-pressed={size==='equal'} onClick={()=>setSize('equal')}>동일 비중</button></div>{!compact&&<div className="usmap-display"><button aria-label="지도 보기" aria-pressed={display==='map'} className={display==='map'?'active':''} onClick={()=>setDisplay('map')}><LayoutGrid size={16}/></button><button aria-label="목록 보기" aria-pressed={display==='list'} className={display==='list'?'active':''} onClick={()=>setDisplay('list')}><List size={17}/></button></div>}</div>
    {!compact&&<div className="usmap-filter-row"><label className="rd-search"><Search size={15}/><input aria-label="시장맵 종목 검색" placeholder="티커 또는 기업명으로 찾기" value={q} onChange={e=>{setQ(e.target.value);setFocus('');}}/></label><div className="usmap-breadth"><span><ArrowUp size={12}/> {stats.advancing}</span><span><ArrowDown size={12}/> {stats.declining}</span><small>표시 {rows.length} / 해당 {filtered.length}개</small></div></div>}
    {market?.fallback&&<p className="rd-notice">전체 가격 유니버스 준비 중입니다. 현재는 스캐너 후보 {market.stocks.length}개만 제공하며 시장 전체 흐름을 대표하지 않습니다.</p>}
    {market&&!fresh.fresh&&<p className="rd-notice">{fresh.reason} · 과거 스냅샷으로 표시합니다.</p>}
    {theme&&!compact&&<div className="usmap-thesis"><b>사업 연결</b><p>{theme.mechanism}</p><small>확인할 것: {theme.confirm}</small></div>}
    {focus&&<div className="usmap-focus"><b>{focus}</b><button onClick={()=>setFocus('')}>전체로 돌아가기 ×</button></div>}
    {loading&&!market&&<div className="rd-empty">가격 스냅샷을 확인하고 있습니다…</div>}{error&&<div className="rd-empty" role="alert">{error}<button className="rd-button" onClick={()=>void refresh()}>다시 시도</button></div>}
    {!loading&&market&&!rows.length&&<div className="rd-empty">조건에 맞는 가격·시총 자료가 없습니다.{size==='cap'&&' 동일 비중으로 시총 미확인 종목도 확인할 수 있습니다.'}</div>}
    {!!rows.length&&(display==='map'||compact?<div className="usmap-scroll" tabIndex={0} aria-label="히트맵 가로 스크롤 영역"><div className={`usmap-stage${compact?' compact':''}`}>{blocks.map(({item:g,rect})=>{const base={x:0,y:0,w:Math.max(rect.w/rect.h,.1),h:1},parts=pack(g.stocks,weight,base),ret=groupPerformance(g.stocks,period,size).value;return <div key={g.key} className="usmap-group" style={pos(rect,root)}><button className="usmap-group-label" onClick={()=>setFocus(focus===g.key?'':g.key)} title={`${g.key} 확대`}><span>{g.key}</span><span className={tone(ret)}>{fmtPct(ret,1)}</span></button><div className="usmap-tiles">{parts.map(({item:s,rect:r})=><button key={s.symbol} className="usmap-tile" style={{...pos(r,base),background:tileColor(s[period],period)}} onClick={()=>setSelected(s)} title={`${s.symbol} · ${s.name}\n${fmtPct(s[period])} · 시총 ${fmtUsd(s.mcap)}`} aria-label={`${s.symbol} ${fmtPct(s[period])} 기업 요약 열기`}><strong>{s.symbol}</strong><span>{fmtPct(s[period])}</span></button>)}</div></div>;})}</div></div>:<div className="usmap-list" aria-label="히트맵 종목 목록">{displayed.map(s=><button key={s.symbol} className="usmap-list-row" onClick={()=>setSelected(s)}><div><strong>{s.symbol}</strong><small>{s.name}</small></div><div><b>${fmtPrice(s.price)}</b><small>{fmtUsd(s.mcap)}</small></div><span className={tone(s[period])}>{fmtPct(s[period])}</span><ArrowUpRight size={14}/></button>)}</div>)}
    <div className="usmap-legend"><span><i className="usmap-dot fall"/>하락</span><div className="usmap-gradient"/><span>상승<i className="usmap-dot rise"/></span><span className="usmap-summary">{rows.length}개 표시 · {stats.measured}개 등락률 확인 · {groups.length}개 {theme?'세부 사업':view==='sector'?'업종':'테마'}</span></div>
    <details className="usmap-method"><summary>데이터 범위와 분류 기준 <X size={12}/></summary><p>{market?.source} · 가격 확인 {market?.coverage.priced??0} / 유니버스 {market?.universe??0}개. 시총 모드는 보고 주식 수 등에 따른 추정 시총을 사용하며 누락 종목은 제외합니다. 조건 필터 후 시총 상위 최대 {compact?64:240}개를 그립니다.</p><p>테마는 편집한 사업 연결이며 중복 편입 가능합니다. 전체 테마 지도에서는 첫 분류에 한 번만 배치하고, 개별 테마에서는 해당 기업을 모두 조회합니다. 업종·테마 등락률은 표시 종목의 가중 평균으로 산업지수 수익률과 다릅니다. {market?.classification.method} · 검토 {market?.classification.reviewedAt}</p></details>
    {selected&&<StockBrief key={selected.symbol} stock={selected} row={setupBy.get(selected.symbol)} asOf={market?.asOf??''} onClose={()=>setSelected(null)}/>}
  </section>;
}
