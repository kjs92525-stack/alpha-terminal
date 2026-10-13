import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { fetchPerformance, NoSnapshotError, DATA_HISTORY_URL, type Performance as Perf } from '../lib/snapshot';
import { ErrorBox, Loading, PanelHead } from '../components/ui';
import { fmtEt, fmtPct, signClass } from '../lib/format';

const BOOKS: Array<[string, string]> = [['setups_20d', '바닥 돌파 · 20거래일'], ['setups_60d', '바닥 돌파 · 60거래일'], ['pullback_20d', '눌림목 · 20거래일'], ['pullback_60d', '눌림목 · 60거래일'], ['bottom_20d', '주봉·월봉 바닥 · 20거래일'], ['bottom_60d', '주봉·월봉 바닥 · 60거래일'], ['mid_20d', '중장기 · 20거래일'], ['mid_60d', '중장기 · 60거래일'], ['short_5d', '단기 · 5거래일'], ['short_1d', '단기 · 1거래일']];

export function Performance() {
  const [data, setData] = useState<Perf | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [key, setKey] = useState('setups_20d');
  useEffect(() => { fetchPerformance().then(setData).catch((e) => (e instanceof NoSnapshotError ? setMissing(true) : setErr(e.message))); }, []);

  return (
    <>
      <section className="panel">
        <PanelHead kicker="TRACK RECORD" title="추천 성과 검증 (SPY 대비)" right={<a className="text-link" href={DATA_HISTORY_URL} target="_blank" rel="noreferrer">원장 변경 이력 <ExternalLink size={11} /></a>} />
        <div className="pad-box muted">
          매일 장 마감 후 추천 목록을 공개 원장(<code>data</code> 브랜치)에 기록하고 수정하지 않습니다. 성과는 <b>다음 거래일 시가 매수 → N거래일 후 종가 매도</b>를 가정하고, 같은 기간 SPY 수익률을 뺀 초과수익으로 계산합니다. 수수료·슬리피지 미반영, 동일 비중.
          일별 코호트는 보유 기간이 겹치므로 서로 독립적인 표본이 아닙니다.
        </div>
        {!data && !err && !missing && <Loading />}
        {err && <ErrorBox error={err} />}
        {missing && <div className="pad-box">아직 기록된 추천이 없습니다. 야간 배치가 처음 실행되면 이 화면에 성과가 누적됩니다.</div>}
        {data && (
          <div className="kpi-grid perf-grid">
            {BOOKS.map(([k, label]) => {
              const s = data.summary[k];
              const pend = data.detail.filter((d) => d.key === k && d.status !== 'complete').length;
              return (
                <button key={k} className={`kpi-card perf-card ${key === k ? 'sel' : ''}`} onClick={() => setKey(k)}>
                  <div className="kpi-top">{label}</div>
                  <div className="kpi-value"><strong className={signClass(s?.meanExcess)}>{s ? fmtPct(s.meanExcess, 2) : '—'}</strong><span>평균 초과수익</span></div>
                  <div className="kpi-foot">
                    {s ? `완료 ${s.cohorts}회 · SPY 상회 ${s.cohortsBeatingSpy}회 · 종목 적중률 ${fmtPct(s.meanHitRate, 0).replace('+', '')}` : '완료된 코호트 없음'} · 대기 {pend}
                  </div>
                  {s?.note && <div className="neutral small">{s.note}</div>}
                </button>
              );
            })}
          </div>
        )}
      </section>
      {data && (
        <section className="panel" style={{ marginTop: 12 }}>
          <PanelHead kicker="COHORTS" title={`일별 추천 코호트 · ${BOOKS.find((b) => b[0] === key)?.[1]}`} />
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>추천일</th><th>상태</th><th>종목 수</th><th>포트폴리오</th><th>SPY</th><th>초과수익</th><th>적중률</th><th>모델</th></tr></thead>
              <tbody>
                {data.detail.filter((d) => d.key === key).sort((a, b) => b.asOf.localeCompare(a.asOf)).map((d) => (
                  <tr key={d.asOf} className={d.status === 'pending' ? 'dim' : ''}>
                    <td>{d.asOf}</td>
                    <td>{d.status === 'complete' ? '완료' : d.status === 'partial' ? '일부' : '대기'}</td>
                    <td>{d.n ?? '—'}</td>
                    <td className={signClass(d.portfolioReturn)}>{fmtPct(d.portfolioReturn, 2)}</td>
                    <td>{fmtPct(d.spyReturn, 2)}</td>
                    <td className={signClass(d.excess)}><b>{fmtPct(d.excess, 2)}</b></td>
                    <td>{d.hitRate !== undefined ? `${Math.round(d.hitRate * 100)}%` : '—'}</td>
                    <td className="muted">{d.model ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote pad">평가 시각 {fmtEt(data.evaluatedAt)} · 원장 {data.ledgers}개 · 기준 {data.benchmark}. 표본이 30개 코호트 미만이면 결론을 내리지 마세요.</p>
        </section>
      )}
    </>
  );
}
