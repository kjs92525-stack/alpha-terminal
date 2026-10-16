import { useEffect, useState } from 'react';
import { useTerminal } from '../lib/store';
import { fetchNextCycle, NoSnapshotError, type NextCycle as NC, type NextCycleSector } from '../lib/snapshot';
import { fmtPct, fmtPrice, signClass } from '../lib/format';
import { Loading, PanelHead } from './ui';

const STATUS = { candidate: ['다음 사이클 후보', 'up'], watch: ['관찰', 'neutral'], priced: ['이미 진행 중', ''], none: ['근거 약함', ''], insufficient: ['자료 부족', ''] } as const;
const share = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const usdM = (v: number | null) => (v == null ? '—' : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6)}M`);

function SectorCard({ x }: { x: NextCycleSector }) {
  const { select, setPage } = useTerminal();
  const open = (s: string) => { select(s); setPage('charts'); };
  return <div className="pad-box" style={{ borderTop: '1px solid var(--line, #2a2f3a)' }}>
    <h4 style={{ margin: '4px 0' }}>{x.ko} <span className="muted">({x.etf})</span> · <span className={STATUS[x.status][1]}>{STATUS[x.status][0]}</span> <span className="muted small">· 근거 {x.pts}점 · ETF 국면 {x.phaseKo ?? '—'}</span></h4>
    <div className="small"><b>근거</b><ul className="thesis-list">{x.why.map((w, i) => <li key={i} className="up">{w}</li>)}</ul></div>
    {!!x.risks.length && <div className="small"><b>반론·위험</b><ul className="thesis-list">{x.risks.map((w, i) => <li key={i} className="down">{w}</li>)}</ul></div>}
    <p className="small"><b>시황 연결</b> — {x.macro}</p>
    {!!x.themes.length && <p className="small"><b>관련 테마 ETF</b> — {x.themes.map((t) => <span key={t.etf} style={{ marginRight: 10 }}>{t.etf} {t.name} · {t.phaseKo} · 3개월 시장 대비 <span className={signClass(t.rs3m)}>{fmtPct(t.rs3m)}</span></span>)}</p>}
    {x.stocks.length ? <div className="table-wrap"><table className="data-table">
      <thead><tr><th>관련 종목 (매출 가속 공시)</th><th>공시일</th><th>매출 YoY</th><th>이익</th><th>52주 위치</th><th>3개월</th><th>시총</th><th>증자</th></tr></thead>
      <tbody>{x.stocks.map((s) => <tr key={s.symbol} className="clickable" onClick={() => open(s.symbol)}>
        <td><b>{s.symbol}</b><small>{s.name} · ${fmtPrice(s.price)}</small></td><td>{s.filed}</td>
        <td>{fmtPct(s.prevYoY, 0)} → <b className="up">{fmtPct(s.revYoY, 0)}</b></td><td>{s.niImproved ? <span className="up">개선</span> : <span className="muted">—</span>}</td>
        <td>{s.posIn52w == null ? '—' : `${Math.round(s.posIn52w * 100)}%`}</td><td className={signClass(s.ret63)}>{fmtPct(s.ret63)}</td><td>{usdM(s.mcap)}</td>
        <td>{s.dilution ? <span className="down">⚠ {s.dilution}</span> : s.dilutionChecked ? '없음' : <span className="muted">미확인</span>}</td>
      </tr>)}</tbody></table></div> : <p className="small muted">최근 120일 안에 매출 가속을 공시한 유동성 있는 종목이 없습니다.</p>}
    <p className="small muted"><b>확인할 것</b> — {x.check.join(' · ')}</p>
  </div>;
}

export function NextCycle() {
  const [data, setData] = useState<NC | null>(null), [state, setState] = useState('loading');
  useEffect(() => { fetchNextCycle().then((d) => { setData(d); setState('ok'); }).catch((e) => setState(e instanceof NoSnapshotError ? 'missing' : 'error')); }, []);
  const cand = data?.sectors.filter((x) => x.status === 'candidate') ?? [], watch = data?.sectors.filter((x) => x.status === 'watch') ?? [];
  const show = cand.length ? cand.slice(0, 3) : watch.slice(0, 3);
  const m = data?.market, mac = m?.macro;
  const matured = data?.track.filter((t) => t.d60) ?? [];
  return <section className="panel">
    <PanelHead kicker="NEXT CYCLE · NIGHTLY" title="다음 사이클 후보 업종 · 근거·시황·관련 종목" right={data && <span className="live-badge">기준일 {data.asOf}</span>} />
    {state === 'loading' && <Loading label="업종 분석 불러오기" />}
    {state === 'missing' && <p className="pad-box muted">아직 야간 분석 결과가 없습니다 (다음 수집 후 표시).</p>}
    {state === 'error' && <p className="pad-box muted">업종 분석을 불러오지 못했습니다.</p>}
    {data && <>
      <p className="pad-box small">사업이 먼저 돌아서고 가격은 아직 덜 반영한 업종을 찾습니다. <b>사업</b>: 최근 공시 분기에 매출이 가속한 기업 비중이 3개월 전보다 다른 업종보다 빠르게 늘었는지(과거 검증에서 시장을 이긴 매출 가속 정의). <b>가격</b>: 업종 ETF가 2년간 시장보다 덜 올랐는지, 최근 안정되는지. 이미 1~2년 크게 오른 업종은 '이미 진행 중'으로 따로 둡니다.</p>
      {m && <p className="pad-box small"><b>오늘 시황</b> — 시장 판정 <span className={m.state === 'WAIT' ? 'down' : m.state === 'SELECTIVE' ? 'up' : ''}>{m.label ?? m.state}</span>{m.reasons.length ? ` (${m.reasons.join(' · ')})` : ''}{mac ? ` · ${mac.period} CPI 전년 대비 ${mac.headlineAnnual.toFixed(1)}% (근원 ${mac.coreAnnual.toFixed(1)}%), 전월 대비 ${mac.headlineMonthly.toFixed(1)}%` : ''}{m.vix != null ? ` · VIX ${m.vix.toFixed(1)}` : ''}</p>}
      {!cand.length && <p className="pad-box small ea-risk">오늘은 '다음 사이클 후보' 기준(사업 개선 2점 이상 + 합계 4점 이상)을 넘는 업종이 없습니다. 아래는 사업 개선 신호가 있는 관찰 업종입니다. 기준을 낮춰 채우지 않습니다.</p>}
      {show.map((x) => <SectorCard key={x.etf} x={x} />)}
      <details className="pad-box small"><summary>11개 업종 전체 판정</summary>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>업종</th><th>판정</th><th>점수</th><th>매출 가속 비중 (3개월 전 → 지금)</th><th>2년 시장 대비</th><th>고점 대비</th><th>3개월 시장 대비</th><th>ETF 국면</th></tr></thead>
          <tbody>{data.sectors.map((x) => <tr key={x.etf}><td>{x.ko} <small>{x.etf}</small></td><td className={STATUS[x.status][1]}>{STATUS[x.status][0]}</td><td>{x.pts}</td>
            <td>{share(x.breadth?.prevShare)} → {share(x.breadth?.share)} <small className="muted">({x.breadth?.n ?? 0}곳)</small></td>
            <td className={signClass(x.metrics.rs24m)}>{fmtPct(x.metrics.rs24m)}</td><td>{x.metrics.ddFromHigh != null ? `-${Math.round(x.metrics.ddFromHigh * 100)}%` : '—'}</td>
            <td className={signClass(x.metrics.rs3m)}>{fmtPct(x.metrics.rs3m)}</td><td>{x.phaseKo ?? '—'}</td></tr>)}</tbody></table></div>
        {data.sectors.filter((x) => x.status === 'priced').map((x) => <p key={x.etf} className="muted">{x.ko}({x.etf}): {x.risks.find((r) => r.startsWith('이미')) ?? ''}</p>)}
      </details>
      <p className="pad-box small muted">전향 기록: 후보 {data.track.length}건{matured.length ? ` · 60일 지난 ${matured.length}건 평균 SPY 대비 ${fmtPct(matured.reduce((a, t) => a + (t.d60?.vsSpy ?? 0), 0) / matured.length)}` : ' · 아직 60거래일 지난 기록 없음'}. {data.method} {data.caveat}</p>
    </>}
  </section>;
}
