// Nightly 4-hour ICT signals for the site (desk/ict4h.json). The 2-year event study (300 stocks, scripts/ict-intraday.mjs)
// found the limit entry in the gap / order block worked in both years; this lists the same signals every night and keeps
// following each one (filled? stopped? reached the liquidity target?) so a live record builds up next to the backtest.
//
//   node scripts/ict4h-live.mjs --universe data-branch/latest.json --prev data-branch/desk/ict4h.json --out data-branch/desk/ict4h.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { toFourHour, signalsFor, dailyContext } from './ict-intraday.mjs';
import { chooseUniverse, regimeSeries } from './desk-backtest.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
// 2026-11-13 run (3 years, 399 stocks, scripts/ict-intraday.mjs --set real): what a once-a-day trader can get. Orders go in
// after the nightly scan, so a fill is possible from the next session on, and an order whose target is reached first is
// withdrawn. The earlier figures (2026-11-08: trend-aligned +0.39R to +0.52R, account 3.1x) did not survive this rerun:
// the same old rule on the new sample gave +0.21R, 1.76x. Account = entry order, at most 3 open, cash only, compounding.
export const BACKTEST_4H = {
  study: '3년, 거래대금 상위 400종목, 신호 다음 거래일부터 체결·목표 먼저 닿으면 취소, 신호마다 따로 거래(비용 0.1%씩 포함)', from: '2023-11', to: '2026-11',
  limit: { n: 1178, winRate: 0.345, expectancyR: 0.17, first: -0.01, last: 0.64 },
  trendLimit: { n: 323, winRate: 0.381, expectancyR: 0.21, first: 0.13, last: 0.36 },
  trendRs: { n: 145, winRate: 0.372, expectancyR: 0.26, first: 0.18, last: 0.43, note: '추세 일치 + 63일 상대강도 상위 30%. 표본이 작아 우선순위로만 씀' },
  trendMarket: { n: 168, winRate: 0.423, expectancyR: 0.25, first: 0.13, last: 0.50, note: '다음 거래일 시가 매수. 계좌 1.59배, 낙폭 -22%로 지정가보다 나쁨' },
  sameDayAllowed: { n: 346, winRate: 0.390, expectancyR: 0.21, note: '신호 당일 체결을 허용한 예전 방식. 당일 체결 41건 +0.46R' },
  accountCash: { trend: { risk2: { multiple: 1.90, cagr: 0.233, maxDD: -0.190, medianMonth: 0.009, worstMonth: -0.142, losingMonths: 0.34 }, risk3: { multiple: 1.86, cagr: 0.225, maxDD: -0.246, medianMonth: 0.005, worstMonth: -0.163, losingMonths: 0.42 } },
    trendRs: { risk2: { multiple: 2.60, cagr: 0.374, maxDD: -0.110, worstMonth: -0.078 }, risk3: { multiple: 3.22, cagr: 0.475, maxDD: -0.130, worstMonth: -0.089 } },
    allSignals: { risk2: { multiple: 1.70, cagr: 0.184, maxDD: -0.375, worstMonth: -0.225 } }, margin2x: null },
  byRegime: {
    '상승장': { n: 625, winRate: 0.347, expectancyR: 0.24, trend: 0.33, trendN: 200 },
    '조정·횡보': { n: 150, winRate: 0.353, expectancyR: 0.13, trend: 0.04, trendN: 57 },
    '급락 조정': { n: 69, winRate: 0.478, expectancyR: 0.39, trend: -0.76, trendN: 7, counter: 0.52, counterN: 62 },
    '약세장': { n: 56, winRate: 0.500, expectancyR: 1.00, trend: 0.68, trendN: 5, counter: 1.04, counterN: 51 },
  },
};
/** what the backtest says to trade in each regime (shown with the signals) */
export const REGIME_PLAYBOOK = {
  '상승장': '일봉 50일선 위(추세 일치) 신호만. 3년 200건 승률 40%, +0.33R',
  '조정·횡보': '추세 일치 신호도 우위 없음(3년 57건 +0.04R, 최근 1년 -0.19R). 쉬거나 위험을 절반으로',
  '급락 조정': '추세 일치 신호는 드물고 손실(7건 -0.76R). 반등 구조 전환은 선택으로 위험 0.5%만(62건 승률 52%, +0.52R). 숏·인버스 ETF는 손실',
  '약세장': '추세 일치 신호는 거의 없음(5건). 반등 구조 전환은 선택으로 위험 0.5%만(51건 승률 51%, +1.04R). 숏은 손실',
};

/** share of the universe with a lower 63-session return that day (0 = weakest, 1 = strongest); null under 30 stocks */
export function rsRank(all, r) {
  if (!all || r == null || all.length < 30) return null;
  let n = 0; for (const x of all) if (x < r) n++;
  return n / all.length;
}

/** merge tonight's view of each signal into the stored list: finished signals keep their result */
export function mergeSignals(prev, fresh, keepDays = 120, now = Date.now()) {
  const key = (s) => `${s.symbol}|${s.t}`, done = new Set(['won', 'lost', 'timeout', 'expired', 'cancelled']);
  const seen = new Set(fresh.map(key));
  // an unfinished signal that tonight's scan no longer reports (rule change, out of the window) is dropped, finished ones stay
  const map = new Map((prev ?? []).filter((s) => done.has(s.status) || seen.has(key(s))).map((s) => [key(s), s]));
  for (const s of fresh) { const old = map.get(key(s)); if (!old || !done.has(old.status)) map.set(key(s), { ...old, ...s, firstSeen: old?.firstSeen ?? s.firstSeen }); }
  const cut = new Date(now - keepDays * 864e5).toISOString();
  return [...map.values()].filter((s) => s.t >= cut).sort((a, b) => (a.t < b.t ? 1 : -1));
}

/** finished signals, counted from `since` (signal time): the live record excludes signals found looking back on day one */
export function liveStats(signals, since) {
  const fin = signals.filter((s) => s.R != null && (!since || s.t >= since));
  const n = fin.length, w = fin.filter((s) => s.R > 0).length;
  return { n, winRate: n ? w / n : null, expectancyR: n ? fin.reduce((a, s) => a + s.R, 0) / n : null, open: signals.filter((s) => s.status === 'open').length, waiting: signals.filter((s) => s.status === 'waiting').length };
}

async function main() {
  const latest = JSON.parse(readFileSync(arg('universe', 'data-branch/latest.json'), 'utf8'));
  const extra = (arg('extra', '') || '').split(',').filter(Boolean);
  const meta = chooseUniverse(latest, Number(arg('size', '400')), extra), symbols = [...meta.keys()];
  const prevPath = arg('prev'), prev = prevPath && existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : null;
  const { fetchDailyBars } = await import('../packages/pipeline/alpaca.mjs');
  const start = new Date(Date.now() - 110 * 864e5).toISOString().slice(0, 10), now = new Date().toISOString();
  const fresh = []; let asOf = null; const t0 = Date.now(); const ret63 = new Map(), retsByDay = new Map();
  for (let i = 0; i < symbols.length; i += 25) {
    const { bars } = await fetchDailyBars({ symbols: symbols.slice(i, i + 25), start, end: new Date(Date.now() - 20 * 60 * 1000).toISOString(), timeframe: '1Hour', keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY, batchSize: 25 });
    for (const [sym, hb] of Object.entries(bars)) {
      const b4 = toFourHour(hb); if (b4.length < 80) continue;
      if (!asOf || b4.at(-1).t > asOf) asOf = b4.at(-1).t;
      const m = meta.get(sym) ?? {};
      // 63-session return known before each day opens, for the relative-strength rank among the universe
      const ctx = dailyContext(b4); ret63.set(sym, ctx);
      for (const [day, c] of ctx) if (c.ret63 != null) { let a = retsByDay.get(day); if (!a) retsByDay.set(day, a = []); a.push(c.ret63); }
      for (const s of signalsFor(b4, { since: b4.length - 140 })) /* long enough to follow open trades (60 bars) after a 10-bar fill window */ fresh.push({ symbol: sym, name: m.name ?? sym, sector: m.sector ?? null, ...s, firstSeen: now });
    }
  }
  for (const s of fresh) { const r = ret63.get(s.symbol)?.get(s.day)?.ret63, rs = rsRank(retsByDay.get(s.day), r); if (rs != null) s.rs = Math.round(rs * 100) / 100; }
  const signals = mergeSignals(prev?.signals, fresh);
  // market regime from QQQ daily closes (same rule as the backtest split)
  let regime = null;
  try {
    const { bars: qb } = await fetchDailyBars({ symbols: ['QQQ'], start: new Date(Date.now() - 420 * 864e5).toISOString().slice(0, 10), end: new Date(Date.now() - 20 * 60 * 1000).toISOString(), keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY });
    const q = (qb.QQQ ?? []).map((b) => ({ c: b.close, time: b.time })), rs = regimeSeries(q), k = q.length - 1;
    if (k >= 200) regime = { name: rs[k], asOf: new Date(q[k].time * 1000).toISOString().slice(0, 10), qqqRet20: q[k].c / q[k - 20].c - 1, playbook: REGIME_PLAYBOOK[rs[k]] ?? null };
  } catch (e) { console.warn(`ict4h-live: regime unavailable (${e.message})`); }
  const firstLive = prev?.firstLive ?? now;
  const out = { model: 'ict4h-v1', generatedAt: now, asOf, firstLive, universe: symbols.length, backtest: BACKTEST_4H, regime,
    rules: { bars: '정규장 4시간봉(09:30-13:30, 13:30-16:00 ET)', entry: '구조 전환 뒤 갭(FVG)·오더블록 지정가, 신호 다음 거래일부터 10봉(약 5거래일) 유효, 체결 전에 목표가에 닿으면 취소', stop: '쓸고 간 저점 아래(0.2 ATR)', exit: '60봉 고점(매수 쪽 유동성)에서 전량, 60봉(약 30거래일) 지나면 정리', minRR: 1.5 },
    stats: liveStats(signals, firstLive), recent: liveStats(signals), signals };
  mkdirSync(dirname(arg('out', 'desk/ict4h.json')), { recursive: true });
  writeFileSync(arg('out', 'desk/ict4h.json'), JSON.stringify(out));
  console.log(`ict4h-live: ${symbols.length} stocks, ${fresh.length} recent signals (${signals.filter((s) => s.status === 'waiting').length} waiting, ${signals.filter((s) => s.status === 'open').length} open), ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
