import type { Analysis, Bar } from '../lib/types';
import { fmtPrice } from '../lib/format';

interface Line { tone: 'up' | 'down' | 'neutral'; text: string }

/** Rule-based reading of the latest confirmed technical state. Every line maps to a computed value. */
export function technicalReading(bars: Bar[], a: Analysis, lastBarClosed: boolean): Line[] {
  const out: Line[] = [];
  const n = bars.length;
  if (n < 30) return [{ tone: 'neutral', text: '데이터가 부족합니다 (30봉 미만)' }];
  const i = lastBarClosed ? n - 1 : n - 2;
  const c = bars[i].close;
  const regime = { uptrend: '상승 추세', downtrend: '하락 추세', range: '횡보/전환 구간', insufficient: '판단 불가 (이평 데이터 부족)' }[a.regime.regime];
  out.push({ tone: a.regime.regime === 'uptrend' ? 'up' : a.regime.regime === 'downtrend' ? 'down' : 'neutral', text: `추세 체계: ${regime}${a.regime.sma50 ? ` (SMA50 ${fmtPrice(a.regime.sma50)})` : ''}` });
  const r = a.rsi14[i];
  if (r !== null) out.push({ tone: r > 70 ? 'down' : r < 30 ? 'up' : 'neutral', text: `RSI(14) ${r.toFixed(1)} — ${r > 70 ? '과매수, 추격 위험' : r < 30 ? '과매도, 반등 관찰' : r >= 50 ? '강세 영역' : '약세 영역'}` });
  const h = a.macd.hist[i];
  const hp = a.macd.hist[i - 1];
  if (h !== null && hp !== null) out.push({ tone: h > 0 ? 'up' : 'down', text: `MACD 히스토그램 ${h > 0 ? '양(+)' : '음(-)'}${(h > 0) !== (hp > 0) ? ' — 직전 봉에서 교차' : h > hp ? ', 확대' : ', 축소'}` });
  const ev = [...a.structure.events].reverse().find((e) => !e.provisional);
  if (ev) out.push({ tone: ev.direction === 'bull' ? 'up' : 'down', text: `최근 확정 구조: ${ev.kind} ${ev.direction === 'bull' ? '상방' : '하방'} @ ${fmtPrice(ev.level)} (${n - 1 - ev.index}봉 전)` });
  const prov = a.structure.events.find((e) => e.provisional);
  if (prov) out.push({ tone: 'neutral', text: `미확정 신호: ${prov.kind} ${prov.direction === 'bull' ? '상방' : '하방'} — 현재 봉 마감 전, 확정 아님` });
  const atr = a.atr14[i];
  if (atr !== null) out.push({ tone: 'neutral', text: `ATR(14) ${fmtPrice(atr)} (${((atr / c) * 100).toFixed(1)}%) — 손절 폭 참고` });
  const res = a.levels.filter((l) => l.kind === 'resistance').sort((x, y) => x.price - y.price)[0];
  const sup = a.levels.filter((l) => l.kind === 'support').sort((x, y) => y.price - x.price)[0];
  if (res || sup) out.push({ tone: 'neutral', text: `가까운 지지 ${sup ? fmtPrice(sup.price) : '—'} / 저항 ${res ? fmtPrice(res.price) : '—'}` });
  if (a.profile.poc !== null) out.push({ tone: c >= a.profile.poc ? 'up' : 'down', text: `거래량 POC ${fmtPrice(a.profile.poc)} ${c >= a.profile.poc ? '위' : '아래'}에서 거래 (가치영역 ${fmtPrice(a.profile.valueAreaLow)}–${fmtPrice(a.profile.valueAreaHigh)})` });
  const openFvg = a.fvg.filter((g) => g.filledIndex === null && !g.provisional);
  if (openFvg.length) out.push({ tone: 'neutral', text: `미충족 FVG ${openFvg.length}개 (상방 ${openFvg.filter((g) => g.direction === 'bull').length} / 하방 ${openFvg.filter((g) => g.direction === 'bear').length})` });
  return out;
}

export function TechSummary({ bars, analysis, lastBarClosed }: { bars: Bar[]; analysis: Analysis; lastBarClosed: boolean }) {
  return (
    <ul className="tech-lines">
      {technicalReading(bars, analysis, lastBarClosed).map((l, i) => <li key={i} className={l.tone}><span>{l.tone === 'up' ? '▲' : l.tone === 'down' ? '▼' : '◆'}</span>{l.text}</li>)}
    </ul>
  );
}
