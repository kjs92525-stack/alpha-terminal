import { useEffect, useMemo, useState } from 'react';
import { analyzeBars } from '../../../../packages/analysis/indicators.mjs';
import { useTerminal } from '../lib/store';
import { load, save } from '../lib/storage';
import type { BarsResponse, Timeframe } from '../lib/types';
import { fmtPct, fmtPrice, signClass } from '../lib/format';
import { PriceChart, type Overlay } from './PriceChart';
import { ErrorBox, Loading, SourceBadge } from './ui';
import { TechSummary } from './TechSummary';
import { SignalTable } from './SignalTable';
import { TradingViewWidget } from './TradingViewWidget';

const TFS: Timeframe[] = ['5m', '1H', '1D', '1W'];
const OVERLAYS: Array<[Overlay, string]> = [
  ['volume', 'VOL'], ['ema20', 'EMA20'], ['sma50', 'SMA50'], ['sma200', 'SMA200'], ['vwap', 'VWAP'], ['rsi', 'RSI'], ['macd', 'MACD'],
  ['ob', '오더블록'], ['structure', 'BOS/CHoCH'], ['fvg', 'FVG'], ['levels', 'S/R'], ['profile', 'VPVR'],
];
const DEFAULT_OVERLAYS: Overlay[] = ['volume', 'ema20', 'sma50', 'ob'];

export function useBars(symbol: string, tf: Timeframe) {
  const { source } = useTerminal();
  const [data, setData] = useState<BarsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!symbol) return;
    const ctrl = new AbortController();
    setError(null);
    setData(null);
    source.bars(symbol, tf, ctrl.signal).then(setData).catch((e) => { if (!ctrl.signal.aborted) setError(e.message); });
    return () => ctrl.abort();
  }, [symbol, tf, source]);
  return { data, error };
}

export function ChartWorkspace({ symbol, full = false, height }: { symbol: string; full?: boolean; height?: number }) {
  const [tf, setTf] = useState<Timeframe>(() => load('alpha:tf', '1D'));
  const [show, setShow] = useState<Set<Overlay>>(() => new Set(load<Overlay[]>(full ? 'alpha:overlays:full:v2' : 'alpha:overlays:v2', full ? [...DEFAULT_OVERLAYS, 'structure', 'rsi', 'macd'] : DEFAULT_OVERLAYS)));
  const [engine, setEngine] = useState<'alpha' | 'tv'>(() => load('alpha:engine', 'alpha'));
  const pickEngine = (e: 'alpha' | 'tv') => { setEngine(e); save('alpha:engine', e); };
  const { data, error } = useBars(engine === 'alpha' ? symbol : '', tf);
  const intraday = tf === '5m' || tf === '1H';
  const analysis = useMemo(() => (data ? analyzeBars(data.bars, { lastBarClosed: data.lastBarClosed, vwapAnchor: intraday ? 'session' : 'none' }) : null), [data, intraday]);

  const toggle = (o: Overlay) => {
    const next = new Set(show);
    if (next.has(o)) next.delete(o); else next.add(o);
    setShow(next);
    save(full ? 'alpha:overlays:full:v2' : 'alpha:overlays:v2', [...next]);
  };
  const pickTf = (t: Timeframe) => { setTf(t); save('alpha:tf', t); };

  const bars = data?.bars ?? [];
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const chg = last && prev ? last.close / prev.close - 1 : null;

  return (
    <div className="chart-workspace">
      <div className="chart-header">
        <div>
          <div className="ticker-row">
            <span className="ticker-large">{symbol || '—'}</span>
            {data && <SourceBadge name={data.source} fetchedAt={data.fetchedAt} url={data.sourceUrl || undefined} />}
          </div>
          <div className="subline">USD · {tf} · {data ? `${bars.length} bars · ${data.delayNote}` : '—'}{data && !data.lastBarClosed && <span className="neutral"> · 마지막 봉 진행 중 (미확정)</span>}</div>
        </div>
        <div className="quote">
          <strong>{last ? `$${fmtPrice(last.close)}` : '—'}</strong>
          <span className={signClass(chg)}>{fmtPct(chg, 2)}</span>
        </div>
      </div>
      <div className="chart-toolbar">
        <div className="tf-list">
          {TFS.map((t) => <button key={t} className={t === tf ? 'selected' : ''} onClick={() => pickTf(t)}>{t}</button>)}
          <span className="tf-sep" />
          <button className={engine === 'alpha' ? 'selected' : ''} onClick={() => pickEngine('alpha')} title="ALPHA 분석 엔진 (신호·확정 여부)">ALPHA</button>
          <button className={engine === 'tv' ? 'selected' : ''} onClick={() => pickEngine('tv')} title="TradingView 공식 위젯">TradingView</button>
        </div>
        {engine === 'alpha' && <div className="chart-options">
          {OVERLAYS.filter(([o]) => full || !['rsi', 'macd', 'profile', 'sma200'].includes(o)).map(([o, label]) => (
            <button key={o} className={show.has(o) ? 'selected' : ''} onClick={() => toggle(o)}>{label}</button>
          ))}
        </div>}
      </div>
      {engine === 'tv' && (symbol.startsWith('SIM') ? <div className="pad-box muted">가상 종목(SIM)은 TradingView에 없습니다. 실데이터 모드에서 사용하세요.</div> : <TradingViewWidget symbol={symbol} tf={tf} height={height ?? (full ? 560 : 400)} />)}
      {engine === 'tv' && <p className="footnote pad">TradingView 위젯은 TradingView 자체 데이터로 그려지며 ALPHA 신호·확정 표시는 포함되지 않습니다. 같은 신호를 TradingView에서 보려면 “TradingView 연동” 메뉴의 Pine Script를 추가하세요.</p>}
      {engine === 'alpha' && error && <ErrorBox error={error} hint={intraday ? '분봉/시간봉은 Yahoo 공급자가 활성화되어야 합니다.' : undefined} />}
      {engine === 'alpha' && !error && !analysis && <div className="chart-placeholder" style={{ height: height ?? (full ? 560 : 400) }}><Loading label="시세 로딩" /></div>}
      {engine === 'alpha' && analysis && <PriceChart bars={bars} analysis={analysis} show={show} intraday={intraday} height={height ?? (full ? 560 : 400)} watermark={`${symbol} · ${tf}`} />}
      {engine === 'alpha' && full && analysis && data && (
        <div className="lab-grid">
          <section className="panel inner">
            <div className="panel-head slim"><div><span className="panel-kicker">TECHNICAL READING</span><h2>기술적 판단 요약</h2></div></div>
            <TechSummary bars={bars} analysis={analysis} lastBarClosed={data.lastBarClosed} />
          </section>
          <section className="panel inner">
            <div className="panel-head slim"><div><span className="panel-kicker">SIGNAL LEDGER</span><h2>신호 원장 · 확정 여부</h2></div></div>
            <SignalTable bars={bars} analysis={analysis} intraday={intraday} />
          </section>
        </div>
      )}
    </div>
  );
}
