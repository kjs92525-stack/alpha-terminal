// ALPHA TERMINAL — sector / theme cycle.
// Each group is read from a liquid ETF's own chart (no holdings data needed), placed in a cycle
// phase, and scanner candidates are attached to the group whose daily returns they track best.
// Phases (from the ETF's price vs its 50/200-day averages, 3/12-month returns, distance from the
// 2-year high and strength vs SPY):
//   EARLY  사이클 초입   — after a long slide, back above the 200-day with the 50-day turning up
//   BASING 바닥 다지기   — well off the highs, moving sideways around the 200-day
//   LEADING 상승 주도    — established uptrend, outperforming
//   LATE   과열·후반     — far above the 200-day / near highs after a big run
//   NEUTRAL 숨고르기     — a modest pullback or sideways drift without a clear direction
//   DOWN   하락          — clearly below the 200-day with the 50-day under it

import { sma, rsi, resampleWeekly } from './indicators.mjs';

export const SECTOR_ETFS = [
  ['XLK', '기술'], ['SMH', '반도체'], ['IGV', '소프트웨어'], ['XLC', '커뮤니케이션'],
  ['XLF', '금융'], ['KRE', '지방은행'], ['KIE', '보험'],
  ['XLV', '헬스케어'], ['XBI', '바이오'], ['IHI', '의료기기'],
  ['XLE', '에너지'], ['XOP', '석유 탐사·생산'], ['OIH', '석유 서비스'], ['URA', '우라늄·원전'], ['TAN', '태양광'],
  ['XLI', '산업재'], ['ITA', '방산·항공우주'], ['IYT', '운송'], ['JETS', '항공'], ['PAVE', '인프라'],
  ['XLY', '경기소비재'], ['XRT', '소매'], ['ITB', '주택건설'], ['XLP', '필수소비재'],
  ['XLB', '소재'], ['XME', '금속·광업'], ['COPX', '구리'], ['LIT', '리튬·배터리'], ['GDX', '금광'], ['SIL', '은광'],
  ['XLU', '유틸리티'], ['XLRE', '부동산'],
  ['UFO', '우주'], ['QTUM', '양자·차세대 컴퓨팅'], ['BOTZ', '로봇·AI'], ['BLOK', '블록체인'], ['ARKK', '혁신 성장'],
];

export const PHASE_KO = { EARLY: '가격 전환 초기', BASING: '가격 기반 형성', LEADING: '상승 진행', LATE: '가격 과열', NEUTRAL: '방향 미확인', DOWN: '하락 위험' };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const ret = (c, n) => (c.length > n && c[c.length - 1 - n] > 0 ? c[c.length - 1] / c[c.length - 1 - n] - 1 : null);

/** Cycle phase of one group from its daily bars (needs ~260+) and SPY. */
export function cyclePhase(bars, spy) {
  const n = bars.length;
  if (n < 260) return null;
  const c = bars.map((b) => b.close);
  const s50 = sma(c, 50);
  const s200 = sma(c, 200);
  const last = c[n - 1];
  const vs200 = last / s200[n - 1] - 1;
  const ma50vs200 = s50[n - 1] / s200[n - 1] - 1;
  const ma50Slope = s50[n - 1] / s50[n - 21] - 1;
  const ma200Slope = s200[n - 1] / s200[n - 21] - 1;
  const hi2y = Math.max(...bars.slice(-504).map((b) => b.high));
  const lo1y = Math.min(...bars.slice(-252).map((b) => b.low));
  const ddFromHigh = 1 - last / hi2y;
  const offLow = last / lo1y - 1;
  const ret3m = ret(c, 63);
  const ret12m = ret(c, 252);
  const ret24m = ret(c, 504);
  const spyBy = new Map(spy.map((b) => [b.time, b.close]));
  const rsSeries = bars.filter((b) => spyBy.has(b.time)).map((b) => b.close / spyBy.get(b.time));
  const rs3m = ret(rsSeries, 63);
  const rs12m = ret(rsSeries, 252);
  const rs24m = ret(rsSeries, 504);
  const weekly = resampleWeekly(bars).map(b=>b.close);
  const rsiW = rsi(weekly, 14).at(-1);
  const above200Days = (()=>{let k=0;for(let i=n-1;i>=0&&s200[i]&&c[i]>s200[i];i--)k++;return k;})();
  const m = { vs200, ma50vs200, ma50Slope, ma200Slope, ddFromHigh, offLow, ret3m, ret12m, ret24m, rs3m, rs12m, rs24m, rsiW, above200Days };

  // a group that already ran (beat the market by 15%p+ over two years, or up 50%+) is pulling
  // back, not bottoming; a laggard that rose with a rising market still counts as early
  // (a rebound off a deep low can be up a lot over 12 months and still be early)
  const ranAlready = isNum(ret24m) ? ret24m >= 0.5 || (rs24m ?? 0) >= 0.15 : (ret12m ?? 0) >= 0.1;
  const extended = offLow>0.4 || vs200>0.15 || (ret3m??0)>0.3;
  let phase;
  if (vs200 > 0.3 || (isNum(rsiW) && rsiW > 75 && ddFromHigh < 0.05)) phase = 'LATE';
  // turning up after a flat/weak stretch, now outperforming the market
  else if (!ranAlready && !extended && above200Days>=5 && above200Days<=63 && vs200 > 0 && ma50Slope > 0 && (rs3m ?? 0) > 0 && ((ret12m ?? 0) < 0.1 || ddFromHigh > 0.2) && ma50vs200 < 0.15) phase = 'EARLY';
  else if (vs200>0 && ma50Slope>0 && (extended||above200Days>63) || vs200 > 0 && ma50vs200 > 0.03 && (ret12m ?? 0) > 0.15) phase = 'LEADING';
  // well off the highs, moving sideways around the 200-day, and no big run behind it
  else if (vs200 < -0.05 && (ma50Slope<0 || (rs3m??0)<-0.05)) phase = 'DOWN';
  else if (!ranAlready && !extended && ddFromHigh >= 0.2 && Math.abs(vs200) < 0.1 && ma50Slope>=-0.01) phase = 'BASING';
  else phase = 'NEUTRAL';

  // early-cycle score: how much room (off the highs) and how fresh the turn is
  const early = (phase === 'EARLY' ? 50 : phase === 'BASING' ? 30 : 0)
    + Math.min(20, Math.round(ddFromHigh * 60))
    + (isNum(rs3m) && rs3m > 0 ? 15 : 0)
    + (ma50Slope > 0 ? 10 : 0)
    + (isNum(ret12m) && ret12m < 0.1 ? 5 : 0)
    - (ranAlready ? 20 : 0);
  return { model:'price-cycle-v2', phase, phaseKo: PHASE_KO[phase], earlyScore: Math.max(0,Math.min(100,early-(extended?15:0))), metrics: m,
    warnings:[...(extended?['저점 이후 반등 또는 200일선 이격이 큼 — 가격 초입으로 분류하지 않음']:[]),'가격 국면이며 산업 수주·재고·가동률의 회복 판정과 별개'] };
}

/** Correlation of daily returns over the last `days` aligned bars. */
export function returnCorrelation(a, b, days = 120) {
  const bBy = new Map(b.map((x) => [x.time, x.close]));
  const pairs = [];
  for (let i = 1; i < a.length; i++) {
    const p0 = bBy.get(a[i - 1].time);
    const p1 = bBy.get(a[i].time);
    if (p0 && p1 && a[i - 1].close > 0) pairs.push([a[i].close / a[i - 1].close - 1, p1 / p0 - 1]);
  }
  const s = pairs.slice(-days);
  if (s.length < 60) return null;
  const mx = s.reduce((t, p) => t + p[0], 0) / s.length;
  const my = s.reduce((t, p) => t + p[1], 0) / s.length;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (const [x, y] of s) { cov += (x - mx) * (y - my); vx += (x - mx) ** 2; vy += (y - my) ** 2; }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null;
}

/** Best-matching group for a stock: highest return correlation, beyond what the market explains. */
export function bestGroup(bars, etfBars, spy, minCorr = 0.5) {
  const spyCorr = returnCorrelation(bars, spy) ?? 0;
  let best = null;
  for (const [sym, eb] of Object.entries(etfBars)) {
    if (!eb?.length) continue;
    const r = returnCorrelation(bars, eb);
    if (r === null) continue;
    if (!best || r > best.corr) best = { etf: sym, corr: r };
  }
  // a stock that only moves with the whole market is not attributed to a theme
  return best && best.corr >= minCorr && best.corr > spyCorr + 0.05 ? best : null;
}
