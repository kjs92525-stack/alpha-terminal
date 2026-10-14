import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { fetchEarlyAlpha, type EarlyData, type EarlyRow } from '../lib/earlyAlpha';
import { useTerminal } from '../lib/store';
const pct = (v: number | null) => v === null ? '미확인' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const usd = (v: number | null) => v === null ? '미확인' : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(1)}M`;
const labels: Record<string, string> = { growth: '매출 가속', profitability: '수익성', catalyst: '촉매', neglect: '가격 소외', value: '매출 대비 가치', base: '바닥 구조', penalty: '위험 감점' };
const statusLabel = { candidate: '재평가 후보', watch: '관찰·검증 대기', excluded: '제외' };
function Evidence({ row }: { row: EarlyRow }) {
  const { select, setPage } = useTerminal();
  return <section className="ea-detail">
    <div className="ea-detail-heading"><div><small>REVALUATION DOSSIER</small><h2>{row.ticker} <span>{row.name}</span></h2></div><button className="ea-button" onClick={() => { select(row.ticker); setPage('research'); }}>기업 분석 <ArrowUpRight size={14} /></button></div>
    <p>{row.capMethod} · 재무 수집 {row.fetchedAt ?? '미확인'} · 뉴스 {row.newsStatus}</p>
    <div className="ea-factors">{Object.entries(row.components).map(([key, score]) => <div key={key}><span>{labels[key]}</span><b className={score < 0 ? 'ea-negative' : ''}>{score > 0 ? '+' : ''}{score}</b></div>)}</div>
    <h3>선정 근거</h3>{row.reasons.length ? row.reasons.map((r, i) => <p key={i}>{r.points > 0 ? '+' : ''}{r.points} · {r.text}</p>) : <p>점수를 부여할 근거 부족</p>}
    <div className="ea-risk"><h3><ShieldAlert size={16} /> 증자·데이터 위험</h3><p>런웨이 {row.risk.runwayMonths === null ? '미확인' : `${row.risk.runwayMonths.toFixed(1)}개월`} · 주식 수 YoY {pct(row.risk.sharesYoY)} · 희석 공시 {row.risk.dilutionFilings}건</p>{[...row.excluded, ...row.warnings].map((w, i) => <p key={i}>• {w}</p>)}</div>
    <h3>뉴스·공시·실적 원문</h3><div className="ea-evidence">{row.evidence.length ? row.evidence.map((e, i) => <article key={i}><div><small>{e.source} · {e.publishedAt} · {e.confidence === 'headline_only' ? '제목 기반·미검증' : e.confidence === 'filing_metadata' ? '공시 항목·원문 확인 필요' : '보고 재무 수치'}</small>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.title} ↗</a> : <b>{e.title} (링크 없음)</b>}{e.period && <p>기간 {e.period} · 값 {e.value?.toLocaleString('en-US')}</p>}</div></article>) : <p>수집된 원문 근거가 없습니다.</p>}</div>
  </section>;
}
export function EarlyAlpha() {
  const [data, setData] = useState<EarlyData | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('candidate'); const [q, setQ] = useState(''); const [symbol, setSymbol] = useState(''); const [horizon, setHorizon] = useState('63');
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError('');
    fetchEarlyAlpha(controller.signal).then(setData).catch((e) => { if (!controller.signal.aborted) { setData(null); setError(e.message); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  const rows = (data?.candidates ?? []).filter((r) => (filter === 'all' || filter === 'new' && r.isNew || r.status === filter) && `${r.symbol} ${r.name}`.toLowerCase().includes(q.toLowerCase()));
  const row = rows.find((r) => r.symbol === symbol) ?? rows[0]; const summary = data?.performance.summary[horizon];
  const age = data ? Math.floor((Date.now() - Date.parse(data.asOf)) / 86400000) : 0;
  return <div className="ea-page">
    <div className="ea-hero"><div><span className="ea-kicker">BEFORE THE CONSENSUS</span><h2>기업의 변화가<br />가격보다 먼저.</h2><p>매출 가속 · 수익성 전환 · 계약과 상업화<br />이미 급등한 종목을 제외하는 독립 발굴 엔진</p></div><div className="ea-hero-right"><b>EARLY<br />ALPHA<span>↗</span></b><button className="ea-button" disabled={loading} onClick={() => setRefresh((v) => v + 1)}><RefreshCw size={14} /> {loading ? '불러오는 중' : '새로고침'}</button></div></div>
    {error && <div className="ea-risk" role="alert">{error}</div>}
    {loading && <p role="status">야간 발굴 결과를 불러오는 중…</p>}
    {data && <><div className="ea-meta">기준 {data.asOf} · {data.model} · 최초 기록 {data.generatedAt} · 갱신 {data.refreshedAt}{age > 4 && <strong> · 오래된 데이터</strong>}</div>
      <div className="ea-stats"><div><span>검사 종목</span><b>{data.stats.scanned.toLocaleString()}</b></div><div><span>재평가 후보</span><b>{data.stats.candidates}</b></div><div><span>오늘 최초 발굴</span><b>{data.candidates.filter((r) => r.isNew).length}</b></div><div><span>뉴스 확인 / 실패</span><b>{data.stats.newsRequests} / {data.stats.newsFailures}</b></div></div>
      <div className="ea-controls"><div className="ea-tabs">{[['candidate', '재평가 후보'], ['new', '오늘 신규'], ['watch', '관찰'], ['excluded', '제외'], ['all', '전체']].map(([id, label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div><label className="ea-search"><Search size={14} /><input aria-label="EARLY ALPHA 검색" placeholder="티커·기업명" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
      <div className="ea-workspace"><div className="ea-list">{rows.length ? rows.map((r) => <button className={`ea-card ${r.symbol === row?.symbol ? 'selected' : ''}`} key={r.symbol} onClick={() => setSymbol(r.symbol)}><div className="ea-card-top"><b>{r.ticker} {r.isNew && <em>NEW</em>}</b><strong>{r.score}<small>/100</small></strong></div><p>{r.name}</p><small>{statusLabel[r.status]} · 최초 후보 {r.firstSeen ?? '없음'}</small><div className="ea-card-metrics"><span>시총 {usd(r.marketCap)}</span><span>3개월 {pct(r.ret63)}</span><span>고점 -{(r.drawdown * 100).toFixed(0)}%</span></div><p>{r.reasons.find((x) => x.points > 0)?.text ?? r.excluded[0] ?? '검증 대기'}</p><span className="ea-risk-label">희석 위험 {r.risk.level === 'high' ? '높음' : r.risk.level === 'unknown' ? '미확인' : '원문 검토 필요'}</span></button>) : <div className="ea-empty">이 조건에 맞는 종목이 없습니다. 기준을 완화해 후보를 채우지 않습니다.</div>}</div>{row && <Evidence row={row} />}</div>
      <section className="ea-detail"><div className="ea-detail-heading"><h2>최초 발굴 성과</h2><select aria-label="성과 기간" value={horizon} onChange={(e) => setHorizon(e.target.value)}>{['21', '63', '126'].map((h) => <option key={h} value={h}>{h}거래일</option>)}</select></div><p>{data.performance.method}</p>{summary && <div className="ea-stats"><div><span>완료 / 전체</span><b>{summary.complete} / {summary.total}</b></div><div><span>평균 수익률</span><b>{pct(summary.meanReturn)}</b></div><div><span>SPY 대비</span><b>{pct(summary.meanExcess)}</b></div><div><span>대기 / 데이터 누락</span><b>{summary.pending} / {summary.missing}</b></div></div>}{summary && summary.complete < 30 && <p>완료 표본 30개 미만 — 성과를 일반화할 수 없습니다.</p>}<div className="ea-table-wrap"><table className="ea-table"><thead><tr><th>종목</th><th>최초 발굴</th><th>상태</th><th>수익률</th><th>SPY 대비</th><th>MFE</th><th>MAE</th></tr></thead><tbody>{data.performance.discoveries.map((d) => { const o = d.outcomes[horizon]; return <tr key={`${d.symbol}-${d.asOf}`}><td>{d.symbol}</td><td>{d.asOf}</td><td>{o.status === 'complete' ? '완료' : o.status === 'missing' ? '누락·상장폐지 확인' : '대기'}</td><td>{pct(o.return)}</td><td>{pct(o.excess)}</td><td>{pct(o.mfe)}</td><td>{pct(o.mae)}</td></tr>; })}</tbody></table></div></section>
      <details className="ea-detail"><summary>모델·데이터 해석 기준</summary><p>{data.method}</p><p>{data.caveat}</p><p>신규는 저장된 원장 내 최초 candidate 선정입니다. 같은 종목의 재진입은 신규로 세지 않습니다. 하루 재실행은 해당 날짜 원장을 변경하지 않습니다.</p></details>
    </>}
  </div>;
}
