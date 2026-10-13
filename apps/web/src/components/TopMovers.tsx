import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTerminal } from '../lib/store';
import type { Mover, MoversResponse } from '../lib/types';
import { fmtPct, fmtPrice } from '../lib/format';
import { ErrorBox, Loading, SourceBadge } from './ui';

const PRICE_FLOORS = [1, 5, 20];

/** Day range bar: low ... high with markers for open (hollow) and last (filled). */
function RangeBar({ m }: { m: Mover }) {
  if (m.dayLow === null || m.dayHigh === null || m.price === null || m.dayHigh <= m.dayLow) return <span className="muted small">범위 —</span>;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - m.dayLow!) / (m.dayHigh! - m.dayLow!)) * 100))}%`;
  return (
    <div className="range">
      <div className="range-track"><span className="range-fill" style={{ width: pos(m.price) }} />{m.open !== null && <i className="range-open" style={{ left: pos(m.open) }} />}<i className="range-last" style={{ left: pos(m.price) }} /></div>
      <div className="range-labels"><span>${fmtPrice(m.dayLow)}</span><span>${fmtPrice(m.dayHigh)}</span></div>
    </div>
  );
}

export function TopMovers() {
  const { source, mode, select, setPage } = useTerminal();
  const [side, setSide] = useState<'gainers' | 'losers'>('gainers');
  const [floor, setFloor] = useState(5);
  const [data, setData] = useState<MoversResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); source.movers(floor).then(setData).catch((e) => setErr(e.message)); }, [source, floor]);
  useEffect(() => { load(); if (mode !== 'live') return; const t = setInterval(load, 60000); return () => clearInterval(t); }, [load, mode]);
  const list = data?.[side] ?? [];
  return (
    <section className="panel movers-panel">
      <div className="feed-head">
        <div className="seg">
          <button className={side === 'gainers' ? 'on' : ''} onClick={() => setSide('gainers')}><ArrowUp size={11} /> 상승률 상위</button>
          <button className={side === 'losers' ? 'on' : ''} onClick={() => setSide('losers')}><ArrowDown size={11} /> 하락률 상위</button>
        </div>
        <select className="mini-select" value={floor} onChange={(e) => setFloor(Number(e.target.value))} aria-label="최소 가격">
          {PRICE_FLOORS.map((p) => <option key={p} value={p}>${p} 이상</option>)}
        </select>
      </div>
      {err && <ErrorBox error={err} hint={/401/.test(err) ? 'Alpaca 키가 거부됐습니다(401). 키를 새로 만들었다면 Cloudflare → alpha-terminal → Settings → Variables and Secrets의 ALPACA_KEY_ID / ALPACA_SECRET_KEY도 새 키로 바꿔야 합니다.' : /ALPACA/.test(err) ? 'ALPACA 키를 Cloudflare 시크릿에 등록하세요.' : undefined} />}
      {!data && !err && <Loading />}
      <div className="movers-list">
        {list.map((m, i) => (
          <button key={m.symbol} className="mover-row" onClick={() => { select(m.symbol); setPage('research'); }}>
            <span className="mover-rank">{i + 1}</span>
            <span className="mover-sym"><b>{m.symbol}</b><small>${fmtPrice(m.price)}</small></span>
            <span className={`mover-chg ${(m.changePct ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtPct(m.changePct, 2)}</span>
            <RangeBar m={m} />
          </button>
        ))}
        {data && !list.length && <div className="empty">해당 종목 없음</div>}
      </div>
      {data && <div className="pad-box"><SourceBadge name={data.source} fetchedAt={data.fetchedAt} note="무료 플랜: IEX 기준 가격" /></div>}
    </section>
  );
}
