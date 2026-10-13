import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useTerminal } from '../lib/store';
import { fetchBacktest, fetchSetups, NoSnapshotError, SECTOR_KO, type Backtest, type Setups, type SetupStage } from '../lib/snapshot';
import { fmtEt, fmtPct, fmtPrice, fmtUsd, heatColor, signClass } from '../lib/format';
import { ErrorBox, Loading, PanelHead } from './ui';

const STAGE: Record<SetupStage, { ko: string; cls: string; tip: string }> = {
  BREAKOUT: { ko: '오늘 돌파', cls: 'up', tip: '오늘 바닥 상단을 거래량 실린 양봉으로 돌파' },
  POST_BREAKOUT: { ko: '돌파 후 눌림', cls: 'up', tip: '최근 10거래일 내 돌파, 아직 많이 오르지 않음 — 진입 가능 구간' },
  NEAR_PIVOT: { ko: '돌파 임박', cls: 'neutral', tip: '바닥 상단 6% 이내 — 돌파 시 진입 대기' },
  EXTENDED: { ko: '추격 금지', cls: 'down', tip: '돌파가 대비 12% 이상 상승 — 눌림 대기' },
  IN_BASE: { ko: '바닥 형성 중', cls: '', tip: '' },
  FAILED: { ko: '돌파 실패', cls: 'down', tip: '' },
  NONE: { ko: '—', cls: '', tip: '' },
};
type Filter = 'action' | 'BREAKOUT' | 'POST_BREAKOUT' | 'NEAR_PIVOT' | 'story';

export function BreakoutScanner() {
  const { select, setPage } = useTerminal();
  const [data, setData] = useState<Setups | null>(null);
  const [bt, setBt] = useState<Backtest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState<Filter>('action');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetchSetups().then(setData).catch((e) => (e instanceof NoSnapshotError ? setMissing(true) : setErr(e.message)));
    fetchBacktest().then(setBt).catch(() => setBt(null));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const c = data.candidates;
    if (filter === 'action') return c.filter((x) => x.stage === 'BREAKOUT' || x.stage === 'POST_BREAKOUT' || x.stage === 'NEAR_PIVOT');
    if (filter === 'story') return c.filter((x) => x.storyScore >= 40);
    return c.filter((x) => x.stage === filter);
  }, [data, filter]);

  const openChart = (s: string) => { select(s); setPage('charts'); };

  return (
    <section className="panel">
      <PanelHead kicker="BASE BREAKOUT + STORY · NIGHTLY" title="바닥 돌파 + 스토리 스캐너" right={data && <span className="live-badge">기준일 {data.asOf}</span>} />
      <div className="pad-box muted small">
        6–18개월 동안 바닥을 다지며 <b>저점은 높아지고 변동성·거래량은 줄어든</b> 종목이, 바닥 상단을 <b>평균 1.4배 이상 거래량</b>으로 뚫는 자리를 찾습니다.
        여기에 SEC 실적(분기 매출 가속·흑자 전환)과 뉴스(관심 급증·테마·“의심받는 성장”)로 <b>스토리 점수</b>를 매기고, 희석·현금 부족·위험 공시는 감점합니다.
      </div>
      {!data && !err && !missing && <Loading label="스캐너 결과 불러오기" />}
      {err && <ErrorBox error={err} />}
      {missing && (
        <div className="pad-box">
          <b>아직 스캐너가 실행되지 않았습니다.</b> GitHub Actions → <b>Nightly pipeline</b>을 실행하면 이 표가 채워집니다 (평일 장 마감 후 자동).
        </div>
      )}
      {data && (
        <>
          <div className="event-filter">
            {([['action', '진입 가능'], ['BREAKOUT', '오늘 돌파'], ['POST_BREAKOUT', '돌파 후 눌림'], ['NEAR_PIVOT', '돌파 임박'], ['story', '스토리 40점+']] as Array<[Filter, string]>).map(([k, l]) => (
              <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
                {l} ({k === 'action' ? (data.stats.byStage.BREAKOUT ?? 0) + (data.stats.byStage.POST_BREAKOUT ?? 0) + (data.stats.byStage.NEAR_PIVOT ?? 0) : k === 'story' ? data.candidates.filter((x) => x.storyScore >= 40).length : data.stats.byStage[k] ?? 0})
              </button>
            ))}
          </div>
          <div className="table-wrap">
            <table className="data-table screener">
              <thead>
                <tr>
                  <th />
                  <th>종목</th><th>단계</th><th>종가</th><th>돌파가</th><th>바닥</th>
                  <th>진입</th><th>손절</th><th>목표</th><th>R</th>
                  <th>차트</th><th>스토리</th><th>종합</th><th>핵심 근거</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  const st = STAGE[x.stage];
                  const isOpen = open === x.symbol;
                  const pos = x.reasons.filter((r) => r.kind === 'plus');
                  const neg = x.reasons.filter((r) => r.kind === 'minus');
                  return (
                    <Fragment key={x.symbol}>
                      <tr className="clickable" onClick={() => setOpen(isOpen ? null : x.symbol)}>
                        <td>{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
                        <td><b>{x.symbol}</b><small>{x.name ?? ''} · {SECTOR_KO[x.sector] ?? x.sector}</small></td>
                        <td><span className={`sent ${st.cls}`} title={st.tip}>{st.ko}</span></td>
                        <td>${fmtPrice(x.price)}</td>
                        <td>${fmtPrice(x.pivot)}<small className={x.extension !== null ? signClass(x.extension) : ''}>{x.extension !== null ? fmtPct(x.extension) : x.distanceToPivot !== null ? `-${(x.distanceToPivot * 100).toFixed(1)}%` : ''}</small></td>
                        <td>{x.base ? `${x.base.months}개월` : '—'}<small>{x.base ? `깊이 ${(x.base.depth * 100).toFixed(0)}%` : ''}</small></td>
                        <td>{x.plan ? `$${fmtPrice(x.plan.entry)}` : '—'}</td>
                        <td className="down">{x.plan ? `$${fmtPrice(x.plan.stop)}` : '—'}<small>{x.plan ? `-${(x.plan.riskPct * 100).toFixed(1)}%` : ''}</small></td>
                        <td className="up">{x.plan ? `$${fmtPrice(x.plan.target)}` : '—'}</td>
                        <td>{x.plan?.rMultiple != null ? x.plan.rMultiple.toFixed(1) : '—'}</td>
                        <td className="heat"><span style={{ background: heatColor(x.chartScore) }}>{x.chartScore}</span></td>
                        <td className="heat"><span style={{ background: heatColor(x.storyScore) }}>{x.storyScore}</span></td>
                        <td className="heat"><span style={{ background: heatColor(x.score) }}>{x.score}</span></td>
                        <td className="muted reason-cell">{pos[0]?.text ?? (x.newsChecked ? '실적·뉴스 근거 없음' : '뉴스 미확인(상위 후보만 조회)')}{x.themes.length ? ` · ${x.themes.join(', ')}` : ''}</td>
                      </tr>
                      {isOpen && (
                        <tr className="detail-row">
                          <td />
                          <td colSpan={13}>
                            <div className="setup-detail">
                              <div>
                                <h4>차트</h4>
                                <ul>
                                  {x.base && <li>바닥 {x.base.months}개월 · ${fmtPrice(x.base.low)}–${fmtPrice(x.base.high)} (깊이 {(x.base.depth * 100).toFixed(0)}%)</li>}
                                  {x.base && <li>저점 상승 {x.base.higherLows ? '✔' : '✘'} · 변동성 수축 {x.base.contraction ? '✔' : '✘'} · 거래량 감소 {x.base.volumeDryUp ? '✔' : '✘'}</li>}
                                  {x.breakoutVolMult !== null && <li>돌파일 거래량 50일 평균의 {x.breakoutVolMult.toFixed(1)}배{x.barsSinceBreakout ? ` (${x.barsSinceBreakout}거래일 전)` : ''}</li>}
                                  <li>추세 템플릿 {x.trend.passed}/{x.trend.total} · 시장 대비 강도 3개월 <span className={signClass(x.rs.rs3m)}>{fmtPct(x.rs.rs3m)}</span>{x.rs.newHigh ? ' · RS 신고가 ✔' : ''}</li>
                                  {x.plan && <li>손절 기준: {x.plan.stopKind}{x.plan.note ? ` — ${x.plan.note}` : ''}</li>}
                                  <li>시총 {fmtUsd(x.mcap)} · 일평균 거래대금 {fmtUsd(x.adv20)}</li>
                                </ul>
                                <button className="secondary-button" onClick={() => openChart(x.symbol)}>차트 열기</button>
                              </div>
                              <div>
                                <h4>스토리</h4>
                                <ul>
                                  {pos.map((r, i) => <li key={i} className="up">+{r.pts} {r.text}</li>)}
                                  {neg.map((r, i) => <li key={i} className="down">{r.pts} {r.text}</li>)}
                                  {!x.reasons.length && <li className="muted">근거 없음 (SEC 실적·뉴스에서 플러스 요인 미발견)</li>}
                                  {!!x.revenueYoY.length && <li className="muted">분기 매출 YoY: {x.revenueYoY.map((q) => `${q.end.slice(0, 7)} ${fmtPct(q.yoy, 0)}`).join(' → ')}</li>}
                                </ul>
                                {!!x.news.length && (
                                  <>
                                    <h4>최근 뉴스</h4>
                                    <ul className="news-mini">
                                      {x.news.map((n, i) => <li key={i}><span className="muted">{n.time.slice(0, 10)}</span> {n.url ? <a className="text-link inline" href={n.url} target="_blank" rel="noreferrer">{n.headline}</a> : n.headline}</li>)}
                                    </ul>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!rows.length && <tr><td colSpan={14} className="muted">조건에 맞는 종목 없음 — 시장이 약할 때는 돌파 자리가 거의 나오지 않는 것이 정상입니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="footnote pad">
            {data.stats.scanned.toLocaleString()}개 종목 검사 → 후보 {data.stats.candidates}개 · 모델 {data.model} · 점수 = 차트 {Math.round(data.weights.chart * 100)}% + 스토리 {Math.round(data.weights.story * 100)}% · 생성 {fmtEt(data.generatedAt)} ·
            데이터: Alpaca(가격·뉴스), SEC EDGAR(실적·공시). <b>{data.caveat}</b> 스토리 점수는 아직 과거 검증 전이며, 진입/손절 후보는 매일 원장에 기록돼 성과 화면에서 추적됩니다.
          </p>
        </>
      )}
      <BacktestBox bt={bt} />
    </section>
  );
}

const GROUP_KO: Record<string, string> = { all: '전체 돌파', trendTemplateOk: '추세 템플릿 통과', longBase9mPlus: '바닥 9개월 이상', highQualityBase: '바닥 품질 상위', rsNewHigh: 'RS 신고가 동반', tightRisk8pct: '손절폭 8% 이내' };

function BacktestBox({ bt }: { bt: Backtest | null }) {
  if (!bt) {
    return <div className="pad-box muted small">과거 검증(백테스트): 아직 실행 전 — GitHub Actions → <b>Breakout backtest</b> 실행 시 2016년 이후 같은 규칙의 실제 성과가 여기에 표시됩니다.</div>;
  }
  const pltr = bt.caseStudies.PLTR ?? [];
  return (
    <div className="pad-box">
      <h4 style={{ margin: '0 0 6px' }}>과거 검증 — 같은 차트 규칙을 {bt.symbols.toLocaleString()}개 종목에 적용 (거래 {bt.trades.toLocaleString()}건)</h4>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>조건</th><th>건수</th><th>60일 승률</th><th>60일 평균</th><th>60일 중앙값</th><th>SPY 대비</th><th>평균 R</th><th>손절률</th><th>+50% 이상</th><th>120일 평균</th></tr></thead>
          <tbody>
            {Object.entries(bt.report).map(([g, h]) => {
              const s = h['60d'];
              const l = h['120d'];
              return (
                <tr key={g}>
                  <td>{GROUP_KO[g] ?? g}</td><td>{s.n}</td>
                  <td>{fmtPct(s.winRate, 0).replace('+', '')}</td>
                  <td className={signClass(s.avgReturn)}>{fmtPct(s.avgReturn)}</td>
                  <td className={signClass(s.medianReturn)}>{fmtPct(s.medianReturn)}</td>
                  <td className={signClass(s.avgExcessVsSpy)}>{fmtPct(s.avgExcessVsSpy)}</td>
                  <td>{s.avgR != null ? s.avgR.toFixed(2) : '—'}</td>
                  <td>{fmtPct(s.stoppedRate, 0).replace('+', '')}</td>
                  <td>{fmtPct(s.bigWinners, 1).replace('+', '')}</td>
                  <td className={signClass(l?.avgReturn)}>{fmtPct(l?.avgReturn)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!!pltr.length && (
        <p className="small">
          <b>PLTR 사례:</b>{' '}
          {pltr.map((t) => `${t.date} 진입 $${fmtPrice(t.entry)} (바닥 ${t.baseMonths}개월) → 60일 ${t.results['60'] ? fmtPct(t.results['60'].ret) + (t.results['60'].stopped ? ' 손절' : '') : '진행 중'}, 120일 ${t.results['120'] ? fmtPct(t.results['120'].ret) : '진행 중'}`).join(' · ')}
        </p>
      )}
      <p className="footnote">{bt.method} 한계: {bt.limits.join(' / ')} · 생성 {fmtEt(bt.generatedAt)} <a className="text-link inline" href="https://github.com/kjs92525-stack/alpha-terminal/tree/data/backtest" target="_blank" rel="noreferrer">원본 <ExternalLink size={10} /></a></p>
    </div>
  );
}
