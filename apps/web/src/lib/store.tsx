import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { detectMode, liveSource, mockSource, type DataSource } from './api';
import { SIM_UNIVERSE } from './mock';
import { load, save } from './storage';
import { fetchWatchlist, setWatch, supabase, type Session } from './supabase';
import type { AnalyzeResponse, DataMode, Health, ScreenRow } from './types';

export type Page = 'dashboard' | 'discover' | 'charts' | 'events' | 'research' | 'settings';

// Default live universe: a mix of mega/large caps and smaller, higher-volatility names.
export const DEFAULT_LIVE_UNIVERSE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'AVGO', 'TSLA', 'AMD', 'JPM', 'LLY', 'XOM', 'PLTR', 'SOFI', 'RKLB', 'HIMS', 'IONQ', 'CELH', 'UPST', 'OKLO'];

interface Store {
  ready: boolean;
  mode: DataMode;
  health: Health | null;
  modeReason: string;
  source: DataSource;
  page: Page;
  setPage: (p: Page) => void;
  universe: string[];
  setUniverse: (u: string[]) => void;
  rows: ScreenRow[];
  screening: { done: number; total: number; running: boolean; at: string | null };
  runScreen: () => void;
  selected: string;
  select: (s: string) => void;
  watchlist: string[];
  toggleWatch: (s: string) => void;
  analysis: (s: string) => AnalyzeResponse | undefined;
  loadAnalysis: (s: string) => Promise<AnalyzeResponse>;
  session: Session | null;
  syncError: string | null;
}

const Ctx = createContext<Store | null>(null);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<DataMode>('mock');
  const [health, setHealth] = useState<Health | null>(null);
  const [modeReason, setModeReason] = useState('확인 중');
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) as Page) || 'dashboard');
  const [universe, setUniverseState] = useState<string[]>([]);
  const [rows, setRows] = useState<ScreenRow[]>([]);
  const [screening, setScreening] = useState({ done: 0, total: 0, running: false, at: null as string | null });
  const [selected, setSelected] = useState('');
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const cache = useRef(new Map<string, AnalyzeResponse>());
  const inflight = useRef(new Map<string, Promise<AnalyzeResponse>>());
  const [, bump] = useState(0);
  const source = mode === 'live' ? liveSource : mockSource;
  const nsKey = (k: string) => `alpha:${mode}:${k}`;

  useEffect(() => {
    detectMode().then(({ mode: m, health: h, reason }) => {
      setMode(m);
      setHealth(h);
      setModeReason(reason);
      const u = m === 'live' ? load(`alpha:live:universe`, DEFAULT_LIVE_UNIVERSE) : SIM_UNIVERSE.map((s) => s.symbol);
      setUniverseState(u);
      setSelected(load(`alpha:${m}:selected`, u[0]));
      setWatchlist(load(`alpha:${m}:watchlist`, []));
      setReady(true);
    });
  }, []);

  useEffect(() => { location.hash = page; }, [page]);

  // Supabase auth + watchlist sync (live mode only; mock symbols are never persisted remotely).
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session || mode !== 'live') return;
    fetchWatchlist().then((w) => { if (w) { setWatchlist(w); save('alpha:live:watchlist', w); } }).catch((e) => setSyncError(e.message));
  }, [session, mode]);

  const runScreen = useCallback(() => {
    if (!universe.length) return;
    setScreening({ done: 0, total: universe.length, running: true, at: null });
    source.screen(universe, (done, total, partial) => { setRows(partial); setScreening({ done, total, running: done < total, at: null }); })
      .then((r) => { setRows(r); setScreening({ done: universe.length, total: universe.length, running: false, at: new Date().toISOString() }); });
  }, [source, universe]);

  useEffect(() => { if (ready) runScreen(); }, [ready, runScreen]);

  const select = useCallback((s: string) => { setSelected(s); save(nsKey('selected'), s); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const setUniverse = useCallback((u: string[]) => {
    const clean = [...new Set(u.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    setUniverseState(clean);
    if (mode === 'live') save('alpha:live:universe', clean);
  }, [mode]);

  const toggleWatch = useCallback((s: string) => {
    setWatchlist((w) => {
      const on = !w.includes(s);
      const next = on ? [...w, s] : w.filter((x) => x !== s);
      save(nsKey('watchlist'), next);
      if (session && mode === 'live') setWatch(session.user.id, s, on).catch((e) => setSyncError(e.message));
      return next;
    });
  }, [session, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAnalysis = useCallback((s: string) => {
    const hit = cache.current.get(s);
    if (hit) return Promise.resolve(hit);
    const pending = inflight.current.get(s);
    if (pending) return pending;
    const p = source.analyze(s).then((r) => { cache.current.set(s, r); inflight.current.delete(s); bump((x) => x + 1); return r; })
      .catch((e) => { inflight.current.delete(s); throw e; });
    inflight.current.set(s, p);
    return p;
  }, [source]);

  const value = useMemo<Store>(() => ({
    ready, mode, health, modeReason, source, page, setPage, universe, setUniverse, rows, screening, runScreen,
    selected, select, watchlist, toggleWatch, analysis: (s) => cache.current.get(s), loadAnalysis, session, syncError,
  }), [ready, mode, health, modeReason, source, page, universe, setUniverse, rows, screening, runScreen, selected, select, watchlist, toggleWatch, loadAnalysis, session, syncError]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTerminal() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTerminal outside provider');
  return v;
}

/** Load (and cache) the full analysis for a symbol. */
export function useAnalysis(symbol: string) {
  const { loadAnalysis, analysis } = useTerminal();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    setError(null);
    setLoading(true);
    loadAnalysis(symbol).catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [symbol, loadAnalysis]);
  return { data: analysis(symbol), error, loading };
}
