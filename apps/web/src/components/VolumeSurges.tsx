import { useEffect, useMemo, useState } from 'react';
import { LineChart } from 'lucide-react';
import { useTerminal } from '../lib/store';
import { fetchVolumeSurges, NoSnapshotError, SECTOR_KO, type VolumeSurges as Data } from '../lib/snapshot';
import { fmtPct, fmtPrice } from '../lib/format';
import { Loading, PanelHead } from './ui';

const CONF_KO = { none: '이유 미확인', headline_only: '기사 제목 기준', filing_and_headline: '공시·기사 기준' } as const;
const usd = (v: number | null) => (v == null ? '—' : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);

export function VolumeSurges() {
  const { select, setPage } = useTerminal();
  const [data, setData] = useState<Data | null>(null), [state, setState] = useState('loading'), [cause, setCause] = useState('all');
  useEffect(() => { fetchVolumeSurges().then((d) => { setData(d); setState('ok'); }).catch((e) => setState(e instanceof NoSnapshotError ? 'missing' : 'error')); }, []);
  const causes = useMemo(() => [...new Set((data?.items ?? []).map((x) => x.causeKo))], [data]);
  const rows = (data?.items ?? []).filter((x) => cause === 'all' || x.causeKo === cause);
  return <section className="panel story-picks">
    <PanelHead kicker="VOLUME SURGE · WHY" title="거래량 급증 종목 · 이유와 해석" right={data && <span className="live-badge">기준일 {data.asOf}</span>} />
    <p className="pad-box muted small">{data?.method ?? '최근 3거래일 안에 거래량이 평소의 3배 이상 터진 종목입니다.'} <b>거래량은 무언가 바뀌었다는 신호일 뿐 오를지 내릴지를 알려주지 않습니다.</b></p>
    {state === 'loading' && <Loading label="거래량 급증 확인" />}
    {state === 'missing' && <p className="pad-box muted">아직 거래량 급증 자료가 없습니다. 다음 야간 분석부터 표시됩니다.</p>}
    {state === 'error' && <p className="pad-box muted">자료를 불러오지 못했습니다. 이전 목록을 최신으로 표시하지 않습니다.</p>}
    {data && <>
      <div className="event-filter"><button className={cause === 'all' ? 'active' : ''} aria-pressed={cause === 'all'} onClick={() => setCause('all')}>전체 {data.items.length}</button>{causes.map((c) => <button key={c} className={cause === c ? 'active' : ''} aria-pressed={cause === c} onClick={() => setCause(c)}>{c} {data.items.filter((x) => x.causeKo === c).length}</button>)}</div>
      {!rows.length && <p className="pad-box muted">해당 조건의 급증 종목이 없습니다.</p>}
      <div className="pick-grid">{rows.map((x) => <details className="pick-card discovery-card" key={x.symbol}>
        <summary>
          <div className="pick-top"><b>{x.symbol}</b><span className="muted small">{x.name} · {SECTOR_KO[x.sector] ?? x.sector}</span></div>
          <div className="pick-hook">거래량 {x.volMult}배 · {fmtPct(x.ret1)} · ${fmtPrice(x.close)} · {x.date}{x.sessionsAgo ? ` (${x.sessionsAgo}거래일 전)` : ''}</div>
          <p className="pick-take"><b className={['financing', 'legal'].includes(x.cause) ? 'down' : ''}>{x.causeKo}</b> · {CONF_KO[x.confidence]} · {x.contextKo}</p>
        </summary>
        <div className="discovery-reading">
          <h3>무슨 일이 있었나</h3>
          {x.headlines.length ? x.headlines.map((h) => <p key={h.headline} className={h.roundup ? 'muted small' : undefined}>{h.date} · {h.roundup ? '(여러 종목 모음 기사 — 이유 아님) ' : ''}{h.headline}{h.url && <> <a href={h.url} target="_blank" rel="noreferrer">기사 ↗</a></>}</p>) : <p>{x.newsChecked ? '급증일 전후 3일 안에 수집된 기사가 없습니다.' : '이 종목은 이번 실행에서 뉴스를 수집하지 못했습니다 — 이유가 없다는 뜻이 아닙니다.'}</p>}
          {x.filings.map((f) => <p key={`${f.form}${f.date}`}>{f.date} · 공시 {f.form}{f.label ? ` (${f.label})` : ''}{f.url && <> <a href={f.url} target="_blank" rel="noreferrer">원문 ↗</a></>}</p>)}
          <h3>이 이유가 주가에 닿는 경로</h3><p>{x.read}</p>
          <h3>가격과 거래량이 말하는 것</h3>
          <p>{x.tone}</p>
          <p className="muted small">당일 {fmtPct(x.ret1)} (시가 갭 {fmtPct(x.gap)}), 당일 범위의 {Math.round(x.closePos * 100)}% 위치에서 마감. 3개월 {x.ret63 == null ? '—' : fmtPct(x.ret63)}, 1년 고점 대비 {fmtPct(x.fromHigh)}, 저점 대비 {fmtPct(x.fromLow)}.{x.sessionsAgo ? ` 급증 이후 ${fmtPct(x.after)}.` : ''} 거래대금 {usd(x.dollarVolume)} · 시총 {usd(x.mcap)}.</p>
          <p className="market-note">{data.caveat}</p>
          <div className="pick-actions"><button className="secondary-button" onClick={() => { select(x.symbol); setPage('charts'); }}><LineChart size={12} />차트 확인</button></div>
          <button className="ea-button" onClick={(e) => { const d = e.currentTarget.closest('details.discovery-card'); if (d instanceof HTMLDetailsElement) { d.open = false; d.querySelector('summary')?.focus(); d.scrollIntoView({ block: 'start', behavior: 'auto' }); } }}>다 읽었어요 · 카드 접기</button>
        </div>
      </details>)}</div>
      <p className="pad-box muted small">급증 감지 {data.stats.detected}개 중 거래량 배수·거래대금 상위 {data.stats.shown}개 표시 · 생성 {data.generatedAt.slice(0, 16).replace('T', ' ')} UTC</p>
    </>}
  </section>;
}
