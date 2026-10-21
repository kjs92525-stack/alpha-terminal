import { briefingFreshness } from '../../../../packages/analysis/market-brief.mjs';
import { useMarketBrief } from '../lib/marketBrief';
import { useTerminal } from '../lib/store';
export function MarketGate(){
 const{data,error,loading,now}=useMarketBrief(),{setPage}=useTerminal();const fresh=briefingFreshness(data,now);
 const state=error||!fresh.fresh?'UNKNOWN':data!.decision.state;
 return <section className={`market-gate state-${state.toLowerCase()}`} aria-label="시장 신규 진입 환경"><div><small>신규 미국 소형주 진입 환경 · {data?.metrics.SPY?.asOf??'자료 확인 중'} 종가</small><strong>{state==='UNKNOWN'?'시황 자료 부족 — 판정 보류(시장이 나쁘다는 뜻은 아님)':data!.decision.label}</strong><p>{error||fresh.reason||data?.decision.reasons[0]||'판정 근거를 확인하고 있습니다.'}{loading&&' · 갱신 확인 중'}</p></div><button className="ea-button" onClick={()=>setPage('market-brief')}>오늘 시황 읽기 ↗</button></section>;
}
