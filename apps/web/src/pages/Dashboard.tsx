import { Activity, Gauge, Radar, Sparkles } from 'lucide-react';
import { useTerminal, useAnalysis } from '../lib/store';
import { ScannerPanel } from '../components/Scanner';
import { ResearchDesk } from '../components/ResearchDesk';
import { ChartWorkspace } from '../components/ChartWorkspace';
import { CATEGORY_LABEL, fmtEt } from '../lib/format';
import { PanelHead } from '../components/ui';
import { NewsFeed } from '../components/NewsFeed';
import { TopMovers } from '../components/TopMovers';

const RANK = { critical: 4, high: 3, medium: 2, low: 1 } as const;

export function Dashboard() {
  const { rows, universe, selected, mode, screening, setPage, health } = useTerminal();
  const { data } = useAnalysis(selected);
  const scored = rows.filter((r) => r.score !== null);
  const avg = scored.length ? Math.round(scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length) : null;
  const top = scored[0];
  const events = (data?.filings ?? []).filter((f) => f.category !== 'INSIDER' && f.category !== 'EXHIBIT')
    .sort((a, b) => RANK[b.importance] - RANK[a.importance] || String(b.acceptedAt).localeCompare(String(a.acceptedAt))).slice(0, 4);
  return (
    <>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-top">ANALYSIS UNIVERSE <Activity size={13} className="kpi-icon" /></div><div className="kpi-value"><strong>{String(universe.length).padStart(2, '0')}</strong><span>{mode === 'live' ? '실제 상장 종목' : '가상 종목'}</span></div><div className="kpi-foot">● {screening.running ? `스크리닝 ${screening.done}/${screening.total}` : screening.at ? `계산 ${fmtEt(screening.at)}` : '대기'}</div></div>
        <div className="kpi-card"><div className="kpi-top">TOP CANDIDATE <Sparkles size={13} className="kpi-icon" /></div><div className="kpi-value"><strong>{top?.symbol ?? '—'}</strong><span>{top ? `${top.score}/100 · ${top.rating}` : ''}</span></div><div className="kpi-foot">● 평균 점수 {avg ?? '—'} · 규칙 기반</div></div>
        <div className="kpi-card"><div className="kpi-top">EVENT SIGNALS <Radar size={13} className="kpi-icon" /></div><div className="kpi-value"><strong>{String(data?.filings.length ?? 0).padStart(2, '0')}</strong><span>{selected} 최근 공시</span></div><div className="kpi-foot">● {mode === 'live' ? 'SEC EDGAR 공식' : '가상 이벤트'}</div></div>
        <div className="kpi-card"><div className="kpi-top">SYSTEM STATUS <Gauge size={13} className="kpi-icon" /></div><div className="kpi-value"><strong>{mode === 'live' ? 'LIVE' : 'SIM'}</strong><span>{mode === 'live' ? (health?.secConfigured ? 'SEC 연결' : 'SEC 미설정') : 'API 미연결'}</span></div><div className="kpi-foot">● 시세: {health?.priceProviders.join(' → ') ?? '합성 OHLCV'}</div></div>
      </div>
      <div className="feed-row">
        <NewsFeed />
        <TopMovers />
      </div>
      <div className="workbench">
        <ScannerPanel />
        <section className="panel center-panel">
          <PanelHead kicker="02 / TECHNICAL INTELLIGENCE" title="Advanced Chart" right={<button className="text-link" onClick={() => setPage('charts')}>CHART LAB ↗</button>} />
          <ChartWorkspace symbol={selected} />
        </section>
        <ResearchDesk symbol={selected} />
      </div>
      <section className="panel events-section">
        <PanelHead kicker="04 / EVENT INTELLIGENCE" title={`Event Radar · ${selected}`} right={<button className="text-link" onClick={() => setPage('events')}>ALL EVENTS ↗</button>} />
        <div className="event-cards">
          {events.map((f) => (
            <a key={f.accession} className="event-card" href={f.url || undefined} target="_blank" rel="noreferrer">
              <div className="event-card-top"><span className="event-type">{CATEGORY_LABEL[f.category] ?? f.category}</span><span className="event-time">{fmtEt(f.acceptedAt ?? f.filingDate)}</span></div>
              <strong>{f.form} · {f.label}</strong>
              <p>{f.items ? `8-K Items ${f.items}` : f.description || '원문 확인 필요'}</p>
              <div className="event-card-bottom"><span>{selected}</span><span className={`severity ${f.importance}`}>{f.importance.toUpperCase()}</span></div>
            </a>
          ))}
          {!events.length && <div className="empty">표시할 공시가 없습니다.</div>}
        </div>
      </section>
    </>
  );
}
