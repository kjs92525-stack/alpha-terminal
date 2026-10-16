import { useEffect, useState } from 'react';
import { useTerminal } from '../lib/store';
import { fetchPaper, NoSnapshotError, type PaperLedger } from '../lib/snapshot';
import { portfolioRisk, LIMITS } from '../lib/portfolio';
import { fmtPct } from '../lib/format';
import { Loading, PanelHead } from './ui';

const KIND = { order: ['주문 대기', ''], filled: ['체결', 'up'], breakeven: ['손절가 상향', 'up'], partial: ['절반 익절', 'up'], exit: ['청산', 'down'], invalidated: ['주문 취소', 'down'], earnings: ['실적 발표 임박', 'down'], drop: ['탈락 조건', 'down'], note: ['확인', ''] } as const;
const STATUS = { pending: '주문 대기', open: '보유 중', closed: '청산', expired: '미체결 만료', invalidated: '진입 전 무효화', invalid: '계획 오류' } as const;
const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

export function TodayActions() {
  const { select, setPage } = useTerminal();
  const [data, setData] = useState<PaperLedger | null>(null), [state, setState] = useState('loading');
  // per-viewer convenience only: account size and risk per trade for share counts
  const [acct, setAcct] = useState(() => read('alpha:acct', '10000')), [riskPct, setRiskPct] = useState(() => read('alpha:riskpct', '1'));
  useEffect(() => { fetchPaper().then((d) => { setData(d); setState('ok'); }).catch((e) => setState(e instanceof NoSnapshotError ? 'missing' : 'error')); }, []);
  useEffect(() => { try { localStorage.setItem('alpha:acct', acct); localStorage.setItem('alpha:riskpct', riskPct); } catch { /* private mode */ } }, [acct, riskPct]);
  const riskUsd = Number(acct) * Number(riskPct) / 100;
  const shares = (entry: number, stop: number) => (riskUsd > 0 && entry > stop ? Math.floor(riskUsd / (entry - stop)) : null);
  const s = data?.summary;
  const book = data ? portfolioRisk(data.trades, Number(acct), riskUsd) : null;
  const rp = Number(riskPct);
  const open = (sym: string) => { select(sym); setPage('charts'); };
  return <section className="panel story-picks">
    <PanelHead kicker="TODAY · PAPER LEDGER" title="오늘 할 일 · 모의 매매 성과" right={data && <span className="live-badge">기준일 {data.asOf}</span>} />
    {state === 'loading' && <Loading label="모의 매매 기록 확인" />}
    {state === 'missing' && <p className="pad-box muted">모의 매매 기록이 아직 없습니다. 상승 초입·자산 전환형 목록에 종목이 오르면 다음 야간 분석부터 기록됩니다.</p>}
    {state === 'error' && <p className="pad-box muted">기록을 불러오지 못했습니다.</p>}
    {data && s && <>
      <div className="pad-box">
        <p className={s.enough ? '' : 'ea-risk'}>{s.enough ? '' : `마감 거래 ${s.closed}건 — 30건 미만이라 아직 성과를 판단할 수 없습니다. `}신호 {s.signals} · 체결 {s.filled} (보유 {s.open}) · 대기 {s.pending} · 미체결·취소 {s.expiredOrInvalidated}</p>
        {s.closed > 0 && <p>마감 {s.closed}건: 승률 {fmtPct(s.winRate ?? 0, 0).replace('+', '')} · 평균 {s.avgR?.toFixed(2)}R (합계 {s.totalR.toFixed(1)}R) · 평균 수익 {fmtPct(s.avgReturn ?? 0)} · 같은 기간 SPY 대비 {s.avgVsSpy == null ? '—' : fmtPct(s.avgVsSpy)}</p>}
        <p className="muted small">보유 중 평가 {s.openR.toFixed(1)}R · {data.method}</p>
      </div>
      <div className="pad-box small">계좌 $<input inputMode="numeric" value={acct} onChange={(e) => setAcct(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 90 }} aria-label="계좌 금액" /> · 거래당 위험 <input inputMode="decimal" value={riskPct} onChange={(e) => setRiskPct(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 40 }} aria-label="거래당 위험 퍼센트" />% = 1R ${riskUsd ? riskUsd.toFixed(0) : '—'} <span className="muted">(이 기기에만 저장)</span>{(rp < LIMITS.riskPctMin || rp > LIMITS.riskPctMax) && <span className="ea-risk"> · 권장 0.5~1%</span>}</div>
      {book && <div className="pad-box small">
        <span className={book.openR + book.pendingR > LIMITS.maxOpenR ? 'ea-risk' : ''}>보유 위험 {book.openR.toFixed(1)}R + 대기 주문 {book.pendingR.toFixed(0)}R / 한도 {LIMITS.maxOpenR}R (계좌의 약 {(LIMITS.maxOpenR * rp).toFixed(1)}%)</span>
        {!!book.sectors.length && <> · 업종 비중 {book.sectors.slice(0, 4).map((x) => <span key={x.sector} className={x.pct > LIMITS.sectorPct ? 'ea-risk' : ''}>{x.sector} {(x.pct * 100).toFixed(0)}% </span>)}<span className="muted">(업종당 25% 한도)</span></>}
      </div>}
      <h3 className="pad-box" style={{ margin: 0 }}>오늘 할 일</h3>
      {!data.actions.length && <p className="pad-box muted">오늘 처리할 주문·체결·청산이 없습니다.</p>}
      <ul className="thesis-list pad-box">{data.actions.map((a, i) => {
        const t = data.trades.find((x) => x.symbol === a.symbol && ['pending', 'open'].includes(x.result.status));
        const n = t && a.kind === 'order' ? shares(t.entry, t.stop) : null;
        return <li key={i}><b className={KIND[a.kind as keyof typeof KIND]?.[1] ?? ''}>{KIND[a.kind as keyof typeof KIND]?.[0] ?? a.kind}</b> <button className="text-link inline" onClick={() => open(a.symbol)}>{a.symbol}</button> — {a.text}{n != null && <span className="muted"> · 1R 기준 {n.toLocaleString()}주 (약 ${(n * t!.entry).toFixed(0)}{Number(acct) > 0 && n * t!.entry > Number(acct) * 0.25 ? ' — 계좌의 25% 초과, 비중 축소' : ''})</span>}{a.kind === 'order' && !!book?.orders[a.symbol]?.length && <span className="ea-risk"> · 한도 초과로 건너뛰기: {book.orders[a.symbol].join(' · ')}</span>}</li>;
      })}</ul>
      <details className="pad-box small"><summary>최근 기록 {Math.min(data.trades.length, 30)}건</summary>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>종목</th><th>신호일</th><th>유형</th><th>상태</th><th>체결</th><th>결과</th><th>SPY 대비</th></tr></thead>
          <tbody>{data.trades.slice(0, 30).map((t) => <tr key={t.id}><td><button className="text-link inline" onClick={() => open(t.symbol)}>{t.symbol}</button></td><td>{t.signalDate}</td><td>{t.mode === 'pivot' ? '자산 전환' : '상승 초입'}</td><td>{STATUS[t.result.status]}{t.result.exitReason ? ` · ${t.result.exitReason}` : ''}</td><td>{t.result.fill != null ? `$${t.result.fill.toFixed(2)}` : '—'}</td><td className={(t.result.rMultiple ?? 0) >= 0 ? 'up' : 'down'}>{t.result.rMultiple != null ? `${t.result.rMultiple.toFixed(2)}R (${fmtPct(t.result.ret ?? 0)})` : '—'}</td><td>{t.result.vsSpy != null ? fmtPct(t.result.vsSpy) : '—'}</td></tr>)}</tbody></table></div>
      </details>
      {data.filingEvents && <FilingForwardBox f={data.filingEvents} />}
      <p className="pad-box muted small">{data.caveat}</p>
    </>}
  </section>;
}

const FWD: Array<[string, string]> = [['eventAll', '전체 공시'], ['eventBoth', '매출 가속 + 이익 개선'], ['eventRevAccel', '매출 가속'], ['eventNiImproved', '이익 개선'], ['eventNotImproving', '개선 없음'], ['eventImprovingNearLow', '개선 + 52주 바닥권']];
function FilingForwardBox({ f }: { f: NonNullable<PaperLedger['filingEvents']> }) {
  const g = f.groups ?? {};
  return <details className="pad-box small" open>
    <summary>공시 이벤트 전향 검증 — 기록 {f.recorded.toLocaleString()}건{f.since ? ` (${f.since}부터)` : ''} · 오늘 신규 {f.newToday}</summary>
    <p className="muted">과거 검증(2024~2026)에서 매출 가속 공시는 120일 SPY 대비 +3.1%p였습니다. 같은 기준이 앞으로도 맞는지 여기서 확인합니다. 120일이 지나기 전 숫자는 판단 근거가 아닙니다.</p>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>공시 내용</th><th>20일 n</th><th>20일 SPY 대비</th><th>60일 n</th><th>60일 SPY 대비</th><th>120일 n</th><th>120일 SPY 대비</th></tr></thead>
      <tbody>{FWD.map(([k, label]) => { const h = g[k] ?? {}; return <tr key={k}><td>{label}</td>{(['20d', '60d', '120d'] as const).flatMap((d) => [<td key={d + 'n'}>{h[d]?.n ?? 0}</td>, <td key={d} className={(h[d]?.avgExcessVsSpy ?? 0) >= 0 ? 'up' : 'down'}>{h[d]?.n ? fmtPct(h[d]!.avgExcessVsSpy ?? 0) : '—'}</td>])}</tr>; })}</tbody></table></div>
    <p className="muted">{f.method}</p>
  </details>;
}
