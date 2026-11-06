// Nightly 4-hour ICT signals for the site (desk/ict4h.json). The 2-year event study (300 stocks, scripts/ict-intraday.mjs)
// found the limit entry in the gap / order block worked in both years; this lists the same signals every night and keeps
// following each one (filled? stopped? reached the liquidity target?) so a live record builds up next to the backtest.
//
//   node scripts/ict4h-live.mjs --universe data-branch/latest.json --prev data-branch/desk/ict4h.json --out data-branch/desk/ict4h.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { toFourHour, signalsFor } from './ict-intraday.mjs';
import { chooseUniverse } from './desk-backtest.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
export const BACKTEST_4H = {
  study: '2년, 거래대금 상위 300종목, 신호마다 따로 거래(비용 0.1%씩 포함)', from: '2024-08', to: '2026-11',
  limit: { n: 600, winRate: 0.397, expectancyR: 0.43, first: 0.22, last: 0.72 },
  trendLimit: { n: 181, winRate: 0.453, expectancyR: 0.58, first: 0.65, last: 0.50 },
};

/** merge tonight's view of each signal into the stored list: finished signals keep their result */
export function mergeSignals(prev, fresh, keepDays = 120, now = Date.now()) {
  const key = (s) => `${s.symbol}|${s.t}`, done = new Set(['won', 'lost', 'timeout', 'expired', 'cancelled']);
  const map = new Map((prev ?? []).map((s) => [key(s), s]));
  for (const s of fresh) { const old = map.get(key(s)); if (!old || !done.has(old.status)) map.set(key(s), { ...old, ...s, firstSeen: old?.firstSeen ?? s.firstSeen }); }
  const cut = new Date(now - keepDays * 864e5).toISOString();
  return [...map.values()].filter((s) => s.t >= cut).sort((a, b) => (a.t < b.t ? 1 : -1));
}

export function liveStats(signals, since) {
  const fin = signals.filter((s) => s.R != null && (!since || s.firstSeen >= since));
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
      for (const s of signalsFor(b4, { since: b4.length - 70 })) fresh.push({ symbol: sym, name: m.name ?? sym, sector: m.sector ?? null, ...s, firstSeen: now });
    }
  }
  const signals = mergeSignals(prev?.signals, fresh);
  const firstLive = prev?.firstLive ?? now;
  const out = { model: 'ict4h-v1', generatedAt: now, asOf, firstLive, universe: symbols.length, backtest: BACKTEST_4H,
    rules: { bars: '정규장 4시간봉(09:30-13:30, 13:30-16:00 ET)', entry: '구조 전환 뒤 갭(FVG)·오더블록 지정가, 10봉(약 5거래일) 유효', stop: '쓸고 간 저점 아래(0.2 ATR)', exit: '60봉 고점(매수 쪽 유동성)에서 전량, 60봉(약 30거래일) 지나면 정리', minRR: 1.5 },
    stats: liveStats(signals, firstLive), signals };
  mkdirSync(dirname(arg('out', 'desk/ict4h.json')), { recursive: true });
  writeFileSync(arg('out', 'desk/ict4h.json'), JSON.stringify(out));
  console.log(`ict4h-live: ${symbols.length} stocks, ${fresh.length} recent signals (${signals.filter((s) => s.status === 'waiting').length} waiting, ${signals.filter((s) => s.status === 'open').length} open), ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
