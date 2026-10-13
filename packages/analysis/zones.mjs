// ALPHA TERMINAL — buy zones other than the base breakout:
//   1. 눌림목 (pullback): a stock in an established uptrend that pulled back 5–25% from its
//      recent high into support (20 EMA / 50 SMA / former resistance / bullish order block).
//   2. 주봉·월봉 바닥 (higher-timeframe bottom): a stock that fell hard, stopped making new
//      lows and is trading near that low on the weekly or monthly chart.
// Each result carries a concrete buy point (매수타점): trigger or limit zone, stop, targets, R.
// Every check uses bars up to and including the last bar only.

import { sma, ema, rsi, atr, marketStructure, orderBlocks, swings } from './indicators.mjs';
import { trendTemplate } from './setups.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const $ = (v) => `$${v >= 1000 ? v.toFixed(0) : v.toFixed(2)}`;

/** Calendar-month bars (UTC). time = first day of the month. */
export function resampleMonthly(bars) {
  const out = [];
  let cur = null;
  for (const b of bars) {
    const d = new Date(b.time * 1000);
    const key = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
    if (!cur || cur.time !== key) {
      if (cur) out.push(cur);
      cur = { time: key, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Long monthly history (e.g. Alpaca 1Month bars) + daily bars: months covered by the daily
 * series are rebuilt from it (so the current month is always up to date).
 */
export function mergeMonthly(longMonthly, daily) {
  const fromDaily = resampleMonthly(daily);
  if (!fromDaily.length) return longMonthly ?? [];
  // the first daily month may be partial — keep the long series for it
  const firstFull = fromDaily.length > 1 ? fromDaily[1].time : fromDaily[0].time;
  const norm = (longMonthly ?? []).map((b) => { const d = new Date(b.time * 1000); return { ...b, time: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 }; });
  return [...norm.filter((b) => b.time < firstFull), ...fromDaily.filter((b) => b.time >= firstFull)];
}

function plan({ entry, stop, stopKind, target, target2 = null, how, zone = null, entryType }) {
  const riskPct = entry > stop ? (entry - stop) / entry : null;
  return {
    entry, stop, stopKind, target, target2, zone, entryType, how,
    riskPct, rMultiple: riskPct ? (target - entry) / (entry - stop) : null,
    note: riskPct !== null && riskPct > 0.12 ? '손절폭이 넓음 — 비중 축소' : null,
  };
}

// ---------------------------------------------------------------- 1. pullback

export const PULLBACK_RULES = { highLookback: 63, minDepth: 0.05, maxDepth: 0.25, minAdvance: 1.3, supportTol: 0.02, approachPct: 0.05 };

/**
 * stage: BOUNCE (지지 확인 후 반등 시작), AT_SUPPORT (지지선 도달), APPROACHING (지지선 접근), NONE.
 */
export function detectPullback(bars, rules = PULLBACK_RULES) {
  const n = bars.length;
  if (n < 220) return { stage: 'NONE', reason: '데이터 부족' };
  const c = bars.map((b) => b.close);
  const s50 = sma(c, 50);
  const s200 = sma(c, 200);
  const e20 = ema(c, 20);
  const r14 = rsi(c, 14);
  const a = atr(bars, 14)[n - 1] ?? 0;
  const last = bars[n - 1];
  const prev = bars[n - 2];
  if (!(last.close > s200[n - 1] && s50[n - 1] > s200[n - 1] && s200[n - 1] > s200[n - 22])) return { stage: 'NONE', reason: '상승 추세 아님' };

  let hiIdx = n - rules.highLookback;
  for (let i = n - rules.highLookback; i < n; i++) if (bars[i].high >= bars[hiIdx].high) hiIdx = i;
  const hi = bars[hiIdx].high;
  if (n - 1 - hiIdx < 3) return { stage: 'NONE', reason: '아직 고점 부근' };
  const priorLow = Math.min(...bars.slice(Math.max(0, n - 252), hiIdx + 1).map((b) => b.low));
  if (hi / priorLow < rules.minAdvance) return { stage: 'NONE', reason: '직전 상승폭 부족' };
  const after = bars.slice(hiIdx + 1);
  const pullLow = Math.min(...after.map((b) => b.low));
  const depth = 1 - pullLow / hi;
  if (depth < rules.minDepth || depth > rules.maxDepth) return { stage: 'NONE', reason: `조정폭 ${(depth * 100).toFixed(0)}%` };
  if (last.close > hi * 0.97) return { stage: 'NONE', reason: '이미 전고점 회복' };

  // support levels
  const supports = [
    { kind: '20일 EMA', price: e20[n - 1] },
    { kind: '50일선', price: s50[n - 1] },
  ];
  const piv = swings(bars.slice(0, hiIdx), 5, 5).filter((s) => s.type === 'high' && s.price < hi * 0.95 && s.index > n - 252);
  const broken = piv.filter((s) => bars.slice(s.index + 1, hiIdx + 1).some((b) => b.close > s.price)).sort((x, y) => y.price - x.price);
  if (broken[0]) supports.push({ kind: '이전 고점(저항→지지)', price: broken[0].price });
  const structure = marketStructure(bars, { lastBarClosed: true });
  const ob = orderBlocks(bars, structure.events).filter((o) => o.direction === 'bull' && o.index > n - 126 && o.top < hi && (o.mitigatedIndex === null || o.mitigatedIndex > hiIdx)).sort((x, y) => y.top - x.top)[0];
  if (ob) supports.push({ kind: '오더블록', price: ob.top, bottom: ob.bottom });
  const valid = supports.filter((s) => isNum(s.price) && s.price < hi * 0.98);

  const tol = rules.supportTol;
  const recent = bars.slice(-3);
  const touched = valid.filter((s) => recent.some((b) => b.low <= s.price * (1 + tol)) && last.close >= s.price * (1 - tol)).sort((x, y) => y.price - x.price);
  const below = valid.filter((s) => s.price < last.close && s.price >= last.close * (1 - rules.approachPct)).sort((x, y) => y.price - x.price);
  const support = touched[0] ?? below[0] ?? null;
  if (!support) return { stage: 'NONE', reason: '근처 지지선 없음' };
  const confluence = valid.filter((s) => Math.abs(s.price / support.price - 1) <= tol);

  const range = last.high - last.low;
  const hammer = range > 0 && (Math.min(last.open, last.close) - last.low) >= 2 * Math.abs(last.close - last.open) && last.close >= last.low + range * 0.6;
  const reversal = last.close > prev.high || (hammer && last.low <= support.price * (1 + tol));
  const stage = touched.length ? (reversal ? 'BOUNCE' : 'AT_SUPPORT') : 'APPROACHING';

  const volPull = mean(after.slice(0, stage === 'BOUNCE' ? -1 : undefined).map((b) => b.volume));
  const volBefore = mean(bars.slice(Math.max(0, hiIdx - 50), hiIdx).map((b) => b.volume));
  const volumeDryUp = isNum(volPull) && isNum(volBefore) && volPull < volBefore * 0.8;
  const rsiNow = r14[n - 1];
  const rsiCooled = isNum(rsiNow) && rsiNow >= 35 && rsiNow <= 55;

  const stopBase = Math.min(pullLow, support.bottom ?? support.price);
  const stop = stopBase - a * 0.3;
  const target2 = hi + (hi - pullLow);
  let p;
  if (stage === 'APPROACHING') {
    const zone = [support.price, support.price * 1.015];
    p = plan({ entry: zone[1], stop, stopKind: `${support.kind} 아래`, target: hi, target2, zone, entryType: 'limit',
      how: `${support.kind} ${$(zone[0])}~${$(zone[1])} 구간까지 내려오면 지정가 분할매수 · 종가가 ${$(stop)} 아래면 무효` });
  } else {
    p = plan({ entry: last.high, stop, stopKind: stopBase === pullLow ? '눌림 저점 아래' : `${support.kind} 아래`, target: hi, target2, entryType: 'buy-stop',
      how: stage === 'BOUNCE'
        ? `반등 확인됨 — 다음 거래일 오늘 고가 ${$(last.high)} 위에서 매수 · 손절 ${$(stop)}`
        : `${support.kind} ${$(support.price)}에서 지지 테스트 중 — 고가 ${$(last.high)} 돌파 시 매수 (반등 확인) · 손절 ${$(stop)}` });
  }

  const tt = trendTemplate(bars);
  const score = Math.round((tt.passed / 8) * 25)
    + { BOUNCE: 25, AT_SUPPORT: 18, APPROACHING: 10 }[stage]
    + Math.min(3, confluence.length) * 5
    + (volumeDryUp ? 10 : 0) + (rsiCooled ? 5 : 0)
    + (depth >= 0.08 && depth <= 0.2 ? 10 : 0)
    + (p.rMultiple !== null && p.rMultiple >= 2 ? 10 : 0);

  return {
    stage, high: hi, highAgeBars: n - 1 - hiIdx, pullLow, depth, currentDepth: 1 - last.close / hi,
    support: { kind: support.kind, price: support.price }, confluence: confluence.map((s) => s.kind),
    volumeDryUp, rsi: rsiNow, rsiCooled, trend: { passed: tt.passed, total: 8 }, plan: p, score: Math.min(100, score),
  };
}

// ---------------------------------------------------------------- 2. weekly / monthly bottom

export const BOTTOM_RULES = {
  weekly: { lookback: 104, minDecline: 0.35, minLowAge: 4, nearPct: 0.2, ma: 10, maSlow: 30, minBars: 60, stopPct: 0.03, label: '주봉', unit: '주' },
  monthly: { lookback: 60, minDecline: 0.5, minLowAge: 2, nearPct: 0.25, ma: 10, maSlow: 20, minBars: 30, stopPct: 0.05, label: '월봉', unit: '개월' },
};

/**
 * htf: weekly or monthly bars. stage: TURNING (바닥 확인 후 전환 시작), AT_BOTTOM (바닥권, 신호 대기), NONE.
 */
export function detectHtfBottom(htf, tf = 'weekly') {
  const r = BOTTOM_RULES[tf];
  const n = htf.length;
  if (n < r.minBars) return { stage: 'NONE', reason: '데이터 부족' };
  const start = Math.max(0, n - r.lookback);
  let hiIdx = start;
  for (let i = start; i < n; i++) if (htf[i].high >= htf[hiIdx].high) hiIdx = i;
  let loIdx = hiIdx;
  for (let i = hiIdx; i < n; i++) if (htf[i].low <= htf[loIdx].low) loIdx = i;
  const hi = htf[hiIdx].high;
  const lo = htf[loIdx].low;
  const decline = 1 - lo / hi;
  if (decline < r.minDecline) return { stage: 'NONE', reason: `하락폭 ${(decline * 100).toFixed(0)}%` };
  const lowAge = n - 1 - loIdx;
  if (lowAge < r.minLowAge) return { stage: 'NONE', reason: '아직 신저가 진행 중' };
  const last = htf[n - 1];
  const above = last.close / lo - 1;
  if (above > r.nearPct) return { stage: 'NONE', reason: '이미 바닥에서 멀어짐' };

  const c = htf.map((b) => b.close);
  const ma = sma(c, r.ma);
  const maSlow = sma(c, r.maSlow);
  const r14 = rsi(c, 14);
  const aboveMa = isNum(ma[n - 1]) && last.close > ma[n - 1];
  const maRising = isNum(ma[n - 2]) && ma[n - 1] > ma[n - 2];
  const tail = Math.max(2, Math.floor(lowAge / 2));
  const higherLow = lowAge >= 4 && Math.min(...htf.slice(-tail).map((b) => b.low)) > lo * 1.03;
  const volDecline = mean(htf.slice(hiIdx, loIdx + 1).map((b) => b.volume));
  const volumeDryUp = isNum(volDecline) && mean(htf.slice(-4).map((b) => b.volume)) < volDecline * 0.7;
  const rsiRecover = isNum(r14[loIdx]) && isNum(r14[n - 1]) && r14[loIdx] < 35 && r14[n - 1] > 40;
  const stage = aboveMa && (higherLow || maRising) ? 'TURNING' : 'AT_BOTTOM';

  // confirmation trigger: highest high since the low (excluding the current bar), at most 8 bars back
  const since = htf.slice(Math.max(loIdx + 1, n - 9), n - 1);
  const pivot = since.length ? Math.max(...since.map((b) => b.high)) : null;
  const stop = lo * (1 - r.stopPct);
  const half = lo + (hi - lo) * 0.5;
  const slow = maSlow[n - 1];
  const zone = [lo, lo * 1.08];
  let p;
  if (stage === 'TURNING') {
    const entry = pivot && last.close < pivot ? pivot : last.close;
    const target = isNum(slow) && slow > entry * 1.05 ? slow : half;
    p = plan({ entry, stop, stopKind: `${r.label} 바닥 -${r.stopPct * 100}%`, target, target2: half, zone, entryType: entry === last.close ? 'market' : 'buy-stop',
      how: entry === last.close
        ? `${r.label} 전환 시작 — 현재가 부근 매수 가능, 바닥 ${$(zone[0])}~${$(zone[1])}로 밀리면 추가 · 손절 ${$(stop)}`
        : `${r.label} 반등 고점 ${$(pivot)} 돌파 시 매수 (전환 확인) · 손절 ${$(stop)}` });
  } else {
    const entry = Math.min(last.close, zone[1]);
    const target = isNum(slow) && slow > entry * 1.05 ? slow : half;
    p = plan({ entry, stop, stopKind: `${r.label} 바닥 -${r.stopPct * 100}%`, target, target2: half, zone, entryType: 'zone',
      how: `${r.label} 바닥 ${$(zone[0])}~${$(zone[1])} 구간 분할매수(1/3씩)${pivot ? ` · 확인 후 매수는 ${$(pivot)} 돌파 시` : ''} · 손절 ${$(stop)}` });
  }

  const score = Math.round(Math.min(1, (decline - r.minDecline) / 0.4) * 10)
    + Math.round(Math.min(1, lowAge / (r.minLowAge * 3)) * 15)
    + (higherLow ? 15 : 0) + (aboveMa ? 15 : 0) + (maRising ? 5 : 0)
    + (volumeDryUp ? 10 : 0) + (rsiRecover ? 10 : 0)
    + (stage === 'TURNING' ? 20 : 5);

  return {
    stage, timeframe: tf, high: hi, low: lo, decline, lowAgeBars: lowAge, lowAgeLabel: `${lowAge}${r.unit} 전`, aboveLow: above,
    higherLow, aboveMa, maRising, volumeDryUp, rsiRecover, pivot, plan: p, score: Math.min(100, score),
  };
}

