import { companyMacro } from '../../../../packages/analysis/sector-stories.mjs';
export function MacroStory({ticker,asOf}:{ticker:string;asOf:string}){
 const m=companyMacro(ticker,asOf);if(!m)return null;
 return <div className="macro-story"><h3>세계정세·섹터 흐름과 이 회사</h3><small>{m.sector.name} · 원문과 조건부 해석</small><p>{m.sector.world}</p><h4>기업 이익으로 이어지는 경로</h4><p>{m.sector.chain}</p><p>{m.link.link}</p><h4>연결이 끊어질 위험</h4><p>{m.link.risk}</p><p>다음 확인: {m.link.next}</p>{m.sector.sources.filter(s=>s.date<=asOf).map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label} · {s.date} ↗</a>)}</div>;
}
