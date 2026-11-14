import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, BarChart3, BellRing, Bookmark, ChevronDown, Trophy, ChevronsLeft, ChevronsRight, CandlestickChart, Layers3, Menu, Radar, Search, Settings, Sparkles, X, FileSearch, Workflow, LayoutDashboard } from 'lucide-react';
import { useTerminal, type Page } from '../lib/store';
import { load, save } from '../lib/storage';
import type { TickerHit } from '../lib/types';

export const PAGES: Array<{ id: Page; label: string; code: string; icon: ReactNode }> = [
  { id: 'dashboard', label: '오늘의 리서치', code: 'TODAY', icon: <LayoutDashboard size={17} /> },
  { id: 'industries', label: '산업·테마 리서치', code: 'INDUSTRIES', icon: <Workflow size={17} /> },
  { id: 'market-map', label: '미국 주식 시장맵', code: 'US MARKET MAP', icon: <Layers3 size={16} /> },
  { id: 'watchlist', label: '나의 관심종목', code: 'WATCHLIST', icon: <Bookmark size={17} /> },
  { id:'market-brief',label:'시장 브리핑',code:'MARKET BRIEF',icon:<Activity size={16} /> },
  { id: 'performance', label: '성과 검증', code: 'TRACK RECORD', icon: <Trophy size={16} /> },
  { id: 'research', label: '기업 정밀분석', code: 'RESEARCH', icon: <FileSearch size={16} /> },
  { id: 'discover', label: '조건 기반 종목발굴', code: 'DISCOVERY', icon: <Sparkles size={16} /> },
  { id: 'early-alpha', label: 'EARLY ALPHA', code: 'EARLY ALPHA', icon: <Search size={16} /> },
  { id: 'charts', label: '차트 연구실', code: 'CHART LAB', icon: <CandlestickChart size={16} /> },
  { id: 'events', label: '이벤트 레이더', code: 'EVENT RADAR', icon: <Radar size={16} /> },
  { id: 'workbench', label: '고급 워크벤치', code: 'WORKBENCH', icon: <BarChart3 size={16} /> },
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
  const [rail, setRail] = useState(() => load('alpha:navcompact:v2', false));
  const toggleRail = () => { setRail(!rail); save('alpha:navcompact:v2', !rail); };
  const navButton = (p: typeof PAGES[number]) => <button key={p.id} className={page === p.id ? 'active' : ''} title={p.label} aria-label={p.label} aria-current={page === p.id ? 'page' : undefined} onClick={() => { setPage(p.id); onClose(); }}>{p.icon}<span>{p.label}</span>{p.id === 'watchlist' && watchlist.length > 0 && <em className="nav-count">{watchlist.length}</em>}{p.id === 'discover' && <em className="nav-count">{universe.length}</em>}</button>;
  return (
    <>
    {open && <button className="nav-overlay" aria-label="메뉴 배경 닫기" onClick={onClose} />}
    <aside className={`sidebar ${rail ? 'rail' : ''} ${open ? 'mobile-show' : ''}`}>
      <div className="brand">
        <div className="brand-logo">Λ</div>
        <div><strong>ALPHA<span>TERMINAL</span></strong><small>US EQUITY RESEARCH</small></div>
        <button className="mobile-close icon-button" onClick={onClose} aria-label="메뉴 닫기"><X size={16} /></button>
      </div>
      <div className="workspace-label">RESEARCH WORKSPACE</div>
      <nav className="main-nav">
        {PAGES.slice(0,6).map(navButton)}
        <details className="nav-secondary" open={PAGES.slice(6).some(p => p.id === page) || undefined}>
          <summary>분석 도구 <ChevronDown size={13} /></summary>
          {PAGES.slice(6).map(navButton)}
        <button title="알파 데스크 (기존)" aria-label="알파 데스크 (기존)" onClick={() => location.assign('/desk.html')}>
          <FileSearch size={16} /><span>알파 데스크 (기존)</span>
        </button>
        </details>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-status">
          <span className={`status-circle ${mode === 'live' ? '' : 'amber'}`} />
          <div><b>{mode === 'mock' ? '명시적 데모 모드' : health?.ok ? '리서치 API 연결' : 'API 연결 확인 필요'}</b><small>{modeReason}</small><small>시세는 지연·종가 기준</small></div>
        </div>
        <div className="sidebar-version">US STOCKS ONLY <span>RESEARCH</span></div>
        <button className="rail-toggle" onClick={toggleRail} title={rail ? '메뉴 펼치기' : '메뉴 접기'} aria-label={rail ? '메뉴 펼치기' : '메뉴 접기'}>{rail ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}</button>
      </div>
    </aside>
    </>
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
  const { page, mode, health } = useTerminal();
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
        <div className="announcement">⚠ <b>DEMO</b> · 개별 API 분석은 합성 데이터입니다. 시장맵·야간 리서치는 공개 스냅샷을 사용합니다.</div>
      ) : (
        <div className="announcement live"><span className="rd-live-dot"/><b>DELAYED DATA</b><span>미국 주식 · SEC 공시·재무 + 지연 시세 · 각 자료의 기준일 확인</span><span className="announcement-right">{health?.ok?'API 연결됨':'API 확인 필요 · 공개 스냅샷 이용 가능'}</span></div>
      )}
    </>
  );
}

export function BottomNav() {
  const {page,setPage}=useTerminal();
  const ids=['dashboard','industries','market-map','watchlist','performance'];
  const labels=['오늘','산업','시장맵','관심','성과'];
  return <nav className="bottom-nav" aria-label="모바일 주요 메뉴">{ids.map((id,i)=>{const p=PAGES.find(p=>p.id===id)!;return <button key={id} aria-label={`하단 ${p.label}`} aria-current={page===id?'page':undefined} className={page===id?'active':''} onClick={()=>setPage(p.id)}>{p.icon}<span>{labels[i]}</span></button>;})}</nav>;
}
