// Nightly 4-hour ICT signals for the site (desk/ict4h.json). The 2-year event study (300 stocks, scripts/ict-intraday.mjs)
// found the limit entry in the gap / order block worked in both years; this lists the same signals every night and keeps
// following each one (filled? stopped? reached the liquidity target?) so a live record builds up next to the backtest.
//
//   node scripts/ict4h-live.mjs --universe data-branch/latest.json --prev data-branch/desk/ict4h.json --out data-branch/desk/ict4h.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { toFourHour, signalsFor } from './ict-intraday.mjs';
import { chooseUniverse, regimeSeries } from './desk-backtest.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
// 2026-11-08 run (3 years, 251 stocks): the same limit rule, split by the Nasdaq-100 regime on the signal day
export const BACKTEST_4H = {
  study: '3년, 거래대금 상위 250종목, 신호마다 따로 거래(비용 0.1%씩 포함)', from: '2023-11', to: '2026-11',
  limit: { n: 757, winRate: 0.392, expectancyR: 0.38, first: 0.21, last: 0.86 },
  trendLimit: { n: 227, winRate: 0.454, expectancyR: 0.52, first: 0.50, last: 0.55 },
  volume: { n: 169, winRate: 0.432, expectancyR: 0.56, first: 0.40, last: 1.30 },
  discount: { n: 568, winRate: 0.373, expectancyR: 0.36, first: 0.17, last: 0.88 },
  // the signals as one account (2026-11-08, scripts/ict-intraday.mjs portfolioSim: entry order, max 5 open, compounding)
  // 2026-11-08 growth run (400 stocks, cash limit = account): trend-aligned only, risk 2%, ≤2 positions → 3.16x, 46%/yr, max DD -15%
  accountCash: { trend: { risk2: { multiple: 3.16, cagr: 0.458, maxDD: -0.153 }, risk3: { multiple: 3.28, cagr: 0.475, maxDD: -0.181 } },
    trendMargin2x: { risk2: { multiple: 4.73, cagr: 0.665, maxDD: -0.173 } }, allSignals: { risk1: { multiple: 2.72, cagr: 0.372, maxDD: -0.243 } } },
  account: {
    trend: { label: '일봉 추세 일치 신호만', risk1: { multiple: 2.51, cagr: 0.353, maxDD: -0.110 }, risk2: { multiple: 5.55, cagr: 0.757, maxDD: -0.209 } },
    all: { label: '신호 전부', risk1: { multiple: 2.58, cagr: 0.350, maxDD: -0.313 }, risk2: { multiple: 4.41, cagr: 0.599, maxDD: -0.543 } },
  },
  byRegime: {
    '상승장': { n: 389, winRate: 0.393, expectancyR: 0.48, trend: 0.72 },
    '조정·횡보': { n: 106, winRate: 0.311, expectancyR: -0.01, trend: 0.19 },
    '급락 조정': { n: 41, winRate: 0.585, expectancyR: 0.76, volume: 0.90, discount: 0.85 },
    '약세장': { n: 38, winRate: 0.553, expectancyR: 1.10, discount: 1.19 },
  },
};
/** what the backtest says to trade in each regime (shown with the signals) */
export const REGIME_PLAYBOOK = {
  '상승장': '일봉 50일선 위(추세 일치) 신호만. 3년 +0.72R, 계좌 낙폭이 가장 작았던 규칙',
  '조정·횡보': '전체 기대값 0 근처(-0.01R), 추세 일치 신호만 +0.19R. 추세 일치만 받거나 쉼',
  '급락 조정': '추세 일치 신호만, 위험 2%·최대 2종목. 역추세 반등도 건당 +0.76R이지만 섞으면 계좌 낙폭이 -15%→-31%로 커져 참고만',
  '약세장': '추세 일치 신호만(드묾). 역추세 반등은 건당 +1.10R이지만 계좌 낙폭을 키워 참고만',
};

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
  const meta = chooseUniverse(latest, Number(arg('size', '300')), extra), symbols = [...meta.keys()];
  const prevPath = arg('prev'), prev = prevPath && existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : null;
  const { fetchDailyBars } = await import('../packages/pipeline/alpaca.mjs');
  const start = new Date(Date.now() - 110 * 864e5).toISOString().slice(0, 10), now = new Date().toISOString();
  const fresh = []; let asOf = null; const t0 = Date.now();
  for (let i = 0; i < symbols.length; i += 25) {
    const { bars } = await fetchDailyBars({ symbols: symbols.slice(i, i + 25), start, end: new Date(Date.now() - 20 * 60 * 1000).toISOString(), timeframe: '1Hour', keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY, batchSize: 25 });
    for (const [sym, hb] of Object.entries(bars)) {
      const b4 = toFourHour(hb); if (b4.length < 80) continue;
      if (!asOf || b4.at(-1).t > asOf) asOf = b4.at(-1).t;
      const m = meta.get(sym) ?? {};
      for (const s of signalsFor(b4, { since: b4.length - 140 })) /* long enough to follow open trades (60 bars) after a 10-bar fill window */ fresh.push({ symbol: sym, name: m.name ?? sym, sector: m.sector ?? null, ...s, firstSeen: now });
    }
  }
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
    rules: { bars: '정규장 4시간봉(09:30-13:30, 13:30-16:00 ET)', entry: '구조 전환 뒤 갭(FVG)·오더블록 지정가, 10봉(약 5거래일) 유효', stop: '쓸고 간 저점 아래(0.2 ATR)', exit: '60봉 고점(매수 쪽 유동성)에서 전량, 60봉(약 30거래일) 지나면 정리', minRR: 1.5 },
    stats: liveStats(signals, firstLive), recent: liveStats(signals), signals };
  mkdirSync(dirname(arg('out', 'desk/ict4h.json')), { recursive: true });
  writeFileSync(arg('out', 'desk/ict4h.json'), JSON.stringify(out));
  console.log(`ict4h-live: ${symbols.length} stocks, ${fresh.length} recent signals (${signals.filter((s) => s.status === 'waiting').length} waiting, ${signals.filter((s) => s.status === 'open').length} open), ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
