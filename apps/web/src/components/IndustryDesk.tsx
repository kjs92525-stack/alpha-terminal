import { useEffect, useState } from 'react';
import { ArrowUpRight, Cpu, Factory, HeartPulse, Landmark, Orbit, ShoppingBag, Workflow, Zap } from 'lucide-react';
import { MARKET_THEMES } from '../../../../packages/analysis/market-map.mjs';
import { fetchSectors, type Sectors } from '../lib/snapshot';
import { useTerminal } from '../lib/store';
import { fmtPct } from '../lib/format';
import { NextCycle } from './NextCycle';

const ICONS = [Workflow,Cpu,Zap,Factory,Orbit,HeartPulse,ShoppingBag,Landmark];
const PHASE: Record<string,string> = { EARLY:'가격 회복 관찰', BASING:'가격 안정 관찰', LEADING:'가격 추세 우위', LATE:'가격 과열 관찰', NEUTRAL:'방향 확인 중', DOWN:'가격 약세' };
export function IndustryDesk({compact=false}:{compact?:boolean}) {
  const [data,setData]=useState<Sectors|null>(null),[error,setError]=useState('');
  const {setMapTheme,setPage}=useTerminal();
  useEffect(()=>{fetchSectors().then(setData).catch(()=>setError('ETF 가격 자료를 불러오지 못했습니다.'));},[]);
  const open=(id:string)=>{setMapTheme(id);setPage('market-map');};
  return <section className="industry-desk" aria-label="산업과 사업 테마">
    <div className="rd-section-heading"><div><span className="section-label">INDUSTRY LENS</span><h2>{compact?'어디에서 변화가 생기고 있나':'산업의 이야기와 숫자를 함께'}</h2><p>{compact?'수요의 변화 → 기업의 매출 → 이익과 현금. 연결 고리를 확인하세요.':'가격 회복과 사업 회복을 구분합니다. ETF 국면은 가격 참고 지표이며 기업 실적의 확인은 별도입니다.'}</p></div>{compact?<button className="rd-text-link" onClick={()=>setPage('industries')}>산업 리서치 전체 <ArrowUpRight size={15}/></button>:<span className="rd-source-pill">ETF 기준 {data?.asOf??'확인 중'}</span>}</div>
    {error&&<p className="rd-notice" role="alert">{error}</p>}
    <div className={`industry-grid${compact?' compact':''}`}>
      {MARKET_THEMES.slice(0,compact?4:undefined).map((t,i)=>{
        const etf=data?.groups.find(g=>g.etf===t.etf),Icon=ICONS[i];
        return <article className={`industry-card theme-${t.id}`} key={t.id}>
          <div className="industry-card-top"><span className="industry-icon"><Icon size={19}/></span><span className={`industry-phase ${etf?.phase==='DOWN'?'weak':''}`}>{etf?PHASE[etf.phase]:'가격 확인 대기'}</span></div>
          <h3>{t.name}</h3><p>{t.mechanism}</p>
          <div className="industry-proxy"><div><small>{t.etf} · 3개월</small><b className={(etf?.metrics.ret3m??0)>=0?'rd-rise':'rd-fall'}>{fmtPct(etf?.metrics.ret3m??null)}</b></div><div><small>SPY 대비 · 3개월</small><b>{fmtPct(etf?.metrics.rs3m??null)}</b></div></div>
          <small className="industry-proxy-note">{t.proxy}</small>
          {!compact&&<div className="industry-checks"><div><b>확인할 지표</b><p>{t.confirm}</p></div><div><b>반대 시나리오</b><p>{t.risk}</p></div><div className="rd-tags">{t.groups.map(([g])=><span key={g}>{g}</span>)}</div></div>}
          <button className="industry-open" onClick={()=>open(t.id)}>{compact?'관련 기업 살펴보기':'세부 사업별 시장맵 열기'}<ArrowUpRight size={16}/></button>
        </article>;
      })}
    </div>
    {!compact&&<><div className="rd-section-heading"><div><span className="section-label">FUNDAMENTAL CROSS-CHECK</span><h2>사업이 먼저 돌아서는 업종이 있나</h2><p>아래 후보는 보고된 매출 가속 기업 비중과 업종 가격을 함께 확인합니다. 테마 카드의 가격 국면과 다른 기준입니다.</p></div></div><NextCycle/><p className="rd-footnote">사업 연결 분류는 비포괄적 편집 분류입니다. 편입 기업이 해당 사업에서 매출을 얼마나 얻는지, 현재 투자 매력이 있는지는 개별 공시에서 확인해야 합니다.</p></>}
  </section>;
}
