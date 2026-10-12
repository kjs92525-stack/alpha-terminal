import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, BarChart3, BellRing, Trophy, CandlestickChart, Menu, Radar, Search, Settings, Sparkles, X, FileSearch } from 'lucide-react';
import { useTerminal, type Page } from '../lib/store';
import type { TickerHit } from '../lib/types';

export const PAGES: Array<{ id: Page; label: string; code: string; icon: ReactNode }> = [
  { id: 'dashboard', label: '통합 터미널', code: 'DASHBOARD', icon: <Activity size={16} /> },
  { id: 'discover', label: 'AI 종목발굴', code: 'DISCOVERY', icon: <Sparkles size={16} /> },
  { id: 'charts', label: '차트 연구실', code: 'CHART LAB', icon: <CandlestickChart size={16} /> },
  { id: 'events', label: '이벤트 레이더', code: 'EVENT RADAR', icon: <Radar size={16} /> },
  { id: 'research', label: '기업 정밀분석', code: 'RESEARCH', icon: <FileSearch size={16} /> },
  { id: 'performance', label: '성과 검증', code: 'TRACK RECORD', icon: <Trophy size={16} /> },
  { id: 'alerts', label: 'TradingView 연동', code: 'TRADINGVIEW', icon: <BellRing size={16} /> },
  { id: 'settings', label: '데이터 연결', code: 'CONNECTIONS', icon: <Settings size={16} /> },
];

/** US regular-session status from New York wall clock (exchange holidays not modelled). */
function marketStatus(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).map((p) => [p.type, p.value]));
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const weekend = parts.weekday === 'Sat' || parts.weekday === 'Sun';
  if (weekend) return { label: 'CLOSED · 주말', open: false };
  if (mins >= 570 && mins < 960) return { label: 'MARKET OPEN', open: true };
  if (mins >= 240 && mins < 570) return { label: 'PRE-MARKET', open: false };
  if (mins >= 960 && mins < 1200) return { label: 'AFTER HOURS', open: false };
  return { label: 'CLOSED', open: false };
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { page, setPage, mode, modeReason, health, universe, watchlist } = useTerminal();
  return (
    <aside className={`sidebar ${open ? 'mobile-show' : ''}`}>
      <div className="brand">
        <div className="brand-logo">Λ</div>
        <div><strong>ALPHA<span>TERMINAL</span></strong><small>QUANT INTELLIGENCE</small></div>
        <button className="mobile-close icon-button" onClick={onClose} aria-label="메뉴 닫기"><X size={16} /></button>
      </div>
      <div className="workspace-label">WORKSPACE <span>01</span></div>
      <nav className="main-nav">
        {PAGES.map((p) => (
          <button key={p.id} className={page === p.id ? 'active' : ''} onClick={() => { setPage(p.id); onClose(); }}>
            {p.icon}<span>{p.label}</span>
            {p.id === 'discover' && <em className="nav-count">{universe.length}</em>}
            {p.id === 'dashboard' && watchlist.length > 0 && <em className="nav-count">★{watchlist.length}</em>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-status">
          <span className={`status-circle ${mode === 'live' ? '' : 'amber'}`} />
          <div><b>{mode === 'live' ? '실데이터 모드' : '가상 데이터 모드'}</b><small>{modeReason}</small>{health && <small>API v{health.version}</small>}</div>
        </div>
        <div className="sidebar-version">ALPHA TERMINAL <span>V0.4</span></div>
      </div>
    </aside>
  );
}

function SymbolSearch() {
  const { source, select, setPage } = useTerminal();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TickerHit[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => source.search(q, ctrl.signal).then(setHits).catch(() => setHits([])), 220);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, source]);
  const pick = (s: string) => { select(s.toUpperCase()); setPage('research'); setQ(''); setOpen(false); };
  return (
    <div className="search-wrap">
      <div className="global-search">
        <Search size={13} />
        <input ref={ref} value={q} placeholder="티커·기업명 검색" aria-label="종목 검색" onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) pick(hits[0]?.ticker ?? q.trim()); if (e.key === 'Escape') setOpen(false); }} onBlur={() => setTimeout(() => setOpen(false), 150)} />
        <kbd>/</kbd>
      </div>
      {open && hits.length > 0 && (
        <div className="search-menu">
          {hits.map((h) => <button key={h.ticker + h.cik} onMouseDown={() => pick(h.ticker)}><b>{h.ticker}</b><span>{h.name}</span></button>)}
        </div>
      )}
    </div>
  );
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { page, mode } = useTerminal();
  const [ms, setMs] = useState(marketStatus());
  useEffect(() => { const t = setInterval(() => setMs(marketStatus()), 30000); return () => clearInterval(t); }, []);
  const current = PAGES.find((p) => p.id === page);
  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <button className="hamburger icon-button" onClick={onMenu} aria-label="메뉴 열기"><Menu size={16} /></button>
          <div className="breadcrumb">WORKSPACE <span>/</span> <b>{current?.label}</b></div>
        </div>
        <div className="topbar-right">
          <SymbolSearch />
          <div className="market-status" title="뉴욕 시간 기준, 거래소 휴장일 미반영"><span className={`status-circle ${ms.open ? '' : 'amber'}`} /> {ms.label}</div>
          <div className="user-avatar"><BarChart3 size={14} /></div>
        </div>
      </header>
      {mode === 'mock' ? (
        <div className="announcement">⚠ <b>SIMULATED DATA</b> · API 미연결 — 대시보드·차트·개별 분석은 가상 종목(SIM01–06)과 합성 시세입니다. (AI 종목발굴의 야간 랭킹·성과 검증은 실데이터 스냅샷이 있을 때 실데이터)<span className="announcement-right">데이터 연결 메뉴 참고</span></div>
      ) : (
        <div className="announcement live">● <b>LIVE</b> · SEC EDGAR 공식 공시·재무 + 무료 지연 시세(EOD/비공식). 실시간 체결가가 아니며 투자 자문이 아닙니다.<span className="announcement-right">모든 수치에 출처·갱신 시각 표시</span></div>
      )}
    </>
  );
}
