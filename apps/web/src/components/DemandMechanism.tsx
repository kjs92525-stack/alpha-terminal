import { demandStory } from '../../../../packages/analysis/demand-stories.mjs';
export function DemandMechanism({ticker,asOf}:{ticker:string;asOf:string}) {
 const s=demandStory(ticker,asOf);if(!s)return null;
 return <section className="demand-mechanism" aria-label={`${ticker} 제품 수요의 이유`}>
  <h4>{s.title}</h4><p>{s.demand}</p><p>{s.product}</p><p><b>왜 이 회사인가</b> {s.edge}</p><p><b>어떻게 이익이 되나 · 조건부 해석</b> {s.earnings}</p>
  {s.sources.map(r=><a className="ea-story-source" key={r.url} href={r.url} target="_blank" rel="noreferrer">{r.label} · {r.date} ↗</a>)}
 </section>;
}
