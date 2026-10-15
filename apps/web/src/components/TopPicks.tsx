import { useEffect, useState } from 'react';
import { useTerminal } from '../lib/store';
import { fetchSetups, NoSnapshotError, type Setups } from '../lib/snapshot';
import { topConviction, type Gate } from '../lib/conviction';
import { briefingFreshness } from '../../../../packages/analysis/market-brief.mjs';
import { useMarketBrief } from '../lib/marketBrief';
import { fmtPrice } from '../lib/format';
import { PanelHead } from './ui';

const TIER = { A: ['A · 진입 검토', 'up'], B: ['B · 소액·조건부', 'neutral'], C: ['C · 관찰', ''] } as const;
const MODE = { early: '상승 초입', pivot: '자산 전환', watch: '바닥 관찰' } as const;
const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

export function TopPicks() {
  const { select, setPage } = useTerminal();
  const [data, setData] = useState<Setups | null>(null), [state, setState] = useState('loading');
  const mb = useMarketBrief();
  useEffect(() => { fetchSetups().then((d) => { setData(d); setState('ok'); }).catch((e) => setState(e instanceof NoSnapshotError ? 'missing' : 'error')); }, []);
  const gate = (mb.error || !briefingFreshness(mb.data, mb.now).fresh ? 'UNKNOWN' : mb.data!.decision.state) as Gate;
  const picks = topConviction(data, gate, 5);
  const riskUsd = Number(read('alpha:acct', '10000')) * Number(read('alpha:riskpct', '1')) / 100;
  return <section className="panel story-picks">
    <PanelHead kicker="TODAY'S SHORTLIST" title="오늘 볼 종목 · 확신도" right={data && <span className="live-badge">기준일 {data.asOf}</span>} />
    <p className="pad-box muted small">상승 초입·자산 전환·바닥 관찰 규칙을 통과한 종목만, 근거 점수로 정렬합니다. 과거 공시 검증에서 초과수익이 난 것은 매출 가속이었고(이익 개선만은 없음), A는 매출 가속이 있어야 받습니다. A도 매수 확정이 아니며, 시장이 대기·미확인이면 모두 C(관찰)로 낮춥니다. 점수 근거는 각 줄에 그대로 적습니다.</p>
    {state === 'loading' && <p className="pad-box muted">확인 중…</p>}
    {state !== 'loading' && !picks.length && <p className="pad-box muted">오늘은 규칙을 통과한 종목이 없습니다. 기준을 낮춰 채우지 않습니다.</p>}
    <ol className="thesis-list pad-box">{picks.map((c) => {
      const p = c.row.plan, shares = p && riskUsd > 0 && p.entry > p.stop ? Math.floor(riskUsd / (p.entry - p.stop)) : null;
      return <li key={c.row.symbol} style={{ marginBottom: 10 }}>
        <b className={TIER[c.tier][1]}>{TIER[c.tier][0]}</b> <button className="text-link inline" onClick={() => { select(c.row.symbol); setPage('charts'); }}>{c.row.symbol}</button> <span className="muted">{c.row.name} · {MODE[c.mode]} · {c.points}점</span>
        {p && <div className="small">진입 ${fmtPrice(p.entry)} · 무효화 ${fmtPrice(p.stop)} · 목표 ${fmtPrice(p.target)}{shares != null ? ` · 1R 기준 ${shares.toLocaleString()}주` : ''}{c.row.earnings ? ` · 실적 ${c.row.earnings.date}` : ''}</div>}
        <div className="small">{c.plus.length ? <span className="up">+ {c.plus.join(' · ')}</span> : null}{c.minus.length ? <span className="down"> − {c.minus.join(' · ')}</span> : null}</div>
        {c.capped && <div className="small ea-risk">{c.capped}</div>}
      </li>;
    })}</ol>
  </section>;
}
