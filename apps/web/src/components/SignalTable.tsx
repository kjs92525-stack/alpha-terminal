import type { Analysis, Bar } from '../lib/types';
import { fmtPrice } from '../lib/format';

const t = (bars: Bar[], i: number, intraday: boolean) => {
  const b = bars[i];
  if (!b) return '—';
  const d = new Date(b.time * 1000);
  return intraday ? d.toLocaleString('en-CA', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : d.toISOString().slice(0, 10);
};

/** Signals with the bar where they formed vs. the bar where they became knowable. */
export function SignalTable({ bars, analysis, intraday }: { bars: Bar[]; analysis: Analysis; intraday: boolean }) {
  const rows = [
    ...analysis.structure.events.map((e) => ({ k: `s${e.index}${e.direction}`, type: e.kind, dir: e.direction, at: e.swingIndex, conf: e.confirmedIndex, price: fmtPrice(e.level), state: e.provisional ? '미확정' : '확정', live: true })),
    ...analysis.fvg.map((g) => ({ k: `f${g.index}`, type: 'FVG', dir: g.direction, at: g.index, conf: g.confirmedIndex, price: `${fmtPrice(g.bottom)}–${fmtPrice(g.top)}`, state: g.provisional ? '미확정' : g.filledIndex !== null ? '충족됨' : '확정·미충족', live: g.filledIndex === null })),
    ...analysis.orderBlocks.map((o) => ({ k: `o${o.index}${o.direction}`, type: `OB(${o.source})`, dir: o.direction, at: o.index, conf: o.confirmedIndex, price: `${fmtPrice(o.bottom)}–${fmtPrice(o.top)}`, state: o.provisional ? '미확정' : o.mitigatedIndex !== null ? '소진됨' : '확정·유효', live: o.mitigatedIndex === null })),
  ].sort((a, b) => b.conf - a.conf).slice(0, 30);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>신호</th><th>방향</th><th>기준 봉</th><th>확정 봉</th><th>가격/구간</th><th>상태</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className={r.live ? '' : 'dim'}>
              <td><b>{r.type}</b></td>
              <td className={r.dir === 'bull' ? 'up' : 'down'}>{r.dir === 'bull' ? '상방' : '하방'}</td>
              <td>{t(bars, r.at, intraday)}</td>
              <td>{t(bars, r.conf, intraday)}</td>
              <td>{r.price}</td>
              <td><span className={`state ${r.state === '미확정' ? 'prov' : ''}`}>{r.state}</span></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="muted">감지된 신호 없음</td></tr>}
        </tbody>
      </table>
      <p className="footnote">스윙 기반 신호(BOS/CHoCH/OB)는 피벗 오른쪽 3봉이 마감된 후에만 확정되며, 기준 봉과 확정 봉 사이 구간에서는 차트에 표시되지 않았어야 할 정보입니다. 백테스트 시 반드시 <b>확정 봉</b> 기준으로 진입을 평가하세요.</p>
    </div>
  );
}
