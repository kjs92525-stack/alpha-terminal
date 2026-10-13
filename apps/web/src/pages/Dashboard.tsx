import { useEffect, useState } from 'react';
import { Activity, Gauge, Radar, Sparkles } from 'lucide-react';
import { fetchLatest, fetchSetups, type Latest, type Setups } from '../lib/snapshot';
import { storyPicks, TYPE_KO } from '../lib/storyPicks';
import { StoryPicks } from '../components/StoryPicks';
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
  const { selected, mode, setPage, health } = useTerminal();
  const { data } = useAnalysis(selected);
  const [setups, setSetups] = useState<Setups | null>(null);
  const [latest, setLatest] = useState<Latest | null>(null);
  useEffect(() => { fetchSetups().then(setSetups).catch(() => {}); fetchLatest().then(setLatest).catch(() => {}); }, []);
  const top = storyPicks(setups, 1)[0];
  const byType = setups?.stats.byType;
  const buyCount = (t: keyof NonNullable<typeof byType>, stages: string[]) => stages.reduce((s, k) => s + (byType?.[t]?.[k] ?? 0), 0);
  const fundSrc = latest?.sources.fundamentals ? (/Finnhub/.test(latest.sources.fundamentals) ? 'Finnhub' : 'SEC') : '—';
  const events = (data?.filings ?? []).filter((f) => f.category !== 'INSIDER' && f.category !== 'EXHIBIT')
    .sort((a, b) => RANK[b.importance] - RANK[a.importance] || String(b.acceptedAt).localeCompare(String(a.acceptedAt))).slice(0, 4);
  return (
    <>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-top">NIGHTLY SCAN <Activity size={13} className="kpi-icon" /></div><div className="kpi-value"><strong>{setups ? setups.stats.scanned.toLocaleString() : '—'}</strong><span>종목 검사</span></div><div className="kpi-foot">● {setups ? `기준일 ${setups.asOf} · 장 마감 후 자동` : '야간 수집 전'}</div></div>
        <div className="kpi-card"><div className="kpi-top">STORY PICK <Sparkles size={13} className="kpi-icon" /></div><div className="kpi-value"><strong>{top?.row.symbol ?? '—'}</strong><span>{top ? top.hook : ''}</span></div><div className="kpi-foot">● {top ? top.why.slice(0, 2).join(' · ') : '스토리 신호 종목 없음'}</div></div>
        <div className="kpi-card"><div className="kpi-top">BUY SETUPS <Radar size={13} className="kpi-icon" /></div><div className="kpi-value"><strong>{byType ? String(buyCount('breakout', ['BREAKOUT', 'POST_BREAKOUT', 'NEAR_PIVOT']) + buyCount('pullback', ['BOUNCE', 'AT_SUPPORT']) + buyCount('weekly_bottom', ['TURNING']) + buyCount('monthly_bottom', ['TURNING'])) : '—'}</strong><span>매수 자리</span></div><div className="kpi-foot">● {byType ? `${TYPE_KO.breakout} ${buyCount('breakout', ['BREAKOUT', 'POST_BREAKOUT', 'NEAR_PIVOT'])} · ${TYPE_KO.pullback} ${buyCount('pullback', ['BOUNCE', 'AT_SUPPORT'])} · 바닥 전환 ${buyCount('weekly_bottom', ['TURNING']) + buyCount('monthly_bottom', ['TURNING'])}` : '—'}</div></div>
        <div className="kpi-card"><div className="kpi-top">DATA <Gauge size={13} className="kpi-icon" /></div><div className="kpi-value"><strong>{mode === 'live' ? 'LIVE' : 'SIM'}</strong><span>재무 {fundSrc}</span></div><div className="kpi-foot">● 시세: {health?.priceProviders.join(' → ') ?? '합성 OHLCV'}</div></div>
      </div>
      <StoryPicks limit={6} />
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
