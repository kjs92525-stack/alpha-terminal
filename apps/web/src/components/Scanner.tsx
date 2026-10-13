import { useState } from 'react';
import { RefreshCw, Star } from 'lucide-react';
import { useTerminal } from '../lib/store';
import { fmtPct, SIZE_LABEL, STYLE_LABEL } from '../lib/format';
import { ModeBadge, PanelHead } from './ui';
import type { ScreenRow } from '../lib/types';

type Filter = 'all' | 'growth' | 'value' | 'large' | 'small' | 'watch';
const FILTERS: Array<[Filter, string]> = [['all', '전체'], ['growth', '성장'], ['value', '가치'], ['large', '대형'], ['small', '중소형'], ['watch', '★']];

export function filterRows(rows: ScreenRow[], f: Filter, watch: string[]) {
  return rows.filter((r) => {
    if (f === 'all') return true;
    if (f === 'watch') return watch.includes(r.symbol);
    if (f === 'growth' || f === 'value') return r.style === f;
    if (f === 'large') return r.size === 'mega' || r.size === 'large';
    return r.size === 'mid' || r.size === 'small' || r.size === 'micro';
  });
}

export function ScannerPanel() {
  const { rows, screening, runScreen, selected, select, watchlist } = useTerminal();
  const [f, setF] = useState<Filter>('all');
  const list = filterRows(rows, f, watchlist);
  return (
    <section className="panel scanner-panel">
      <PanelHead kicker="01 / DISCOVERY" title="Alpha Scanner" right={<ModeBadge />} />
      <div className="scanner-tabs">{FILTERS.map(([k, l]) => <button key={k} className={f === k ? 'active' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
      <div className="scanner-heading"><span>RANK / TICKER</span><span>QUANT SCORE</span></div>
      <div className="scanner-list">
        {list.map((r) => (
          <button key={r.symbol} className={`scanner-stock ${selected === r.symbol ? 'selected' : ''}`} onClick={() => select(r.symbol)}>
            <div className="stock-rank">{r.rank ? String(r.rank).padStart(2, '0') : '--'}</div>
            <div className="stock-info">
              <strong>{r.symbol}{watchlist.includes(r.symbol) && <Star size={10} className="star-on" />}</strong>
              <small>{r.name ?? r.error ?? ''}</small>
              <span>{r.size ? SIZE_LABEL[r.size] : ''}{r.style ? ` · ${STYLE_LABEL[r.style]}` : ''}</span>
            </div>
            <div className="stock-metrics">
              <strong>{r.score ?? '—'}<small>/100</small></strong>
              <span className={(r.metrics?.ret1m ?? 0) >= 0 ? 'up' : 'down'}>{fmtPct(r.metrics?.ret1m)} 1M</span>
            </div>
          </button>
        ))}
        {!list.length && <div className="empty">{screening.running ? '스크리닝 중…' : '조건에 맞는 종목이 없습니다.'}</div>}
      </div>
      <div className="scanner-footer">
        <button onClick={runScreen} disabled={screening.running}><RefreshCw size={11} className={screening.running ? 'spin' : ''} /> {screening.running ? `${screening.done}/${screening.total}` : '재계산'}</button>
        <span>{list.length} ITEMS</span>
      </div>
    </section>
  );
}
