import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useTerminal } from '../lib/store';
import { fetchLatest, NoSnapshotError, FACTOR_KO, SECTOR_KO, DATA_HISTORY_URL, type Horizon, type Latest } from '../lib/snapshot';
import { fmtEt, fmtPct, fmtPrice, fmtUsd, scoreClass } from '../lib/format';
import { ErrorBox, Loading, PanelHead } from './ui';

const H_LABEL: Record<Horizon, string> = { mid: '중장기 (20–60일) · 1순위', short: '단기 (1–5일) · 2순위' };

export function UniverseRankings() {
  const { select, setPage } = useTerminal();
  const [data, setData] = useState<Latest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [h, setH] = useState<Horizon>('mid');
  const [sector, setSector] = useState('ALL');
  const [recsOnly, setRecsOnly] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetchLatest().then(setData).catch((e) => (e instanceof NoSnapshotError ? setMissing(true) : setErr(e.message)));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const recs = new Set(data.recommendations[h]);
    return data[h].filter((r) => (!recsOnly || recs.has(r.symbol)) && (sector === 'ALL' || r.sector === sector) && (!q || r.symbol.includes(q.toUpperCase()) || (r.name ?? '').toUpperCase().includes(q.toUpperCase())));
  }, [data, h, sector, recsOnly, q]);
  const sectors = useMemo(() => (data ? [...new Set(data[h].map((r) => r.sector))].sort() : []), [data, h]);
  const factorKeys = data ? Object.keys(data.weights[h]) : [];

  return (
    <section className="panel">
      <PanelHead kicker="ALL US STOCKS · NIGHTLY" title="전 종목 랭킹" right={data && <span className="live-badge">기준일 {data.asOf}</span>} />
      {!data && !err && !missing && <Loading label="야간 랭킹 불러오기" />}
      {err && <ErrorBox error={err} />}
      {missing && (
        <div className="pad-box">
          <b>아직 첫 야간 배치가 실행되지 않았습니다.</b>
          <ol className="steps">
            <li>Alpaca 무료 계정 생성 → Paper Trading API 키 발급</li>
            <li>GitHub 저장소 Settings → Secrets → Actions에 <code>ALPACA_KEY_ID</code>, <code>ALPACA_SECRET_KEY</code>, <code>SEC_USER_AGENT</code> 등록</li>
            <li>Actions → <b>Nightly pipeline</b> → Run workflow (이후 평일 장 마감 후 자동 실행)</li>
          </ol>
        </div>
      )}
      {data && (
        <>
          <div className="event-filter">
            {(['mid', 'short'] as Horizon[]).map((x) => <button key={x} className={h === x ? 'active' : ''} onClick={() => setH(x)}>{H_LABEL[x]}</button>)}
            <span className="sep" />
            <button className={recsOnly ? 'active' : ''} onClick={() => setRecsOnly(!recsOnly)}>추천 종목만 ({data.recommendations[h].length})</button>
            <select className="mini-select" value={sector} onChange={(e) => setSector(e.target.value)} aria-label="섹터">
              <option value="ALL">전체 섹터</option>
              {sectors.map((s) => <option key={s} value={s}>{SECTOR_KO[s] ?? s}</option>)}
            </select>
            <input className="mini-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="티커/이름" />
          </div>
          <div className="table-wrap">
            <table className="data-table screener">
              <thead>
                <tr>
                  <th>#</th><th>종목</th><th>섹터</th><th>종가</th><th>점수</th><th>상위%</th>
                  {factorKeys.map((k) => <th key={k}>{FACTOR_KO[k] ?? k} <small className="muted">{Math.round(data.weights[h][k] * 100)}%</small></th>)}
                  <th>{h === 'mid' ? '12-1M' : '5D'}</th><th>시총</th><th>비고</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r) => (
                  <tr key={r.symbol} className="clickable" onClick={() => { select(r.symbol); setPage('research'); }}>
                    <td>{r.rank}</td>
                    <td><b>{r.symbol}</b><small>{r.name}</small></td>
                    <td>{SECTOR_KO[r.sector] ?? r.sector}</td>
                    <td>${fmtPrice(r.price)}</td>
                    <td className={scoreClass(r.score)}><b>{r.score.toFixed(1)}</b></td>
                    <td>{Math.max(1, Math.ceil((r.rank / data.ranked[h]) * 100))}%</td>
                    {factorKeys.map((k) => <td key={k} className={scoreClass(r.factors[k])}>{r.factors[k] ?? 'N/A'}</td>)}
                    <td>{fmtPct((h === 'mid' ? r.f.mom_12_1 : r.f.ret_5) as number | null)}</td>
                    <td>{fmtUsd(r.mcap)}</td>
                    <td className="muted">{r.excluded.length ? `제외: ${r.excluded.join(', ')}` : (r.f.recent_events as string[] | undefined)?.length ? `최근 이벤트: ${(r.f.recent_events as string[]).join(', ')}` : ''}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={12} className="muted">결과 없음</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="footnote pad">
            유니버스 {data.universe.toLocaleString()}개 중 {data.ranked[h].toLocaleString()}개 순위화 · 모델 {data.model} · 생성 {fmtEt(data.generatedAt)} · 점수 = 전 종목 대비 백분위의 가중평균(0–100).
            가중치는 학계 팩터 연구 기반 <b>사전값이며 아직 이 데이터로 백테스트 검증 전</b>입니다. 추천 목록은 매일 변경 불가 원장에 기록되어 성과가 자동 추적됩니다{' '}
            <a className="text-link inline" href={DATA_HISTORY_URL} target="_blank" rel="noreferrer">원장 이력 <ExternalLink size={10} /></a>
          </p>
        </>
      )}
    </section>
  );
}
