import { useMemo, useState } from 'react';
import { Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import { DEFAULT_LIVE_UNIVERSE, useTerminal } from '../lib/store';
import { filterRows } from '../components/Scanner';
import { fmtPct, fmtPrice, fmtUsd, heatColor, RISK_LABEL, signClass, SIZE_LABEL, STYLE_LABEL } from '../lib/format';
import { ModeBadge, PanelHead } from '../components/ui';
import type { ScreenRow } from '../lib/types';
import { UniverseRankings } from '../components/UniverseRankings';
import { BreakoutScanner } from '../components/BreakoutScanner';

type SortKey = 'score' | 'momentum' | 'trend' | 'quality' | 'valuation' | 'liquidity' | 'risk' | 'ret3m' | 'marketCap';
const COLS: Array<[SortKey, string]> = [['score', '종합'], ['momentum', '모멘텀'], ['trend', '추세'], ['quality', '재무'], ['valuation', '밸류'], ['liquidity', '유동성'], ['risk', '위험'], ['ret3m', '3M'], ['marketCap', '시총']];

function val(r: ScreenRow, k: SortKey): number | null {
  if (k === 'score') return r.score;
  if (k === 'ret3m') return r.metrics?.ret3m ?? null;
  if (k === 'marketCap') return r.metrics?.marketCap ?? null;
  return r.factors?.[k] ?? null;
}

export function Discover() {
  const { rows, universe, setUniverse, runScreen, screening, select, setPage, watchlist, mode } = useTerminal();
  const [filter, setFilter] = useState<'all' | 'growth' | 'value' | 'large' | 'small' | 'watch'>('all');
  const [risk, setRisk] = useState<'any' | 'LOW' | 'MODERATE' | 'HIGH'>('any');
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'score', desc: true });
  const [add, setAdd] = useState('');

  const list = useMemo(() => {
    const f = filterRows(rows, filter, watchlist).filter((r) => risk === 'any' || r.riskLevel === risk);
    return [...f].sort((a, b) => {
      const va = val(a, sort.k);
      const vb = val(b, sort.k);
      if (va === null) return 1;
      if (vb === null) return -1;
      return sort.desc ? vb - va : va - vb;
    });
  }, [rows, filter, risk, sort, watchlist]);

  const addSymbols = () => {
    const syms = add.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s));
    if (syms.length) setUniverse([...universe, ...syms]);
    setAdd('');
  };

  return (
    <>
      <BreakoutScanner />
      <div style={{ marginTop: 12 }}><UniverseRankings /></div>
      <section className="panel" style={{ marginTop: 12 }}>
        <PanelHead kicker="ON-DEMAND" title="관심 유니버스 실시간 계산" right={<ModeBadge />} />
        <div className="universe-bar">
          <div className="chips">
            {universe.map((s) => (
              <span key={s} className="chip">{s}{mode === 'live' && <button onClick={() => setUniverse(universe.filter((x) => x !== s))} aria-label={`${s} 제거`}><X size={10} /></button>}</span>
            ))}
          </div>
          {mode === 'live' && (
            <div className="universe-actions">
              <input value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSymbols()} placeholder="티커 추가 (예: CRWD, ASTS)" />
              <button className="secondary-button" onClick={addSymbols}><Plus size={12} /> 추가</button>
              <button className="secondary-button" onClick={() => setUniverse(DEFAULT_LIVE_UNIVERSE)}><RotateCcw size={12} /> 기본값</button>
            </div>
          )}
          <button className="primary-button" onClick={runScreen} disabled={screening.running}><RefreshCw size={12} className={screening.running ? 'spin' : ''} /> {screening.running ? `계산 중 ${screening.done}/${screening.total}` : '스크리닝 실행'}</button>
        </div>
        <p className="footnote pad">미국 전체 상장 종목(약 1만 개)을 한 번에 스캔하려면 서버 측 배치 수집(Supabase 저장)이 필요합니다. 현재는 유니버스 단위로 무료 데이터를 실시간 계산합니다. Cloudflare 무료 플랜의 요청 한도 때문에 4종목씩 나눠 계산합니다.</p>
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <PanelHead kicker="RANKING" title="퀀트 스크리너" />
        <div className="event-filter">
          {(['all', 'growth', 'value', 'large', 'small', 'watch'] as const).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{{ all: '전체', growth: '성장주', value: '가치주', large: '대형주', small: '중소형주', watch: '관심종목' }[f]}</button>
          ))}
          <span className="sep" />
          {(['any', 'LOW', 'MODERATE', 'HIGH'] as const).map((r) => (
            <button key={r} className={risk === r ? 'active' : ''} onClick={() => setRisk(r)}>{r === 'any' ? '위험 전체' : `위험 ${RISK_LABEL[r]}`}</button>
          ))}
        </div>
        <div className="table-wrap">
          <table className="data-table screener">
            <thead>
              <tr>
                <th>#</th><th>종목</th><th>가격</th>
                {COLS.map(([k, l]) => <th key={k} className="sortable" onClick={() => setSort({ k, desc: sort.k === k ? !sort.desc : true })}>{l}{sort.k === k ? (sort.desc ? ' ▾' : ' ▴') : ''}</th>)}
                <th>규모/스타일</th><th>등급</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.symbol} onClick={() => { select(r.symbol); setPage('research'); }} className="clickable">
                  <td>{r.rank ?? '—'}</td>
                  <td><b>{r.symbol}</b><small>{r.name ?? r.error}</small></td>
                  <td>{r.lastClose ? `$${fmtPrice(r.lastClose.close)}` : '—'}</td>
                  <td className="heat"><span style={{ background: heatColor(r.score) }}>{r.score ?? '—'}</span></td>
                  {(['momentum', 'trend', 'quality', 'valuation', 'liquidity'] as const).map((k) => <td key={k} className="heat"><span style={{ background: heatColor(r.factors?.[k]) }}>{r.factors?.[k] == null ? 'N/A' : Math.round(r.factors[k] as number)}</span></td>)}
                  <td className={r.riskLevel === 'HIGH' ? 'down' : r.riskLevel === 'MODERATE' ? 'neutral' : 'up'}>{r.riskLevel ? RISK_LABEL[r.riskLevel] : '—'}</td>
                  <td className={signClass(r.metrics?.ret3m)}>{fmtPct(r.metrics?.ret3m)}</td>
                  <td>{fmtUsd(r.metrics?.marketCap)}</td>
                  <td>{r.size ? SIZE_LABEL[r.size] : '—'} · {r.style ? STYLE_LABEL[r.style] : '—'}</td>
                  <td>{r.rating ?? '—'}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={15} className="muted">{screening.running ? '계산 중…' : '결과 없음'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel method" style={{ marginTop: 12 }}>
        <PanelHead kicker="METHODOLOGY" title="점수 산출 방식" />
        <div className="method-grid">
          <div><b>모멘텀 22%</b><p>3개월 수익률, 12-1개월 수익률, 52주 고점 대비 위치</p></div>
          <div><b>추세 18%</b><p>종가 vs SMA50/200, 이평 정배열, RSI 영역 (과열 감점)</p></div>
          <div><b>재무 품질 20%</b><p>SEC XBRL 연간 매출 성장, 순이익률, 현금 런웨이, 주식수 증가(희석)</p></div>
          <div><b>밸류에이션 15%</b><p>시가총액(유통주식수×종가) 대비 매출(P/S)·순이익(P/E)</p></div>
          <div><b>유동성 10%</b><p>20일 평균 거래대금 (로그 스케일)</p></div>
          <div><b>안정성 15%</b><p>100 − 위험(변동성, 1년 최대낙폭, 유동성, 런웨이, 최근 1년 희석 공시)</p></div>
        </div>
        <p className="footnote pad">결측 팩터는 제외하고 남은 가중치로 정규화하며 커버리지(%)를 표시합니다. 점수는 상대적 매력도이며 상승 확률이 아닙니다. LLM 기반 서술형 분석은 아직 연결되지 않았고, 현재 “AI” 점수는 결정적 규칙 기반 퀀트 모델입니다.</p>
      </section>
    </>
  );
}
