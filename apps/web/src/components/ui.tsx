import type { ReactNode } from 'react';
import type { Factors, Num } from '../lib/types';
import { fmtAgo, fmtEt } from '../lib/format';
import { useTerminal } from '../lib/store';

export function SourceBadge({ name, fetchedAt, url, note }: { name: string; fetchedAt?: string | null; url?: string; note?: string }) {
  const sim = name === 'SIMULATED';
  return (
    <span className={`source-badge ${sim ? 'sim' : 'live'}`} title={fetchedAt ? `갱신 ${fmtEt(fetchedAt)}` : undefined}>
      <span className="dot" />
      {url ? <a href={url} target="_blank" rel="noreferrer">{name}</a> : name}
      {fetchedAt && <span className="muted"> · {fmtAgo(fetchedAt)}</span>}
      {note && <span className="muted"> · {note}</span>}
    </span>
  );
}

export function ScoreRing({ score, size = 75 }: { score: Num; size?: number }) {
  const v = score ?? 0;
  return (
    <div className="score-ring" style={{ ['--score' as string]: `${v}%`, width: size, height: size }}>
      <strong>{score ?? '—'}</strong>
      <span>/100</span>
    </div>
  );
}

const FACTOR_LABELS: Array<[keyof Factors, string]> = [
  ['momentum', '모멘텀'], ['trend', '추세'], ['quality', '재무 품질'], ['valuation', '밸류에이션'], ['liquidity', '유동성'], ['stability', '안정성 (100-위험)'],
];

export function FactorBars({ factors }: { factors: Factors }) {
  return (
    <div className="factor-list">
      {FACTOR_LABELS.map(([k, label]) => {
        const v = factors[k];
        return (
          <div className="factor" key={k}>
            <div className="factor-label"><span>{label}</span><strong>{v === null ? 'N/A' : Math.round(v)}</strong></div>
            <div className={`factor-track ${v === null ? 'na' : ''}`}><div style={{ width: `${v ?? 0}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

export function Loading({ label = '불러오는 중' }: { label?: string }) {
  return <div className="loading"><span className="spinner" />{label}…</div>;
}

export function ErrorBox({ error, hint }: { error: string; hint?: ReactNode }) {
  return <div className="error-box">⚠ {error}{hint && <div className="muted">{hint}</div>}</div>;
}

export function PanelHead({ kicker, title, right }: { kicker: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="panel-head">
      <div><span className="panel-kicker">{kicker}</span><h2>{title} <span className="tiny-star">✳</span></h2></div>
      {right}
    </div>
  );
}

export function ModeBadge() {
  const { mode } = useTerminal();
  return mode === 'live' ? <span className="live-badge">LIVE DATA</span> : <span className="demo-badge">SIMULATED</span>;
}
