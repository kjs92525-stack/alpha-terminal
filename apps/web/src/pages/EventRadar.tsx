import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useAnalysis, useTerminal } from '../lib/store';
import { FilingRow } from '../components/FilingRow';
import { ErrorBox, Loading, PanelHead, SourceBadge } from '../components/ui';
import { CATEGORY_LABEL, fmtEt, fmtPct, fmtShares, fmtUsd } from '../lib/format';
import type { Bar, FdaResponse, Filing } from '../lib/types';

type Scope = 'selected' | 'watch' | 'universe';
const CATS = ['ALL', 'EARNINGS', 'DILUTION', 'CONTRACT', 'M&A', 'DISTRESS', 'OWNERSHIP', 'GOVERNANCE', 'PERIODIC', 'INSIDER'];
const MAX_SYMBOLS = 8;

interface Feed { filings: Array<Filing & { symbol: string }>; bars: Record<string, Bar[]>; sources: Array<{ symbol: string; name: string; fetchedAt: string; url: string }>; errors: string[] }

export function EventRadar() {
  const { source, selected, watchlist, universe, mode } = useTerminal();
  const [scope, setScope] = useState<Scope>('selected');
  const [cat, setCat] = useState('ALL');
  const [minImp, setMinImp] = useState<'low' | 'medium' | 'high'>('medium');
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(false);

  const symbols = useMemo(() => (scope === 'selected' ? [selected] : scope === 'watch' ? watchlist : universe).filter(Boolean).slice(0, MAX_SYMBOLS), [scope, selected, watchlist, universe]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const out: Feed = { filings: [], bars: {}, sources: [], errors: [] };
      for (const s of symbols) {
        const [f, b] = await Promise.allSettled([source.filings(s), source.bars(s, '1D')]);
        if (f.status === 'fulfilled') {
          out.filings.push(...f.value.filings.map((x) => ({ ...x, symbol: s })));
          out.sources.push({ symbol: s, name: f.value.source, fetchedAt: f.value.fetchedAt, url: f.value.sourceUrl });
        } else out.errors.push(`${s}: ${(f.reason as Error).message}`);
        if (b.status === 'fulfilled') out.bars[s] = b.value.bars;
        if (!alive) return;
      }
      out.filings.sort((a, b) => String(b.acceptedAt ?? b.filingDate).localeCompare(String(a.acceptedAt ?? a.filingDate)));
      if (alive) { setFeed(out); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [symbols, source]);

  const rank = { low: 1, medium: 2, high: 3, critical: 4 };
  const rows = (feed?.filings ?? []).filter((f) => (cat === 'ALL' || f.category === cat) && rank[f.importance] >= rank[minImp]);

  return (
    <>
      <div className="radar-grid">
        <section className="panel">
          <PanelHead kicker="EVENT INTELLIGENCE" title="공시·이벤트 피드" right={feed?.sources[0] && <SourceBadge name={feed.sources[0].name} fetchedAt={feed.sources[0].fetchedAt} url={feed.sources[0].url || undefined} />} />
          <div className="event-filter">
            {(['selected', 'watch', 'universe'] as Scope[]).map((s) => <button key={s} className={scope === s ? 'active' : ''} onClick={() => setScope(s)}>{{ selected: `선택 종목 (${selected})`, watch: `관심종목 (${watchlist.length})`, universe: `유니버스 상위 ${MAX_SYMBOLS}` }[s]}</button>)}
            <span className="sep" />
            {(['low', 'medium', 'high'] as const).map((i) => <button key={i} className={minImp === i ? 'active' : ''} onClick={() => setMinImp(i)}>중요도 ≥ {i.toUpperCase()}</button>)}
          </div>
          <div className="event-filter">
            {CATS.map((c) => <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c === 'ALL' ? '전체' : CATEGORY_LABEL[c] ?? c}</button>)}
          </div>
          {loading && <Loading label="SEC 공시 수집" />}
          {feed?.errors.map((e) => <ErrorBox key={e} error={e} />)}
          {!loading && (
            <div className="filing-list">
              <div className="filing-row head"><span>유형 / 접수 시각(ET)</span><span>내용</span><span>공시 후 첫 거래일 반응</span><span>원문</span></div>
              {rows.map((f) => <FilingRow key={f.accession + f.symbol} f={f} bars={feed?.bars[f.symbol]} />)}
              {!rows.length && <div className="empty">조건에 맞는 공시가 없습니다{scope === 'watch' && !watchlist.length ? ' (관심종목을 먼저 등록하세요)' : ''}.</div>}
            </div>
          )}
          <p className="footnote pad">반응 = 공시가 처음 반영될 수 있는 거래일 종가 / 직전 종가 − 1 (16:00 ET 이후 접수 시 다음 거래일). 일봉 기준 사후 측정값이며 다른 뉴스와 분리되지 않습니다. 중요도는 공시 유형·8-K 항목 기반 규칙 분류입니다.</p>
        </section>
        <div className="radar-side">
          <CashRunway symbol={selected} />
          <FdaPanel />
          <section className="panel">
            <PanelHead kicker="SHORT / BORROW" title="공매도·대차" />
            <div className="pad-box muted">미연결. FINRA 공매도 잔고(월 2회, 무료)와 일별 공매도 거래량 연동이 다음 단계입니다. 실시간 대차 수수료(CTB) 데이터는 유료 공급자가 필요하며 승인 없이 연결하지 않습니다.</div>
          </section>
          <section className="panel">
            <PanelHead kicker="EARNINGS" title="실적 발표" />
            <div className="pad-box muted">실적 발표는 8-K Item 2.02로 감지하고 발표 후 주가 반응을 측정합니다. 컨센서스 대비 어닝 서프라이즈는 추정치 데이터(유료)가 필요해 표시하지 않습니다.{mode === 'mock' && ' (현재 가상 데이터)'}</div>
          </section>
        </div>
      </div>
    </>
  );
}

function CashRunway({ symbol }: { symbol: string }) {
  const { data, error, loading } = useAnalysis(symbol);
  const f = data?.fundamentals;
  const m = data?.score.metrics;
  const dil = (data?.filings ?? []).filter((x) => x.category === 'DILUTION' && x.importance !== 'low');
  return (
    <section className="panel">
      <PanelHead kicker="DILUTION & RUNWAY" title={`현금·희석 위험 · ${symbol}`} />
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && !f && <div className="pad-box muted">SEC XBRL 재무 데이터가 없습니다.</div>}
      {f && (
        <div className="fact-grid">
          <div><small>현금성 자산</small><b>{fmtUsd(f.liquidAssets)}</b><em>{f.cash ? `기준 ${f.cash.end}` : ''}</em></div>
          <div><small>연간 영업현금흐름</small><b className={(f.operatingCashFlow?.value ?? 0) < 0 ? 'down' : 'up'}>{fmtUsd(f.operatingCashFlow?.value)}</b><em>{f.operatingCashFlow ? `FY ${f.operatingCashFlow.end}` : ''}</em></div>
          <div><small>런웨이</small><b className={f.runwayMonths !== null && f.runwayMonths < 12 ? 'down' : ''}>{f.runwayMonths !== null ? `${f.runwayMonths.toFixed(0)}개월` : (f.operatingCashFlow?.value ?? 0) >= 0 ? '현금흐름 흑자' : '—'}</b><em>단순 추정</em></div>
          <div><small>유통주식수</small><b>{fmtShares(f.sharesOutstanding?.value)}</b><em>{f.sharesOutstanding ? `기준 ${f.sharesOutstanding.end}` : ''}</em></div>
          <div><small>주식수 1년 변화</small><b className={(f.sharesYoY ?? 0) > 0.05 ? 'down' : ''}>{fmtPct(f.sharesYoY)}</b><em>희석 지표</em></div>
          <div><small>최근 1년 희석 공시</small><b className={(m?.dilutionFilings365d ?? 0) > 0 ? 'down' : ''}>{m?.dilutionFilings365d ?? 0}건</b><em>S-1/S-3/424B/3.02</em></div>
        </div>
      )}
      {dil.length > 0 && (
        <ul className="mini-list">
          {dil.slice(0, 5).map((d) => <li key={d.accession}><a href={d.url || undefined} target="_blank" rel="noreferrer">{d.form}</a> {d.label} <span className="muted">{fmtEt(d.acceptedAt ?? d.filingDate, false)}</span></li>)}
        </ul>
      )}
      {data?.sources.fundamentals && <div className="pad-box"><SourceBadge {...data.sources.fundamentals} /></div>}
    </section>
  );
}

function FdaPanel() {
  const { source, mode } = useTerminal();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<FdaResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    source.fda(q.trim()).then(setRes).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  };
  return (
    <section className="panel">
      <PanelHead kicker="FDA" title="FDA 승인 이력 (openFDA)" />
      <div className="inline-form">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="스폰서/브랜드명 (예: MODERNA, KEYTRUDA)" />
        <button className="secondary-button" onClick={run} disabled={busy}><Search size={12} /> 조회</button>
      </div>
      {err && <ErrorBox error={err} />}
      {res && (
        <>
          <ul className="mini-list">
            {res.results.slice(0, 10).map((r, i) => (
              <li key={i}><b>{r.brand ?? r.generic ?? r.application}</b> <span className="muted">{r.application}</span> · {r.type} {r.status === 'AP' ? <span className="up">승인</span> : r.status} <span className="muted">{r.statusDate}</span></li>
            ))}
            {!res.results.length && <li className="muted">결과 없음</li>}
          </ul>
          <div className="pad-box"><SourceBadge name={res.source} fetchedAt={res.fetchedAt} url={res.sourceUrl || undefined} note={res.note} /></div>
        </>
      )}
      {!res && <div className="pad-box muted">{mode === 'mock' ? '가상 모드: openFDA 미조회' : '공식 openFDA 데이터. 임상시험 결과·PDUFA 일정은 포함되지 않습니다.'}</div>}
    </section>
  );
}
