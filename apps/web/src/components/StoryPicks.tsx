import { useEffect, useState } from 'react';
import { Copy, Check, LineChart } from 'lucide-react';
import { useTerminal } from '../lib/store';
import { fetchSetups, NoSnapshotError, SECTOR_KO, type Setups } from '../lib/snapshot';
import { buildStoryPrompt, storyPicks, earlyIssues, type DiscoveryMode } from '../lib/storyPicks';
import { fmtPrice, fmtPct } from '../lib/format';
import { Loading, PanelHead } from './ui';
import { BusinessStory } from './BusinessStory';
import { businessStory } from '../../../../packages/analysis/business-stories.mjs';
import { thesisChecks } from '../../../../packages/analysis/thesis-checks.mjs';
const MET=(m:boolean|null,good:boolean)=>m===null?'미확인':m===good?'충족':'미충족';
const THESIS_KO={review:'검토로 올릴 조건 충족',watch:'관찰 유지',drop:'탈락 조건 해당'} as const;
export function StoryPicks({ limit = 8 }: { limit?: number }) {
 const { select, setPage } = useTerminal();const [data,setData]=useState<Setups|null>(null),[state,setState]=useState('loading'),[copied,setCopied]=useState<string|null>(null),[mode,setMode]=useState<DiscoveryMode>('early');
 useEffect(()=>{fetchSetups().then(d=>{setData(d);setState('ok')}).catch(e=>setState(e instanceof NoSnapshotError?'missing':'error'))},[]);
 const picks=storyPicks(data,limit,mode);
 const copy=async(sym:string)=>{const p=picks.find(p=>p.row.symbol===sym);if(!p||!data)return;const text=buildStoryPrompt(p.row,data.asOf);try{await navigator.clipboard.writeText(text)}catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove()}setCopied(sym);setTimeout(()=>setCopied(null),2500)};
 return <section className="panel story-picks">
  <PanelHead kicker="EARLY TURN · BUSINESS + PRICE" title="상승 초입 검토 · 사업 변화와 바닥 전환" right={data&&<span className="live-badge">기준일 {data.asOf}</span>}/>
  <p className="pad-box muted small">사업 개선의 보고 신호와 바닥 전환을 함께 찾습니다. 기본 목록은 상승 후 눌림목·테마 기사만 있는 종목·전환 없는 바닥권을 제외합니다. <b>확인된 미래 상승이나 매수 검증 완료를 뜻하지 않습니다.</b></p>
  <div className="event-filter">{([['early','상승 초입'],['watch','바닥 관찰'],['legacy','기존 셋업 참고']] as const).map(([key,label])=><button key={key} className={mode===key?'active':''} aria-pressed={mode===key} onClick={()=>setMode(key)}>{label}</button>)}</div>
  <div className="pad-box muted small">{mode==='early'?'당일 종가 · 하루 +12%·5일 +20% 급등 제외 · 시총 $25M~$5B · 63거래일 +35%·21거래일 +20% 초과 제외 · 보고기간 200일 이내 실적 개선 · 돌파/전환 조건 동반. 진행 중인 주봉·월봉은 확정 신호에서 제외합니다.':mode==='watch'?'실적 개선 신호는 있지만 바닥 다지기·전환을 더 확인해야 하는 연구 목록입니다. 바닥이라는 이유로 분할매수하지 않습니다.':'이전 추천 방식의 참고 목록입니다. 상승 후 눌림목·테마·기사 관심도도 포함하며 상승 초입 검증을 통과한 목록이 아닙니다.'}</div>
  {state==='loading'&&<Loading label="발굴 결과 확인"/>}{['missing','error'].includes(state)&&<p className="pad-box muted">발굴 자료를 확보하지 못했습니다. 이전 목록을 최신으로 표시하지 않습니다.</p>}
  {data&&mode!=='legacy'&&<details className="pad-box small"><summary>필터가 걸러낸 이유 · 중복 셋업 포함</summary><p>각 항목은 중복 집계하며 종목 수와 다를 수 있습니다. 기준을 통과하지 못한 종목을 빈자리 채우기로 올리지 않습니다.</p>{Object.entries(data.candidates.reduce<Record<string,number>>((m,r)=>{for(const reason of earlyIssues(r,data.asOf,mode))m[reason]=(m[reason]??0)+1;return m},{})).map(([reason,n])=><p key={reason}>{reason}: {n}개 셋업</p>)}</details>}
  {state==='ok'&&!picks.length&&<p className="pad-box muted">조건을 함께 통과한 후보가 없습니다. 사업 개선·추격 여부·바닥 전환 중 빠진 근거를 확인할 때까지 목록을 비워둡니다.</p>}
  <div className="pick-grid">{picks.map(({row,why,hook})=>{const b=businessStory(row.symbol,data!.asOf),q=row.narrative?.quality;return <details className="pick-card discovery-card" key={`${mode}:${row.symbol}`}>
   <summary><div className="pick-top"><b>{row.symbol}</b><span className="muted small">{row.name} · {SECTOR_KO[row.sector]??row.sector}</span></div><div className="pick-hook">{hook} · ${fmtPrice(row.price)}</div><p className="pick-take">{b?.business??'사업 원문 설명 미등록 · 재무 신호만으로 회사의 경쟁력이나 촉매를 추정하지 않습니다.'}</p><div className="pick-why">{why.map(w=><span className="chip" key={w}>{w}</span>)}</div><p className="small muted">21일 {fmtPct(row.ret21)} · 63일 {fmtPct(row.ret63)} · 보고 실적·공시 원문 검증 대기</p><span className="text-link">사업 스토리·전환 근거·실패 조건 펼치기</span></summary>
   <div className="discovery-reading">
    {b?<BusinessStory asOf={data!.asOf} row={{ticker:row.symbol,reportPeriod:q?.revenuePeriod??q?.profitPeriod,reasons:row.reasons.filter(r=>!(r.kind==='plus'&&((q?.profitBlocked&&/흑자|순이익|적자/.test(r.text))||(q?.growthBlocked&&/매출/.test(r.text))))).map(r=>({factor:/매출/.test(r.text)?'growth':'profitability',points:r.kind==='plus'?r.pts:-Math.abs(r.pts),text:r.text}))}}/>:<p>확인된 사업 설명이 아직 없습니다. 고객·제품·대금 지급 구조를 원문으로 확인하기 전에는 테마 이름으로 빈칸을 채우지 않습니다.</p>}
    <h3>차트가 알려주는 것과 아직 확인할 것</h3><p>{hook}. {row.base?`${row.base.months}개월 범위 $${fmtPrice(row.base.low)}~$${fmtPrice(row.base.high)}. 저점 상승 ${row.base.higherLows?'관찰':'미확인'}, 변동폭 수축 ${row.base.contraction?'관찰':'미확인'}, 거래량 감소 ${row.base.volumeDryUp?'관찰':'미확인'}.`:row.low!=null?`저점 $${fmtPrice(row.low)} 대비 ${fmtPct(row.aboveLow)}. 저점 상승 ${row.higherLow?'관찰':'미확인'}, 평균선 회복 ${row.aboveMa?'관찰':'미확인'}.`:'바닥 구조의 세부 근거는 아래 차트에서 확인합니다.'}</p>{row.provisional&&<p className="ea-risk">진행 중인 주봉·월봉의 잠정 신호입니다. 봉 마감 전에 바뀔 수 있어 확정 전환으로 분류하지 않습니다.</p>}{row.htfBasis==='closed_confirmed'&&<p className="market-note">직전에 마감된 {row.type==='monthly_bottom'?'월봉':'주봉'} 기준으로 판정했고, 진행 중인 봉이 그 판정을 깨지 않았습니다.{row.htfNote?` ${row.htfNote}.`:''}</p>}
    <p>바닥 가격에서 싸 보이는 것과 하락 추세가 끝난 것은 다릅니다. 반등 고점 돌파·저점 유지·실제 거래량 동반을 함께 보고, 오더블록을 기관의 실제 주문이나 반드시 지켜질 지지로 해석하지 않습니다.</p>
    <h3>보고 실적은 무엇이 바뀌었나</h3>{row.narrative?.lines.map((l,i)=><p key={i}>{l}</p>)}<p className="market-note">보고 수치의 자동 신호입니다. 인수·계절성·손상차손 기저·자산 매각과 반복 본업의 개선을 구분해야 합니다. 목표가는 차트 가정이며 기업 적정가가 아닙니다.</p>
    {(()=>{const t=thesisChecks(row,data!.asOf);return <><h3>관찰 → 검토 · 탈락 조건 (매일 자동 확인)</h3><p><b className={t.state==='drop'?'down':t.state==='review'?'up':''}>{THESIS_KO[t.state]}</b>{t.unknown?` · 미확인 ${t.unknown}개 — 미확인은 충족으로 세지 않습니다`:''}{t.nextDue?` · 다음 분기 실적 예상 시점 ${t.nextDue} 무렵`:''}</p>
     <h4>모두 충족해야 검토로 올림</h4><ul className="thesis-list">{t.promote.map(c=><li key={c.label}><b>{MET(c.met,true)}</b> {c.label} — <span className="muted">{c.observed}</span></li>)}</ul>
     <h4>하나라도 해당하면 탈락</h4><ul className="thesis-list">{t.drop.map(c=><li key={c.label}><b>{c.met===null?'미확인':c.met?'해당':'아님'}</b> {c.label} — <span className="muted">{c.observed}</span></li>)}</ul>
     <p className="market-note">보고 수치와 가격만으로 자동 판정합니다. 공시 원문의 일회성 요인·계약 조건은 반영하지 못하며, 충족이 매수 신호라는 뜻은 아닙니다.</p></>})()}
    <h3>진입 가설이 깨지는 조건</h3><p>{row.plan?`차트 무효화 기준 $${fmtPrice(row.plan.stop)} (${row.plan.stopKind}). 주가가 기준 아래로 내려가거나 돌파 뒤 범위 안으로 복귀하면 기존 가설을 다시 검토합니다. 손절 체결가는 갭·유동성에 따라 달라질 수 있습니다.`:'진입·무효화 기준이 없어 매수 계획을 제시하지 않습니다.'}</p><p>{row.funding?`보고 현금 런웨이 ${row.funding.runwayMonths==null?'미확인':row.funding.runwayMonths.toFixed(1)+'개월'} · 주식 수 YoY ${fmtPct(row.funding.sharesYoY)}. ${row.funding.source}.`:'현금·주식 수·증자 위험 자료 미확인.'} 최신 공시의 ATM·워런트·전환사채·차입 만기를 확인하기 전에는 희석 위험이 낮다고 판단하지 않습니다.</p>
    <div className="pick-actions"><button className="secondary-button" onClick={()=>{select(row.symbol);setPage('charts')}}><LineChart size={12}/>차트 확인</button><button className="secondary-button" onClick={()=>void copy(row.symbol)}>{copied===row.symbol?<Check size={12}/>:<Copy size={12}/>}심층 검증 프롬프트</button></div>
    <button className="ea-button" onClick={e=>{const d=e.currentTarget.closest('details.discovery-card');if(d instanceof HTMLDetailsElement){d.open=false;d.querySelector('summary')?.focus();d.scrollIntoView({block:'start',behavior:'auto'})}}}>다 읽었어요 · 카드 접기</button>
   </div>
  </details>})}</div>
 </section>;
}
