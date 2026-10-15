import { useEffect, useRef, useState } from 'react';
import { createChart, LineSeries, type UTCTimestamp } from 'lightweight-charts';
import type { NasdaqContext } from '../../../../packages/analysis/market-context.mjs';
export function NasdaqChart({data}:{data:NasdaqContext}){
 const el=useRef<HTMLDivElement>(null),[sessions,setSessions]=useState(126);
 useEffect(()=>{if(!el.current||!data.series.length)return;const chart=createChart(el.current,{autoSize:true,layout:{background:{color:'#0b0d22'},textColor:'#aeb5d7'},grid:{vertLines:{color:'#1a1d40'},horzLines:{color:'#1a1d40'}},timeScale:{borderColor:'#23264d'},rightPriceScale:{borderColor:'#23264d'},localization:{locale:'ko-KR'}});
 for(const[key,color,title]of [['close','#f3f4ff','종가'],['ma20','#e5b970','20일'],['ma50','#7aa2f7','50일'],['ma200','#c58af9','200일']] as const){const line=chart.addSeries(LineSeries,{color,lineWidth:key==='close'?2:1,title,priceLineVisible:false,lastValueVisible:key==='close'});line.setData(data.series.flatMap(p=>p[key]===null?[]:[{time:p.time as UTCTimestamp,value:p[key] as number}]));}
 const n=data.series.length;chart.timeScale().setVisibleLogicalRange({from:Math.max(0,n-sessions),to:n+2});return()=>chart.remove();},[data,sessions]);
 return <><div className="market-chart-controls"><label>표시 기간 <select value={sessions} onChange={e=>setSessions(Number(e.target.value))}><option value={63}>약 3개월</option><option value={126}>약 6개월</option><option value={252}>약 1년</option></select></label><span>종가 · <b style={{color:'#e5b970'}}>20일</b> · <b style={{color:'#7aa2f7'}}>50일</b> · <b style={{color:'#c58af9'}}>200일</b></span></div><div ref={el} className="market-nasdaq-chart" role="img" aria-label={`${data.title} 종가와 20·50·200일 이동평균. ${data.asOf} 종가 ${data.metrics.close.toLocaleString()} ${data.unit}`}/><p className="market-note">확대·이동 가능 · 마우스/터치로 날짜·가격 확인 · <a href={data.url} target="_blank" rel="noreferrer">{data.source} ↗</a></p></>;
}
