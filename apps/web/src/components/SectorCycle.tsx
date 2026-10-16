import { PHASE_KO } from '../../../../packages/analysis/cycle.mjs';
import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTerminal } from '../lib/store';
import { fetchSectors, NoSnapshotError, type CyclePhase, type Sectors } from '../lib/snapshot';
import { STAGE_KO, TYPE_KO } from '../lib/storyPicks';
import { fmtEt, fmtPct, fmtPrice, signClass } from '../lib/format';
import { Loading, PanelHead } from './ui';

const PHASE_LABEL: Record<CyclePhase,string> = PHASE_KO;
const PHASE_CLS: Record<CyclePhase, string> = { EARLY: 'up', BASING: 'neutral', LEADING: 'up', NEUTRAL: '', LATE: 'neutral', DOWN: 'down' };
const PHASE_TIP: Record<CyclePhase, string> = {
  EARLY: '큰 반등·이격을 제외하고 200일선 위 전환이 5~63거래일 지속된 가격 조건. 산업 경기의 초입 확정은 아님',
  BASING: '고점에서 20% 이상 내려와 200일선 근처에서 옆으로 기는 업종. 2년간 시장보다 크게 오른 업종(조정 중)은 제외 — 다음 사이클 후보',
  LEADING: '이미 상승 추세가 자리 잡고 시장보다 강한 업종',
  LATE: '200일선보다 30% 이상 위거나 과열 — 추격 주의',
  NEUTRAL: '가격 방향을 확인하지 못한 상태. 안정적인 숨고르기나 산업 회복으로 해석하지 않음',
  DOWN: '200일선 아래에서 가격 방향·상대강도가 약한 업종. 재하락 위험',
};

export function SectorCycle({ compact = false }: { compact?: boolean }) {
  const { select, setPage } = useTerminal();
  const [data, setData] = useState<Sectors | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'error' | 'ok'>('loading');
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<CyclePhase | 'all'>('all');
  useEffect(() => { fetchSectors().then((d) => { setData(d); setState('ok'); }).catch((e) => setState(e instanceof NoSnapshotError ? 'missing' : 'error')); }, []);

  const groups = (data?.groups ?? []).filter((g) => (compact ? g.phase === 'EARLY' || g.phase === 'BASING' : filter === 'all' || g.phase === filter)).slice(0, compact ? 6 : 99);
  const count = (p: CyclePhase) => data?.groups.filter((g) => g.phase === p).length ?? 0;

  return (
    <section className="panel">
      <PanelHead kicker="SECTOR CYCLE · NIGHTLY" title={compact ? '가격 전환을 관찰하는 섹터' : 'ETF 가격 국면 · 산업 경기와 별개'} right={data && <span className="live-badge">기준일 {data.asOf}</span>} />
      {!compact && <p className="pad-box muted small">업종·테마 ETF {data?.groups.length ?? ''}개의 차트로 사이클 국면을 판정하고, 가격 연동 차트 후보를 주가 움직임이 가장 닮은 업종에 묶었습니다. 사업 연결과 투자 근거는 위 산업 스토리에서 별도로 확인합니다. <b>가격 전환 초기</b>는 큰 반등·이격을 제외하고 전환 지속성을 확인한 차트 조건입니다. 수주·재고·가동률로 산업 회복을 확인한 판정은 아닙니다.</p>}
      {state === 'loading' && <Loading label="섹터 불러오기" />}
      {state === 'missing' && <div className="pad-box muted">아직 야간 수집 결과가 없습니다 (다음 수집 후 표시).</div>}
      {state === 'error' && <div className="pad-box muted">섹터 데이터를 불러오지 못했습니다.</div>}
      {state === 'ok' && !compact && (
        <div className="event-filter">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>전체</button>
          {(['EARLY', 'BASING', 'LEADING', 'NEUTRAL', 'LATE', 'DOWN'] as CyclePhase[]).map((p) => <button key={p} className={filter === p ? 'active' : ''} onClick={() => setFilter(p)} title={PHASE_TIP[p]}>{PHASE_LABEL[p]} ({count(p)})</button>)}
        </div>
      )}
      {state === 'ok' && compact && !groups.length && (
        <p className="pad-box muted">오늘은 '가격 전환 초기'나 '바닥 다지기' 국면인 업종이 없습니다. 업종 ETF {data?.groups.length ?? 0}개 중 주도 {count('LEADING')} · 과열 {count('LATE')} · 중립 {count('NEUTRAL')} · 하락 {count('DOWN')}개입니다. 기준을 낮춰 억지로 채우지 않으며, 업종 전체 국면은 탐색 화면의 섹터 표에서 볼 수 있습니다.</p>
      )}
      {state === 'ok' && !(compact && !groups.length) && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th /><th>업종 (ETF)</th><th>국면</th><th>3개월</th><th>12개월</th><th>2년</th><th>200일선 대비</th><th>2년 고점 대비</th><th>시장 대비 3M</th><th>가격 연동 차트 후보</th></tr></thead>
            <tbody>
              {groups.map((g) => {
                const m = g.metrics;
                const isOpen = open === g.etf;
                return (
                  <Fragment key={g.etf}>
                    <tr className="clickable" onClick={() => setOpen(isOpen ? null : g.etf)}>
                      <td>{g.members.length ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}</td>
                      <td><b>{g.name}</b><small>{g.etf} · ${fmtPrice(g.price)}</small></td>
                      <td><span className={`sent ${PHASE_CLS[g.phase]}`} title={PHASE_TIP[g.phase]}>{g.phaseKo}</span></td>
                      <td className={signClass(m.ret3m)}>{fmtPct(m.ret3m)}</td>
                      <td className={signClass(m.ret12m)}>{fmtPct(m.ret12m)}</td>
                      <td className={signClass(m.ret24m ?? null)}>{fmtPct(m.ret24m ?? null)}</td>
                      <td className={signClass(m.vs200)}>{fmtPct(m.vs200)}</td>
                      <td className="down">{m.ddFromHigh != null ? `-${(m.ddFromHigh * 100).toFixed(0)}%` : '—'}</td>
                      <td className={signClass(m.rs3m)}>{fmtPct(m.rs3m)}</td>
                      <td className="muted">{g.members.length ? g.members.slice(0, 4).map((x) => x.symbol).join(', ') + (g.members.length > 4 ? ' …' : '') : '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="detail-row"><td /><td colSpan={9}>
                        <ul className="sector-members">
                          {g.members.map((x) => (
                            <li key={x.symbol}>
                              <button className="text-link inline" onClick={() => { select(x.symbol); setPage('charts'); }}><b>{x.symbol}</b></button>
                              <span className="muted"> {x.name ?? ''} · ${fmtPrice(x.price)} · {TYPE_KO[x.type as keyof typeof TYPE_KO] ?? x.type} {STAGE_KO[x.stage] ?? x.stage} · 업종 연동 {Math.round(x.corr * 100)}%</span>
                              {x.how && <div className="small">매수타점: {x.how}</div>}
                              {g.warnings?.map(w=><div className="small muted" key={w}>{w}</div>)}
                              {x.takeaway && <div className="small muted">→ {x.takeaway}</div>}
                            </li>
                          ))}
                        </ul>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
              {!groups.length && <tr><td colSpan={10} className="muted">해당 국면의 업종이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {data && <p className="footnote pad">{data.method} {data.caveat} 생성 {fmtEt(data.generatedAt)}</p>}
    </section>
  );
}
