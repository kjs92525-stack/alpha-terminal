import { ExternalLink } from 'lucide-react';
import type { Bar, Filing } from '../lib/types';
import { CATEGORY_LABEL, fmtEt, fmtPct } from '../lib/format';

/**
 * Measured price reaction to a filing: close of the first session that could react
 * (same day if accepted before 16:00 ET, else next session) vs the prior close.
 */
export function filingReaction(f: Filing, bars: Bar[]) {
  if (!bars.length || !f.filingDate) return null;
  let day = f.filingDate;
  if (f.acceptedAt) {
    const et = new Date(f.acceptedAt).toLocaleString('en-CA', { timeZone: 'America/New_York', hour: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
    const [date, hour] = et.split(', ');
    day = date;
    if (Number(hour) >= 16) {
      const idx = bars.findIndex((b) => new Date(b.time * 1000).toISOString().slice(0, 10) > day);
      if (idx <= 0) return null;
      return react(bars, idx);
    }
  }
  const idx = bars.findIndex((b) => new Date(b.time * 1000).toISOString().slice(0, 10) >= day);
  if (idx <= 0) return null;
  return react(bars, idx);
}

function react(bars: Bar[], idx: number) {
  const vol20 = bars.slice(Math.max(0, idx - 20), idx).reduce((s, b) => s + b.volume, 0) / Math.min(20, idx);
  return { ret: bars[idx].close / bars[idx - 1].close - 1, gap: bars[idx].open / bars[idx - 1].close - 1, volRatio: vol20 > 0 ? bars[idx].volume / vol20 : null, date: new Date(bars[idx].time * 1000).toISOString().slice(0, 10) };
}

export function FilingRow({ f, symbol, bars }: { f: Filing & { symbol?: string }; symbol?: string; bars?: Bar[] }) {
  const r = bars ? filingReaction(f, bars) : null;
  return (
    <div className={`filing-row imp-${f.importance}`}>
      <div className="filing-meta">
        <span className={`cat cat-${f.category.replace('&', '')}`}>{CATEGORY_LABEL[f.category] ?? f.category}</span>
        <b>{symbol ?? f.symbol ?? ''} {f.form}</b>
        <small>{fmtEt(f.acceptedAt ?? f.filingDate)}</small>
      </div>
      <div className="filing-body">
        <strong>{f.label}</strong>
        {f.items && <small>8-K Items: {f.items}</small>}
      </div>
      <div className="filing-reaction">
        {r ? <><span className={r.ret >= 0 ? 'up' : 'down'}>{fmtPct(r.ret)}</span><small>{r.date} · 거래량 {r.volRatio ? `${r.volRatio.toFixed(1)}x` : '—'}</small></> : <small className="muted">{bars ? '반응 미측정' : ''}</small>}
      </div>
      <div className="filing-link">
        <span className={`severity ${f.importance}`}>{f.importance.toUpperCase()}</span>
        {f.url ? <a href={f.url} target="_blank" rel="noreferrer" aria-label="SEC 원문"><ExternalLink size={13} /></a> : <span className="muted">SIM</span>}
      </div>
    </div>
  );
}
