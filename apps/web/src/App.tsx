import { lazy, Suspense, useState } from 'react';
import { Sidebar, Topbar, BottomNav, PAGES } from './components/Layout';
import { TerminalProvider, useTerminal } from './lib/store';
import { Loading } from './components/ui';
import { ResearchHome } from './pages/ResearchHome';
import { MarketMap } from './components/MarketMap';
import { IndustryDesk } from './components/IndustryDesk';
import { Watchlist } from './pages/Watchlist';
import { MarketGate } from './components/MarketGate';

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Discover = lazy(() => import('./pages/Discover').then(m => ({ default: m.Discover })));
const ChartLab = lazy(() => import('./pages/ChartLab').then(m => ({ default: m.ChartLab })));
const EventRadar = lazy(() => import('./pages/EventRadar').then(m => ({ default: m.EventRadar })));
const Research = lazy(() => import('./pages/Research').then(m => ({ default: m.Research })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Alerts = lazy(() => import('./pages/Alerts').then(m => ({ default: m.Alerts })));
const EarlyAlpha = lazy(() => import('./pages/EarlyAlpha').then(m => ({ default: m.EarlyAlpha })));
const Performance = lazy(() => import('./pages/Performance').then(m => ({ default: m.Performance })));
const MarketBrief = lazy(() => import('./pages/MarketBrief').then(m => ({ default: m.MarketBrief })));

const TITLES: Record<string, [string, string]> = {
  'market-brief':['매일 시황 브리핑','시장부터 확인하는 신규 진입 환경 · 근거·재개 조건·데이터 최신성'],
  dashboard: ['오늘의 리서치', '시장과 산업, 기업의 변화를 잇는 미국 주식 리서치'],
  industries: ['산업·테마 리서치', '수요의 변화가 매출·이익·현금으로 이어지는 경로를 검토합니다'],
  'market-map': ['미국 주식 시장맵', '가격 유니버스의 업종·사업별 탐색 · 종가와 데이터 범위 확인'],
  watchlist: ['나의 관심종목', '가격·실적 변화와 위험을 함께 추적하는 리서치 목록'],
  workbench: ['고급 분석 워크벤치', '기존 통합 스캐너·차트·공시와 분석 도구'],
  'early-alpha': ['EARLY ALPHA', '소외된 미국 소형주의 사업 변곡점 · 근거와 희석 위험 · 최초 발굴 성과'],
  discover: ['조건 기반 종목발굴', '사업 변화와 가격 구조의 교차 검토 · 공개된 규칙과 제외 근거'],
  charts: ['차트 연구실', '지표·시장구조·ICT 신호와 확정 여부'],
  events: ['이벤트 레이더', 'SEC 공시·FDA·희석·런웨이 — 공식 출처와 접수 시각'],
  research: ['기업 정밀분석', '점수 근거, 시나리오, 재무, 공시'],
  performance: ['성과 검증', '매일의 추천을 변경 불가 원장에 기록하고 SPY 대비 성과를 공개'],
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
          {page !== 'dashboard' && <div className="page-intro">
            <div>
              <div className="eyebrow">ALPHA / {code} <span className="eyebrow-line" /></div>
              <h1>{title}</h1>
              <p>{sub}</p>
            </div>
          </div>}
          {!ready ? <Loading label="API 연결 확인" /> : (
            <Suspense fallback={<Loading label="리서치 화면 불러오기" />}>
              {['discover','early-alpha'].includes(page)&&<MarketGate />}
              {page==='market-brief'&&<MarketBrief />}
              {page === 'dashboard' && <ResearchHome />}
              {page === 'industries' && <IndustryDesk />}
              {page === 'watchlist' && <Watchlist />}
              {page === 'workbench' && <Dashboard />}
              {page === 'market-map' && <MarketMap />}
              {page === 'discover' && <Discover />}
              {page === 'early-alpha' && <EarlyAlpha />}
              {page === 'charts' && <ChartLab />}
              {page === 'events' && <EventRadar />}
              {page === 'research' && <Research />}
              {page === 'performance' && <Performance />}
              {page === 'alerts' && <Alerts />}
              {page === 'settings' && <Settings />}
            </Suspense>
          )}
          <footer className="footer"><span>ALPHA TERMINAL / US EQUITY RESEARCH</span><span>지연 시세·공시 기반 리서치 · 출처와 기준일을 확인하세요</span></footer>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return <TerminalProvider><Shell /></TerminalProvider>;
}
