import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Layers3, Maximize2, RefreshCw } from 'lucide-react';
import { fetchSetups, NoSnapshotError, SECTOR_KO, type SetupRow, type Setups } from '../lib/snapshot';
import { fmtPct, fmtUsd } from '../lib/format';
import { useTerminal } from '../lib/store';
import './MarketMap.css';

type View = 'sector' | 'theme';
type Period = 'ret1' | 'ret5' | 'ret21' | 'ret63';
type SizeMode = 'cap' | 'equal';
type Rect = { x: number; y: number; w: number; h: number };
type Node<T> = { item: T; rect: Rect };
type Group = { key: string; stocks: SetupRow[]; weight: number };

const PERIODS: { key: Period; label: string }[] = [
  { key: 'ret1', label: '1일' }, { key: 'ret5', label: '5일' },
  { key: 'ret21', label: '1개월' }, { key: 'ret63', label: '3개월' },
];
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const cap = (s: SetupRow) => valid(s.mcap) && s.mcap > 0 ? s.mcap : 0;
const value = (s: SetupRow, p: Period): number | null => { const n = s[p]; return valid(n) ? n : null; };
const weight = (s: SetupRow, size: SizeMode) => size === 'equal' ? 1 : cap(s);
const position = (r: Rect, base: Rect) => ({
  left: `${((r.x - base.x) / base.w) * 100}%`,
  top: `${((r.y - base.y) / base.h) * 100}%`,
  width: `${(r.w / base.w) * 100}%`,
  height: `${(r.h / base.h) * 100}%`,
});

/** Recursive binary treemap: each box's area is proportional to its weight. */
function pack<T>(items: T[], getWeight: (item: T) => number, r: Rect): Node<T>[] {
  if (!items.length || r.w <= 0 || r.h <= 0) return [];
  if (items.length === 1) return [{ item: items[0], rect: r }];
  const sorted = [...items].sort((a, b) => getWeight(b) - getWeight(a));
  const total = sorted.reduce((sum, item) => sum + Math.max(0, getWeight(item)), 0);
  if (total <= 0) return [];
  let taken = 0, cut = 1;
  for (let i = 0; i < sorted.length - 1; i++) {
    taken += Math.max(0, getWeight(sorted[i]));
    cut = i + 1;
    if (taken >= total / 2) break;
  }
  const fraction = taken / total;
  const alongX = r.w >= r.h;
  const a: Rect = alongX ? { ...r, w: r.w * fraction } : { ...r, h: r.h * fraction };
  const b: Rect = alongX
    ? { x: r.x + a.w, y: r.y, w: r.w - a.w, h: r.h }
    : { x: r.x, y: r.y + a.h, w: r.w, h: r.h - a.h };
  return [...pack(sorted.slice(0, cut), getWeight, a), ...pack(sorted.slice(cut), getWeight, b)];
}

function tileColor(ret: number | null) {
  if (ret === null) return 'rgba(92,104,133,.35)';
  const strength = Math.min(Math.abs(ret), .12) / .12;
  const opacity = (0.29 + 0.56 * strength).toFixed(2);
  return ret > 0 ? `rgba(224,78,83,${opacity})` : ret < 0 ? `rgba(69,119,218,${opacity})` : 'rgba(100,110,132,.4)';
}

function grouped(rows: SetupRow[], view: View, size: SizeMode): Group[] {
  const m = new Map<string, SetupRow[]>();
  for (const s of rows) {
    const key = view === 'sector'
      ? (SECTOR_KO[s.sector] || s.sector || '미분류 업종')
      : (s.themes?.find((t) => Boolean(t.trim())) || '분류되지 않은 테마');
    const list = m.get(key) || [];
    list.push(s);
    m.set(key, list);
  }
  return [...m].map(([key, stocks]) => ({
    key, stocks, weight: stocks.reduce((sum, s) => sum + weight(s, size), 0),
  })).sort((a, b) => b.weight - a.weight);
}

function groupReturn(group: Group, period: Period, size: SizeMode) {
  const measured = group.stocks.filter((s) => value(s, period) !== null);
  const denominator = measured.reduce((sum, s) => sum + weight(s, size), 0);
  if (!denominator) return null;
  return measured.reduce((sum, s) => sum + value(s, period)! * weight(s, size), 0) / denominator;
}

export function MarketMap({ compact = false }: { compact?: boolean }) {
  const { select, setPage } = useTerminal();
  const [data, setData] = useState<Setups | null>(null);
  const [status, setStatus] = useState<'loading' | 'missing' | 'error' | 'ok'>('loading');
  const [view, setView] = useState<View>('sector');
  const [period, setPeriod] = useState<Period>('ret1');
  const [size, setSize] = useState<SizeMode>('cap');
  const [focus, setFocus] = useState<string | null>(null);

  const reload = () => {
    setStatus('loading');
    fetchSetups().then((s) => { setData(s); setStatus('ok'); })
      .catch((e: unknown) => setStatus(e instanceof NoSnapshotError ? 'missing' : 'error'));
  };
  useEffect(() => { reload(); }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    // Price/market-cap coverage is not complete: missing cap is excluded, never fabricated.
    const unique = new Map<string, SetupRow>();
    for (const s of data.candidates) if (cap(s) > 0 && !unique.has(s.symbol)) unique.set(s.symbol, s);
    return [...unique.values()].sort((a, b) => cap(b) - cap(a)).slice(0, compact ? 55 : 160);
  }, [data, compact]);

  const groups = useMemo(() => grouped(rows, view, size), [rows, view, size]);
  const displayed = focus ? groups.filter((g) => g.key === focus) : groups;
  const root: Rect = { x: 0, y: 0, w: 1.85, h: 1 };
  const blocks = pack(displayed, (g) => g.weight, root);
  const covered = rows.filter((s) => value(s, period) !== null).length;

  return (
    <section className="usmap panel" aria-label="미국 주식 히트맵">
      <header className="usmap-header">
        <div>
          <div className="usmap-overline">US EQUITIES / MARKET MAP</div>
          <h2>미국 주식 {view === 'sector' ? '업종맵' : '테마맵'} <span className="usmap-asof">{data ? `기준일 ${data.asOf}` : ''}</span></h2>
          <p>크기: {size === 'cap' ? '시가총액' : '종목별 동일 크기'} · 색: {PERIODS.find((p) => p.key === period)?.label} 등락률 · 미국 거래소 상장 스캐너 후보</p>
        </div>
        <div className="usmap-header-actions">
          {compact && <button className="usmap-expand" onClick={() => setPage('market-map')}><Maximize2 size={13} /> 전체 화면 <ArrowUpRight size={13} /></button>}
          <button className="usmap-reload" onClick={reload} aria-label="히트맵 새로고침" title="저장된 야간 스냅샷 다시 가져오기"><RefreshCw size={15} /></button>
        </div>
      </header>
      <div className="usmap-controls">
        <div className="usmap-segment" role="group" aria-label="지도 분류">
          <button className={view === 'sector' ? 'active' : ''} onClick={() => { setView('sector'); setFocus(null); }}>업종맵</button>
          <button className={view === 'theme' ? 'active' : ''} onClick={() => { setView('theme'); setFocus(null); }}>테마맵</button>
        </div>
        <div className="usmap-segment" role="group" aria-label="가격 변동 기간">
          {PERIODS.map((p) => <button key={p.key} className={period === p.key ? 'active' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
        </div>
        <div className="usmap-segment" role="group" aria-label="사각형 크기 기준">
          <button className={size === 'cap' ? 'active' : ''} onClick={() => setSize('cap')}>시총 비중</button>
          <button className={size === 'equal' ? 'active' : ''} onClick={() => setSize('equal')}>동일 비중</button>
        </div>
      </div>
      {focus && <div className="usmap-focus"><b>{focus}</b><button onClick={() => setFocus(null)}>전체로 돌아가기 ×</button></div>}
      {status === 'loading' && <div className="usmap-placeholder">미국 주식 스캐너 데이터를 불러오고 있습니다…</div>}
      {status === 'missing' && <div className="usmap-placeholder">아직 야간 스캐너 결과가 없습니다. 데이터 생성 후 표시됩니다.</div>}
      {status === 'error' && <div className="usmap-placeholder">데이터 연결에 실패했습니다. 새로고침으로 다시 시도할 수 있습니다.</div>}
      {status === 'ok' && !rows.length && <div className="usmap-placeholder">시가총액을 확인할 수 있는 후보 종목이 없습니다. 임의 데이터를 표시하지 않습니다.</div>}
      {status === 'ok' && rows.length > 0 && <>
        <div className="usmap-scroll" tabIndex={0} aria-label="히트맵 가로 스크롤 영역">
          <div className={`usmap-stage${compact ? ' compact' : ''}`}>
            {blocks.map(({ item: g, rect }) => {
              const localBase: Rect = { x: 0, y: 0, w: Math.max(rect.w / rect.h, .14), h: 1 };
              const pieces = pack(g.stocks, (s) => weight(s, size), localBase);
              const ret = groupReturn(g, period, size);
              return <div key={g.key} className="usmap-group" style={position(rect, root)}>
                <button className="usmap-group-label" onClick={() => setFocus(focus === g.key ? null : g.key)} title={`${g.key} 확대`}>
                  <span>{g.key}</span><span className={ret !== null ? (ret >= 0 ? 'up' : 'down') : ''}>{fmtPct(ret, 2)}</span>
                </button>
                <div className="usmap-tiles">
                  {pieces.map(({ item: s, rect: sr }) => {
                    const ret = value(s, period);
                    return <button key={s.symbol} className="usmap-tile" style={{ ...position(sr, localBase), background: tileColor(ret) }}
                      onClick={() => { select(s.symbol); setPage('research'); }}
                      title={`${s.symbol} · ${s.name || ''}\n${fmtPct(ret, 2)} (${PERIODS.find((p) => p.key === period)?.label})\n시총 ${fmtUsd(s.mcap)} · 클릭하여 정밀분석`}
                      aria-label={`${s.symbol} ${fmtPct(ret, 2)} 정밀분석 열기`}>
                      <strong>{s.symbol}</strong><span>{fmtPct(ret, 2)}</span>
                    </button>;
                  })}
                </div>
              </div>;
            })}
          </div>
        </div>
        <div className="usmap-legend">
          <span><i className="usmap-dot rise" /> 상승</span>
          <span><i className="usmap-dot fall" /> 하락</span>
          <span><i className="usmap-dot unknown" /> 미확인</span>
          <span className="usmap-summary">{rows.length}개 후보 중 {covered}개 등락률 확인 · {groups.length}개 {view === 'sector' ? '업종' : '테마'} · 종목 클릭 시 기업 분석</span>
        </div>
        <p className="usmap-disclaimer"><Layers3 size={12} /> 전체 미국 시장 지도가 아닙니다. 야간 스캐너 후보(시총 확인 종목, 최대 {compact ? 55 : 160}개) 기준이며 미포함 종목이 많습니다. 테마는 후보별 첫 번째 태그를 사용합니다. 업종·테마 수익률은 표시된 후보만의 가중 평균이며 ETF/산업지수 수익률이 아닙니다. 가로로 밀어서 탐색하세요.</p>
      </>}
    </section>
  );
}
