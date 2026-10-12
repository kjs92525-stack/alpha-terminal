import { useState } from 'react';
import { Sidebar, Topbar, PAGES } from './components/Layout';
import { TerminalProvider, useTerminal } from './lib/store';
import { Loading } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Discover } from './pages/Discover';
import { ChartLab } from './pages/ChartLab';
import { EventRadar } from './pages/EventRadar';
import { Research } from './pages/Research';
import { Settings } from './pages/Settings';
import { Alerts } from './pages/Alerts';

const TITLES: Record<string, [string, string]> = {
  dashboard: ['Market Intelligence', 'Discover signals. Validate evidence. Manage risk.'],
  discover: ['AI 종목발굴', '모멘텀·추세·재무·밸류·유동성·위험 6개 팩터 기반 랭킹'],
  charts: ['차트 연구실', '지표·시장구조·ICT 신호와 확정 여부'],
  events: ['이벤트 레이더', 'SEC 공시·FDA·희석·런웨이 — 공식 출처와 접수 시각'],
  research: ['기업 정밀분석', '점수 근거, 시나리오, 재무, 공시'],
  alerts: ['TradingView 연동', '알림 웹훅 + 공시·위험 맥락 + Pine Script'],
  settings: ['데이터 연결', '데이터 출처, 연결 상태, 계정'],
};

function Shell() {
  const { ready, page } = useTerminal();
  const [menu, setMenu] = useState(false);
  const [title, sub] = TITLES[page];
  const code = PAGES.find((p) => p.id === page)?.code;
  return (
    <div className="app-shell">
      <Sidebar open={menu} onClose={() => setMenu(false)} />
      <div className="app-main">
        <Topbar onMenu={() => setMenu(true)} />
        <main className="content">
          <div className="page-intro">
            <div>
              <div className="eyebrow">ALPHA / {code} <span className="eyebrow-line" /></div>
              <h1>{title}<span className="title-spark">✳</span></h1>
              <p>{sub}</p>
            </div>
          </div>
          {!ready ? <Loading label="API 연결 확인" /> : (
            <>
              {page === 'dashboard' && <Dashboard />}
              {page === 'discover' && <Discover />}
              {page === 'charts' && <ChartLab />}
              {page === 'events' && <EventRadar />}
              {page === 'research' && <Research />}
              {page === 'alerts' && <Alerts />}
              {page === 'settings' && <Settings />}
            </>
          )}
          <footer className="footer"><span>ALPHA TERMINAL V0.4 · NOT FINANCIAL ADVICE</span><span>점수는 규칙 기반 상대평가이며 확률·수익을 보장하지 않습니다</span></footer>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return <TerminalProvider><Shell /></TerminalProvider>;
}
