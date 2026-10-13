import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useTerminal } from '../lib/store';
import { fetchBacktest, fetchSetups, NoSnapshotError, SECTOR_KO, type Backtest, type SetupRow, type Setups, type SetupStage, type SetupType } from '../lib/snapshot';
import { fmtEt, fmtPct, fmtPrice, fmtUsd, heatColor, signClass } from '../lib/format';
import { ErrorBox, Loading, PanelHead } from './ui';
import { buildStoryPrompt } from '../lib/storyPicks';

const STAGE: Record<SetupStage, { ko: string; cls: string; tip: string }> = {
  BREAKOUT: { ko: '오늘 돌파', cls: 'up', tip: '오늘 바닥 상단을 거래량 실린 양봉으로 돌파' },
  POST_BREAKOUT: { ko: '돌파 후 눌림', cls: 'up', tip: '최근 10거래일 내 돌파, 아직 많이 오르지 않음 — 진입 가능 구간' },
  NEAR_PIVOT: { ko: '돌파 임박', cls: 'neutral', tip: '바닥 상단 6% 이내 — 돌파 시 진입 대기' },
  EXTENDED: { ko: '추격 금지', cls: 'down', tip: '돌파가 대비 12% 이상 상승 — 눌림 대기' },
  IN_BASE: { ko: '바닥 다지는 중', cls: 'neutral', tip: '긴 바닥 박스 안 — 아래쪽이면 분할매수, 위쪽이면 상단 돌파 대기' },
  FAILED: { ko: '돌파 실패', cls: 'down', tip: '' },
  NONE: { ko: '—', cls: '', tip: '' },
  BOUNCE: { ko: '지지 반등', cls: 'up', tip: '지지선에서 반등 캔들 확인 — 오늘 고가 돌파 시 매수' },
  AT_SUPPORT: { ko: '지지 테스트', cls: 'neutral', tip: '지지선에 닿음 — 반등 확인 대기' },
  APPROACHING: { ko: '지지 접근', cls: '', tip: '지지선 5% 이내 — 지정가 대기' },
  TURNING: { ko: '전환 시작', cls: 'up', tip: '바닥 후 이평선 위로 올라오고 저점이 높아짐' },
  AT_BOTTOM: { ko: '바닥권', cls: 'neutral', tip: '바닥 근처, 아직 전환 신호 없음 — 분할매수 구간' },
};

const TYPES: Array<{ key: SetupType; ko: string; desc: string; stages: SetupStage[] }> = [
  { key: 'breakout', ko: '바닥 돌파', desc: '6–18개월 바닥을 다진 뒤 상단을 거래량 실어 뚫는 자리', stages: ['BREAKOUT', 'POST_BREAKOUT', 'NEAR_PIVOT'] },
  { key: 'base', ko: '바닥 다지기', desc: '크게 빠진 뒤 6–18개월째 바닥에서 옆으로 기는 종목 (아직 돌파 전). 박스 아래쪽 절반이면 바닥 근처 분할매수(지정가), 위쪽이면 돌파 대기', stages: ['IN_BASE'] },
  { key: 'pullback', ko: '눌림목', desc: '상승 추세 종목이 5–25% 쉬면서 20일 EMA·50일선·이전 고점·오더블록 지지에 닿은 자리', stages: ['BOUNCE', 'AT_SUPPORT', 'APPROACHING'] },
  { key: 'weekly_bottom', ko: '주봉 바닥', desc: '2년 고점 대비 35% 이상 빠진 뒤 신저가를 멈추고 바닥 20% 이내에 있는 종목', stages: ['TURNING', 'AT_BOTTOM'] },
  { key: 'monthly_bottom', ko: '월봉 바닥', desc: '5년 고점 대비 50% 이상 빠진 뒤 신저가를 멈추고 바닥 25% 이내에 있는 종목', stages: ['TURNING', 'AT_BOTTOM'] },
];
const ENTRY_KO: Record<string, string> = { 'buy-stop': '돌파 시', limit: '지정가', zone: '분할', market: '현재가' };
const typeOf = (x: SetupRow): SetupType => x.type ?? 'breakout';

function structure(x: SetupRow): [string, string] {
  switch (typeOf(x)) {
    case 'breakout':
      return [x.base ? `바닥 ${x.base.months}개월` : '—', x.pivot != null ? `돌파가 $${fmtPrice(x.pivot)} ${x.extension != null ? fmtPct(x.extension) : x.distanceToPivot != null ? `-${(x.distanceToPivot * 100).toFixed(1)}%` : ''}` : ''];
    case 'base':
      return [x.base ? `바닥 ${x.base.months}개월 · 폭 ${((x.base.depth ?? 0) * 100).toFixed(0)}%` : '—', x.posInBase != null ? `박스 ${x.posInBase <= 0.5 ? '아래쪽' : '위쪽'} (${(x.posInBase * 100).toFixed(0)}%) · 상단 $${fmtPrice(x.pivot ?? 0)}` : ''];
    case 'pullback':
      return [`조정 -${((x.depth ?? 0) * 100).toFixed(0)}%`, x.support ? `${x.support.kind} $${fmtPrice(x.support.price)}` : ''];
    default:
      return [`고점 대비 -${((x.decline ?? 0) * 100).toFixed(0)}%`, `바닥 +${((x.aboveLow ?? 0) * 100).toFixed(0)}% · 저점 ${x.lowAgeLabel ?? ''}`];
  }
}

export function SetupScanner() {
  const { select, setPage } = useTerminal();
  const [data, setData] = useState<Setups | null>(null);
  const [bt, setBt] = useState<Backtest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [type, setType] = useState<SetupType>('breakout');
  const [stage, setStage] = useState<SetupStage | 'all'>('all');
  const [storyOnly, setStoryOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetchSetups().then(setData).catch((e) => (e instanceof NoSnapshotError ? setMissing(true) : setErr(e.message)));
    fetchBacktest().then(setBt).catch(() => setBt(null));
  }, []);

  const T = TYPES.find((t) => t.key === type)!;
  const ofType = useMemo(() => (data ? data.candidates.filter((x) => typeOf(x) === type && T.stages.includes(x.stage)) : []), [data, type, T]);
  const rows = useMemo(() => ofType.filter((x) => (stage === 'all' || x.stage === stage) && (!storyOnly || x.storyScore >= 40)), [ofType, stage, storyOnly]);
  const method = data ? (typeof data.method === 'string' ? data.method : data.method[type]) : '';

  const openChart = (s: string) => { select(s); setPage('charts'); };
  const [copied, setCopied] = useState<string | null>(null);
  const copyPrompt = async (x: SetupRow) => {
    if (!data) return;
    const text = buildStoryPrompt(x, data.asOf);
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    setCopied(`${typeOf(x)}:${x.symbol}`);
    setTimeout(() => setCopied(null), 2500);
  };
  const pickType = (t: SetupType) => { setType(t); setStage('all'); setOpen(null); };

  return (
    <section className="panel">
      <PanelHead kicker="SETUP SCANNER · NIGHTLY" title="매수 자리 스캐너 — 돌파 · 눌림목 · 주봉/월봉 바닥" right={data && <span className="live-badge">기준일 {data.asOf}</span>} />
      {!data && !err && !missing && <Loading label="스캐너 결과 불러오기" />}
      {err && <ErrorBox error={err} />}
      {missing && (
        <div className="pad-box">
          <b>아직 스캐너가 실행되지 않았습니다.</b> GitHub Actions → <b>Nightly pipeline</b>을 실행하면 이 표가 채워집니다 (평일 장 마감 후 자동).
        </div>
      )}
      {data && (
        <>
          <div className="event-filter type-tabs">
            {TYPES.map((t) => {
              const n = data.candidates.filter((x) => typeOf(x) === t.key && t.stages.includes(x.stage)).length;
              return <button key={t.key} className={type === t.key ? 'active' : ''} onClick={() => pickType(t.key)}>{t.ko} ({n})</button>;
            })}
          </div>
          <div className="pad-box muted small">{T.desc}. 스토리 점수(실적 가속·흑자 전환·뉴스·테마, 희석·현금 부족 감점)를 더해 종합 점수로 정렬합니다. {method}</div>
          <div className="event-filter">
            <button className={stage === 'all' ? 'active' : ''} onClick={() => setStage('all')}>전체 ({ofType.length})</button>
            {T.stages.map((s) => <button key={s} className={stage === s ? 'active' : ''} onClick={() => setStage(s)} title={STAGE[s].tip}>{STAGE[s].ko} ({ofType.filter((x) => x.stage === s).length})</button>)}
            <span className="sep" />
            <button className={storyOnly ? 'active' : ''} onClick={() => setStoryOnly(!storyOnly)}>스토리 40점+</button>
          </div>
          <div className="table-wrap">
            <table className="data-table screener">
              <thead>
                <tr>
                  <th />
                  <th>종목</th><th>단계</th><th>종가</th><th>구조</th>
                  <th>매수타점</th><th>손절</th><th>목표</th><th>R</th>
                  <th>차트</th><th>스토리</th><th>종합</th><th>핵심 근거</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  const st = STAGE[x.stage];
                  const key = `${typeOf(x)}:${x.symbol}`;
                  const isOpen = open === key;
                  const pos = x.reasons.filter((r) => r.kind === 'plus');
                  const neg = x.reasons.filter((r) => r.kind === 'minus');
                  const [s1, s2] = structure(x);
                  const p = x.plan;
                  return (
                    <Fragment key={key}>
                      <tr className="clickable" onClick={() => setOpen(isOpen ? null : key)}>
                        <td>{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
                        <td><b>{x.symbol}</b><small>{x.name ?? ''} · {SECTOR_KO[x.sector] ?? x.sector}</small></td>
                        <td><span className={`sent ${st.cls}`} title={st.tip}>{st.ko}</span></td>
                        <td>${fmtPrice(x.price)}</td>
                        <td>{s1}<small>{s2}</small></td>
                        <td className="entry-cell">
                          {p ? (p.zone && (p.entryType === 'zone' || p.entryType === 'limit') ? `$${fmtPrice(p.zone[0])}–${fmtPrice(p.zone[1])}` : `$${fmtPrice(p.entry)}`) : '—'}
                          <small>{p?.entryType ? ENTRY_KO[p.entryType] : ''}</small>
                        </td>
                        <td className="down">{p ? `$${fmtPrice(p.stop)}` : '—'}<small>{p?.riskPct != null ? `-${(p.riskPct * 100).toFixed(1)}%` : ''}</small></td>
                        <td className="up">{p ? `$${fmtPrice(p.target)}` : '—'}<small>{p?.target2 ? `2차 $${fmtPrice(p.target2)}` : ''}</small></td>
                        <td>{p?.rMultiple != null ? p.rMultiple.toFixed(1) : '—'}</td>
                        <td className="heat"><span style={{ background: heatColor(x.chartScore) }}>{x.chartScore}</span></td>
                        <td className="heat"><span style={{ background: heatColor(x.storyScore) }}>{x.storyScore}</span></td>
                        <td className="heat"><span style={{ background: heatColor(x.score) }}>{x.score}</span></td>
                        <td className="muted reason-cell">{x.narrative?.takeaway ?? pos[0]?.text ?? (x.newsChecked ? '실적·뉴스 근거 없음' : '뉴스 미확인(상위 후보만 조회)')}{x.themes.length ? ` · ${x.themes.join(', ')}` : ''}</td>
                      </tr>
                      {isOpen && (
                        <tr className="detail-row">
                          <td />
                          <td colSpan={12}>
                            <div className="setup-detail">
                              <div>
                                {p?.how && <div className="how-box"><b>매수타점</b> {p.how}</div>}
                                <h4>차트</h4>
                                <ul>
                                  <ChartFacts x={x} />
                                  {p && <li>손절 기준: {p.stopKind}{p.note ? ` — ${p.note}` : ''}</li>}
                                  <li>시총 {fmtUsd(x.mcap)} · 일평균 거래대금 {fmtUsd(x.adv20)}</li>
                                </ul>
                                <div className="pick-actions">
                                  <button className="secondary-button" onClick={() => openChart(x.symbol)}>차트 열기</button>
                                  <button className="primary-button" onClick={() => copyPrompt(x)}>{copied === key ? '복사됨 ✓' : '분석 프롬프트 복사'}</button>
                                </div>
                              </div>
                              <div>
                                {x.narrative && (
                                  <div className="story-box">
                                    <b>스토리 요약</b>
                                    {x.narrative.lines.map((l, i) => <p key={i}>{l}</p>)}
                                    <p className="takeaway">→ {x.narrative.takeaway}</p>
                                    <small className="muted">{x.narrative.method}</small>
                                  </div>
                                )}
                                <h4>스토리 점수 근거</h4>
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
                {!rows.length && <tr><td colSpan={13} className="muted">조건에 맞는 종목 없음{type === 'breakout' ? ' — 시장이 약할 때는 돌파 자리가 거의 나오지 않는 것이 정상입니다.' : ''}</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="footnote pad">
            {data.stats.scanned.toLocaleString()}개 종목 검사 → 후보 {data.stats.candidates}개 · 모델 {data.model} · 종합 = 차트 {Math.round(data.weights.chart * 100)}% + 스토리 {Math.round(data.weights.story * 100)}% · 생성 {fmtEt(data.generatedAt)} ·
            데이터: Alpaca(일봉·월봉·뉴스), SEC EDGAR(실적·공시). <b>{data.caveat}</b> 눌림목·바닥 규칙과 스토리 점수는 아직 과거 검증 전이며, 후보는 매일 원장에 기록돼 성과 화면에서 추적됩니다.
          </p>
        </>
      )}
      {type === 'breakout' && <BacktestBox bt={bt} />}
    </section>
  );
}

const ok = (v: boolean | undefined) => (v ? '✔' : '✘');

function ChartFacts({ x }: { x: SetupRow }) {
  const t = typeOf(x);
  if (t === 'breakout') {
    return (
      <>
        {x.base && <li>바닥 {x.base.months}개월 · ${fmtPrice(x.base.low)}–${fmtPrice(x.base.high)} (깊이 {(x.base.depth * 100).toFixed(0)}%)</li>}
        {x.base && <li>저점 상승 {ok(x.base.higherLows)} · 변동성 수축 {ok(x.base.contraction)} · 거래량 감소 {ok(x.base.volumeDryUp)}</li>}
        {x.breakoutVolMult != null && <li>돌파일 거래량 50일 평균의 {x.breakoutVolMult.toFixed(1)}배{x.barsSinceBreakout ? ` (${x.barsSinceBreakout}거래일 전)` : ''}</li>}
        {x.trend && <li>추세 템플릿 {x.trend.passed}/{x.trend.total}{x.rs ? <> · 시장 대비 강도 3개월 <span className={signClass(x.rs.rs3m)}>{fmtPct(x.rs.rs3m)}</span>{x.rs.newHigh ? ' · RS 신고가 ✔' : ''}</> : null}</li>}
      </>
    );
  }
  if (t === 'pullback') {
    return (
      <>
        <li>최근 고점 ${fmtPrice(x.high)} ({x.highAgeBars}거래일 전) → 눌림 저점 ${fmtPrice(x.pullLow)} (조정 -{((x.depth ?? 0) * 100).toFixed(1)}%)</li>
        {x.support && <li>지지: {x.support.kind} ${fmtPrice(x.support.price)}{x.confluence && x.confluence.length > 1 ? ` · 겹치는 지지 ${x.confluence.join(', ')}` : ''}</li>}
        <li>조정 중 거래량 감소 {ok(x.volumeDryUp)} · RSI {x.rsi != null ? x.rsi.toFixed(0) : '—'} {x.rsiCooled ? '(과열 해소 ✔)' : ''}</li>
        {x.trend && <li>추세 템플릿 {x.trend.passed}/{x.trend.total}</li>}
      </>
    );
  }
  const tf = t === 'weekly_bottom' ? '주봉' : '월봉';
  const ma = t === 'weekly_bottom' ? '10주선' : '10개월선';
  return (
    <>
      <li>{tf} 고점 ${fmtPrice(x.high)} → 바닥 ${fmtPrice(x.low)} (-{((x.decline ?? 0) * 100).toFixed(0)}%), 저점은 {x.lowAgeLabel}</li>
      <li>현재 바닥 대비 +{((x.aboveLow ?? 0) * 100).toFixed(1)}%</li>
      <li>저점 상승 {ok(x.higherLow)} · {ma} 위 {ok(x.aboveMa)} · {ma} 상승 {ok(x.maRising)} · 거래량 감소 {ok(x.volumeDryUp)} · RSI 과매도 탈출 {ok(x.rsiRecover)}</li>
      <li className="muted">마지막 {tf}은 아직 진행 중인 봉입니다{x.bars ? ` (분석 ${x.bars}개 봉)` : ''}</li>
    </>
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
