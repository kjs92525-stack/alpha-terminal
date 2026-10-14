import { DecisionTools } from '../components/DecisionTools';
import { DemandMechanism } from '../components/DemandMechanism';
import { demandStory } from '../../../../packages/analysis/demand-stories.mjs';
import { CompanyDossier } from '../components/CompanyDossier';
import { companyDossier } from '../../../../packages/analysis/company-dossier.mjs';
import { MacroStory } from '../components/MacroStory';
import { InvestmentReviewPanel } from '../components/InvestmentReview';
import { ExternalLink, Star } from 'lucide-react';
import { useAnalysis, useTerminal } from '../lib/store';
import { ErrorBox, FactorBars, Loading, PanelHead, ScoreRing, SourceBadge } from '../components/ui';
import { FilingRow } from '../components/FilingRow';
import { ChartWorkspace, useBars } from '../components/ChartWorkspace';
import { fmtNum, fmtPct, fmtPrice, fmtShares, fmtUsd, RISK_LABEL, signClass, SIZE_LABEL, STYLE_LABEL } from '../lib/format';

export function Research() {
  const { selected, watchlist, toggleWatch, mode } = useTerminal();
  const { data, error, loading } = useAnalysis(selected);
  const { data: bars } = useBars(selected, '1D');
  if (error) return <ErrorBox error={error} hint="티커가 맞는지, API/시세 공급자가 동작하는지 확인하세요." />;
  if (loading || !data) return <Loading label={`${selected} 분석`} />;
  const s = data.score;
  const m = s.metrics;
  const f = data.fundamentals;
  const storyRow = {ticker:data.symbol,name:data.name ?? data.symbol,status:'watch',evidence:[],reasons:[],risk:{level:'unknown',checked:false},marketCap:m.marketCap,reportPeriod:f?.revenueQuarterly.at(-1)?.end,demo:mode==='mock'};
  const hasDossier = Boolean(companyDossier(storyRow,m.asOf));
  const hasMechanism = mode!=='mock' && Boolean(demandStory(data.symbol,m.asOf));
  return (
    <>
      <section className="panel">
        <div className="research-hero">
          <div>
            <span className="section-overline">{data.cik ? `CIK ${data.cik}` : 'NO SEC CIK'} · {data.sic ?? '—'}</span>
            <h2>{data.symbol} <small>{data.name}</small></h2>
            <div className="chips">
              <span className="chip">{SIZE_LABEL[s.size]}</span><span className="chip">{STYLE_LABEL[s.style]}</span>
              <span className={`chip ${s.riskLevel === 'HIGH' ? 'down' : ''}`}>위험 {RISK_LABEL[s.riskLevel]}</span>
              <span className="chip">커버리지 {s.coverage}%</span>
            </div>
          </div>
          <div className="hero-right">
            <div><strong>{s.rating}</strong><small>팩터 점수 · 매수 판정 아님 · {s.model}</small></div>
            <ScoreRing score={s.score} size={92} />
            <button className="secondary-button" onClick={() => toggleWatch(selected)}><Star size={12} /> {watchlist.includes(selected) ? '관심 해제' : '관심등록'}</button>
          </div>
        </div>
        {data.warnings.map((w) => <ErrorBox key={w} error={w} />)}
      </section>

      {hasDossier && <section className="panel pad-box"><CompanyDossier row={storyRow} asOf={m.asOf} /></section>}
      {!hasDossier && hasMechanism && <section className="panel pad-box"><DemandMechanism ticker={data.symbol} asOf={m.asOf} /></section>}
      <InvestmentReviewPanel input={{ticker:data.symbol,asOf:m.asOf,price:m.price,marketCap:m.marketCap,fundamentals:f,risk:{checked:false},demo:mode==='mock'}} />
      {!hasDossier && mode!=='mock' && <details className="panel pad-box"><summary>세계정세·산업 전망과 연결해서 읽기</summary><MacroStory ticker={data.symbol} asOf={m.asOf} /></details>}
      {mode!=='mock'&&<DecisionTools key={data.symbol} ticker={data.symbol} price={m.price} marketCap={m.marketCap} revenue={f?.revenue?.value} adv20={m.adv20Usd} asOf={m.asOf} />}
      <div className="detail-grid">
        <section className="panel">
          <PanelHead kicker="FACTORS" title="팩터 분해" />
          <div className="pad-box"><FactorBars factors={s.factors} /></div>
          <div className="pad-box">
            <span className="section-overline">EVIDENCE</span>
            <ul className="evidence">{s.evidence.map((e, i) => <li key={i} className={e.sign === '+' ? 'up' : 'down'}><span>{e.sign}</span>{e.text}</li>)}</ul>
          </div>
        </section>
        <section className="panel">
          <PanelHead kicker="SCENARIOS" title="시나리오 (1개월)" />
          {s.scenarios ? (
            <div className="pad-box">
              <div className="scenario bull"><b>상승</b><span>${fmtPrice(s.scenarios.bull.range[0])} → ${fmtPrice(s.scenarios.bull.range[1])}</span><p>조건: {s.scenarios.bull.trigger}</p></div>
              <div className="scenario base"><b>중립</b><span>${fmtPrice(s.scenarios.base.range[0])} – ${fmtPrice(s.scenarios.base.range[1])}</span><p>조건: {s.scenarios.base.trigger}</p></div>
              <div className="scenario bear"><b>하락</b><span>${fmtPrice(s.scenarios.bear.range[1])} → ${fmtPrice(s.scenarios.bear.range[0])}</span><p>조건: {s.scenarios.bear.trigger}</p></div>
              <p className="footnote">{s.scenarios.method}. 1σ = {fmtPct(s.scenarios.sigmaPct)}. 범위는 과거 변동성의 크기를 보여줄 뿐, 방향이나 발생 확률을 의미하지 않습니다.</p>
            </div>
          ) : <div className="pad-box muted">변동성 데이터 부족</div>}
        </section>
      </div>

      <div className="detail-grid">
        <section className="panel">
          <PanelHead kicker="MARKET METRICS" title="시장 지표" right={<SourceBadge {...data.sources.prices} />} />
          <div className="fact-grid">
            <div><small>종가 (마감 기준)</small><b>${fmtPrice(m.price)}</b><em>{m.asOf}</em></div>
            <div><small>1M / 3M</small><b><span className={signClass(m.ret1m)}>{fmtPct(m.ret1m)}</span> / <span className={signClass(m.ret3m)}>{fmtPct(m.ret3m)}</span></b></div>
            <div><small>12-1M 모멘텀</small><b className={signClass(m.ret12m1)}>{fmtPct(m.ret12m1)}</b></div>
            <div><small>52주 고점 대비</small><b>{fmtPct(m.distHigh52)}</b><em>고 ${fmtPrice(m.high52)} / 저 ${fmtPrice(m.low52)}</em></div>
            <div><small>RSI 14</small><b>{fmtNum(m.rsi14, 1)}</b></div>
            <div><small>ATR %</small><b>{fmtPct(m.atrPct)}</b></div>
            <div><small>변동성 (60D, 연환산)</small><b>{fmtPct(m.vol60, 0)}</b></div>
            <div><small>1년 최대낙폭</small><b className="down">{fmtPct(m.maxDD1y)}</b></div>
            <div><small>20일 평균 거래대금</small><b>{fmtUsd(m.adv20Usd)}</b></div>
            <div><small>상대 거래량 (5D/60D)</small><b>{fmtNum(m.relVolume, 2)}x</b></div>
          </div>
        </section>
        <section className="panel">
          <PanelHead kicker="FUNDAMENTALS" title="보고 재무 (출처·기간 확인)" right={data.sources.fundamentals && <SourceBadge {...data.sources.fundamentals} />} />
          {f ? (
            <div className="fact-grid">
              <div><small>시가총액 (추정)</small><b>{fmtUsd(m.marketCap)}</b><em>주식수 × 종가</em></div>
              <div><small>보고 매출</small><b>{fmtUsd(f.revenue?.value)}</b><em>{f.revenue ? `${f.revenue.form} ${f.revenue.end} · 제출 ${f.revenue.filed}` : ''}</em></div>
              <div><small>매출 성장률</small><b className={signClass(f.revenueGrowth)}>{fmtPct(f.revenueGrowth)}</b><em>전년 대비</em></div>
              <div><small>순이익 / 이익률</small><b>{fmtUsd(f.netIncome?.value)}</b><em>{fmtPct(f.netMargin)}</em></div>
              <div><small>P/S · P/E</small><b>{fmtNum(m.priceToSales, 1)} · {fmtNum(m.priceToEarnings, 1)}</b><em>보고 매출·순이익 기간 기준</em></div>
              <div><small>자동 수집 현금성 자산 (원문 검토값과 구분)</small><b>{fmtUsd(f.liquidAssets)}</b><em>{f.cash?.end}{f.cash && f.revenueQuarterly.at(-1) && f.cash.end < f.revenueQuarterly.at(-1)!.end ? ' · 과거 현금, 최신 확인 필요' : ''}</em></div>
              <div><small>영업현금흐름</small><b className={signClass(f.operatingCashFlow?.value)}>{fmtUsd(f.operatingCashFlow?.value)}</b><em>{f.operatingCashFlow?.end}</em></div>
              <div><small>런웨이</small><b>{f.runwayMonths !== null ? `${f.runwayMonths.toFixed(0)}개월` : '—'}</b></div>
              <div><small>발행주식수 (유통물량과 다름)</small><b>{fmtShares(f.sharesOutstanding?.value)}</b><em>{f.sharesOutstanding?.end}</em></div>
              <div><small>주식수 1Y 변화</small><b className={(f.sharesYoY ?? 0) > 0.05 ? 'down' : ''}>{fmtPct(f.sharesYoY)}</b></div>
            </div>
          ) : <div className="pad-box muted">XBRL 재무 데이터 없음 (해외 발행사·신규 상장 등)</div>}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 12 }}>
        <PanelHead kicker="CHART" title="가격 구조" />
        <ChartWorkspace symbol={selected} height={380} />
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <PanelHead kicker="SEC FILINGS" title="최근 공시" right={data.sources.filings && <SourceBadge {...data.sources.filings} />} />
        <div className="filing-list">
          {data.filings.map((x) => <FilingRow key={x.accession} f={x} symbol={data.symbol} bars={bars?.bars} />)}
          {!data.filings.length && <div className="empty">공시 없음</div>}
        </div>
        {data.cik && <div className="pad-box"><a className="text-link" href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${data.cik}&owner=include&count=40`} target="_blank" rel="noreferrer">EDGAR에서 전체 보기 <ExternalLink size={11} /></a></div>}
      </section>
    </>
  );
}
