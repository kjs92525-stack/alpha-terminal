import { ArrowDownRight, ArrowUpRight, ShieldAlert, Star } from 'lucide-react';
import { useAnalysis, useTerminal } from '../lib/store';
import { fmtPrice, RISK_LABEL } from '../lib/format';
import { ErrorBox, FactorBars, Loading, PanelHead, ScoreRing, SourceBadge } from './ui';

export function ResearchDesk({ symbol }: { symbol: string }) {
  const { data, error, loading } = useAnalysis(symbol);
  const { watchlist, toggleWatch, setPage } = useTerminal();
  const s = data?.score;
  return (
    <section className="panel research-panel">
      <PanelHead kicker="03 / RESEARCH" title="Research Desk" />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading label="분석 계산" />}
      {s && data && (
        <div className="research-content">
          <div className="score-header">
            <div><span className="section-overline">COMPOSITE · {data.symbol}</span><strong>{s.rating}</strong><small>규칙 기반 점수 · 확률 아님 · 데이터 커버리지 {s.coverage}%</small></div>
            <ScoreRing score={s.score} />
          </div>
          <FactorBars factors={s.factors} />
          <div className="risk-bar"><ShieldAlert size={13} /> <span>RISK EXPOSURE</span><strong className={s.riskLevel === 'HIGH' ? 'down' : s.riskLevel === 'MODERATE' ? 'neutral' : 'up'}>{RISK_LABEL[s.riskLevel]}</strong></div>
          {s.scenarios && (
            <>
              <div className="thesis-card bull"><div><ArrowUpRight size={12} /> BULL · ${fmtPrice(s.scenarios.bull.range[1])}</div><p>{s.scenarios.bull.trigger}</p></div>
              <div className="thesis-card bear"><div><ArrowDownRight size={12} /> BEAR · ${fmtPrice(s.scenarios.bear.range[0])}</div><p>{s.scenarios.bear.trigger}</p></div>
            </>
          )}
          <div className="research-summary">
            <span className="section-overline">KEY EVIDENCE</span>
            <ul className="evidence compact">{s.evidence.slice(0, 5).map((e, i) => <li key={i} className={e.sign === '+' ? 'up' : 'down'}><span>{e.sign}</span>{e.text}</li>)}</ul>
            <SourceBadge name={data.sources.prices.name} fetchedAt={data.sources.prices.fetchedAt} />
          </div>
          <div className="research-actions">
            <button className="secondary-button" onClick={() => toggleWatch(symbol)}><Star size={12} /> {watchlist.includes(symbol) ? '관심 해제' : '관심등록'}</button>
            <button className="primary-button" onClick={() => setPage('research')}>상세 분석 ↗</button>
          </div>
        </div>
      )}
    </section>
  );
}
