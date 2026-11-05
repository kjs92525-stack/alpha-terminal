import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, pickForDay, replayDesk, deskStats, DESK_RULES } from '../packages/analysis/analyst-desk.mjs';
import { runDesk } from '../scripts/analyst-desk.mjs';

const cal = (n, start = '2025-01-01') => { const out = []; for (let d = new Date(start + 'T00:00:00Z'); out.length < n; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); return out; };
/** steady uptrend with small wiggles, then an optional last bar */
function trend(n, { start = 50, drift = 0.0012, last } = {}) {
  const bars = []; let c = start;
  for (let i = 0; i < n; i++) { const w = Math.sin(i / 2) * 0.012; const o = c; c = c * (1 + drift + w); bars.push({ o, h: Math.max(o, c) * 1.006, l: Math.min(o, c) * 0.994, c, v: 1e6 }); }
  if (last) bars.push(last(bars.at(-1)));
  return bars;
}

test('a high-volume close above the 20-day high near the 52-week high is read as a breakout', () => {
  const bars = trend(260, { last: (p) => ({ o: p.c, h: p.c * 1.04, l: p.c * 0.999, c: p.c * 1.035, v: 3e6 }) });
  const a = analyze(bars, bars.length - 1, { score: 80, spyRet126: 0.05 });
  assert.equal(a.setup, 'breakout');
  assert.equal(a.plan.entryType, 'market');
  assert.ok(a.plan.stop < a.plan.trigger && a.plan.target > a.plan.trigger);
  assert.match(a.thesis, /손절/);
});

test('a downtrend below the 200-day average is passed over', () => {
  const bars = trend(260, { drift: -0.002, start: 100 });
  assert.match(analyze(bars, bars.length - 1).pass, /하락 추세/);
});

test('pickForDay skips funds, held names and duplicate sectors, and caps the count by market state', () => {
  const mk = (sym, sector, name = sym) => { const bars = trend(260, { start: 20 + sym.length, last: (p) => ({ o: p.c, h: p.c * 1.04, l: p.c * 0.999, c: p.c * 1.035, v: 3e6 }) }); return { symbol: sym, name, sector, score: 80, bars, i: bars.length - 1 }; };
  const res = pickForDay({ date: 'x', market: 'LIMIT', spyRet126: 0, busy: new Set(['HELD']), cooldown: new Map([['COOL', '10-01']]), candidates: [mk('AAA', 'Tech'), mk('BBB', 'Tech'), mk('TQQQ', 'Unknown', 'ProShares UltraPro QQQ'), mk('HELD', 'Energy'), mk('COOL', 'Utilities'), mk('CCC', 'Health'), mk('DDD', 'Retail'), mk('EEE', 'Media')] });
  assert.equal(res.picks.length, DESK_RULES.picksPerDay.LIMIT);
  assert.ok(!res.picks.some((p) => ['BBB', 'TQQQ', 'HELD', 'COOL'].includes(p.symbol)), 'sector duplicate, fund, held and cooling names are skipped');
  assert.ok(res.passed.some((p) => p.symbol === 'TQQQ' && /ETF/.test(p.why)));
  assert.ok(res.passed.some((p) => p.symbol === 'COOL' && /손절 뒤/.test(p.why)));
  assert.ok(res.picks.every((p) => p.plan.riskPct === DESK_RULES.riskPct.LIMIT));
  const wait = pickForDay({ date: 'x', market: 'WAIT', spyRet126: 0, candidates: [mk('AAA', 'Tech'), mk('CCC', 'Health')] });
  assert.ok(wait.picks.length <= DESK_RULES.picksPerDay.WAIT && wait.picks.every((p) => p.quality >= DESK_RULES.minQualityWait));
});

test('replay: market order fills next open, partial at +2R, the rest exits on the trailing average; equity reconciles', () => {
  const px = [...Array(12).fill(100), 101, 104, 108, 112, 109, 104, 103];
  const days = cal(px.length), p0 = 11; // pick on day 11, fill day 12
  const bars = px.map((c, i) => ({ o: i ? px[i - 1] : c, h: c + 0.5, l: c - 0.5, c, v: 1 }));
  const spy = px.map(() => ({ o: 400, h: 401, l: 399, c: 400, v: 1 }));
  const data = { cal: days, get: (s) => (s === 'SPY' ? { s: 0, bars: spy } : s === 'AAA' ? { s: 0, bars } : null) };
  const pick = { symbol: 'AAA', name: 'A', setup: 'breakout', label: '신고가 돌파', cap: '대형주', plan: { entryType: 'market', trigger: 100, refClose: 100, stop: 97, target: 106, validDays: 1, riskPct: 0.01, trailMa: 'ema10', trailLabel: '10일 지수이평' } };
  const r = replayDesk([{ date: days[p0], live: true, picks: [pick] }], data);
  const t = r.trades[0];
  assert.equal(t.entryDate, days[p0 + 1]); assert.equal(t.entry, 100); // next open
  assert.ok(t.partial, 'took the +2R partial');
  assert.equal(r.open.length, 0);
  const s = deskStats(r.trades, r.equity);
  assert.equal(s.closed, 1); assert.equal(s.winRate, 1);
  assert.ok(Math.abs(r.equity.at(-1).equity - (DESK_RULES.startEquity + t.pnl)) < 0.05, 'final equity = start + realized P&L');
});

test('replay: an order that never reaches its trigger expires; a gap through the stop fills at the open', () => {
  const days = cal(6);
  const mk = (arr) => arr.map(([o, h, l, c]) => ({ o, h, l, c, v: 1 }));
  const A = mk([[50, 51, 49, 50], [50, 50.5, 49.5, 50], [50, 50.5, 49.5, 50], [50, 50.5, 49.5, 50], [50, 50.5, 49.5, 50], [50, 50.5, 49.5, 50]]);
  const B = mk([[20, 20.5, 19.5, 20], [20, 20.5, 19.8, 20.2], [18, 18.2, 17.5, 18], [18, 18, 18, 18], [18, 18, 18, 18], [18, 18, 18, 18]]);
  const data = { cal: days, get: (s) => ({ AAA: { s: 0, bars: A }, BBB: { s: 0, bars: B }, SPY: { s: 0, bars: A } })[s] ?? null };
  const plan = (o) => ({ trailMa: 'ema10', trailLabel: 'x', riskPct: 0.01, validDays: 2, ...o });
  const r = replayDesk([{ date: days[0], picks: [
    { symbol: 'AAA', setup: 'base', plan: plan({ entryType: 'buy-stop', trigger: 52, stop: 48, target: 60, refClose: 50 }) },
    { symbol: 'BBB', setup: 'breakout', plan: plan({ entryType: 'market', trigger: 20, stop: 19, target: 22, refClose: 20 }) }] }], data);
  assert.equal(r.outcomes[`${days[0]}:AAA`].status, 'expired');
  const b = r.trades.find((t) => t.symbol === 'BBB');
  assert.equal(b.exit, 18); assert.match(b.reason, /갭/);
});

test('runDesk keeps stored live picks as they are and only creates today', () => {
  const days = cal(270, '2025-06-02');
  const up = trend(270, { start: 30 });
  const data = { cal: days, gates: {}, get: (s) => (s === 'SPY' || s === 'AAA' ? { s: 0, bars: up } : null) };
  const today = days.at(-1), yesterday = days.at(-2);
  const stored = [{ date: yesterday, live: true, market: 'LIMIT', picks: [] }];
  const docs = [{ asOf: yesterday, mid: [{ symbol: 'AAA', name: 'A', sector: 'Tech', score: 80 }] }, { asOf: today, mid: [{ symbol: 'AAA', name: 'A', sector: 'Tech', score: 80 }] }];
  const { created, account } = runDesk({ docs, latest: { asOf: today }, data, stored, today });
  assert.deepEqual(created.map((c) => c.date), [today]);
  assert.equal(account.ledgers.find((l) => l.date === yesterday).picks.length, 0, 'stored day not regenerated');
  assert.equal(account.firstLive, yesterday);
});

test('no new entry inside the earnings blackout; a pullback in a stock weaker than SPY is not a setup', () => {
  const bars = trend(260, { last: (p) => ({ o: p.c, h: p.c * 1.04, l: p.c * 0.999, c: p.c * 1.035, v: 3e6 }) });
  assert.match(analyze(bars, bars.length - 1, { score: 80, spyRet126: 0, earningsIn: 3 }).pass, /실적 발표 3거래일 전/);
  const ok = analyze(bars, bars.length - 1, { score: 80, spyRet126: 0, earningsIn: 12, earningsChecked: true });
  assert.ok(ok.warnings.some((w) => /12거래일 뒤 실적/.test(w)));
});

test('replay: an unprotected position is sold at the close before an earnings report', () => {
  const px = [...Array(12).fill(100), 100.5, 100.8, 101, 101.2, 101];
  const days = cal(px.length), p0 = 11;
  const bars = px.map((c, i) => ({ o: i ? px[i - 1] : c, h: c + 0.3, l: c - 0.3, c, v: 1 }));
  const data = { cal: days, earnings: (s) => (s === 'AAA' ? [{ date: days[15], hour: 'bmo' }] : []), get: (s) => (s === 'AAA' || s === 'SPY' ? { s: 0, bars } : null) };
  const pick = { symbol: 'AAA', setup: 'breakout', cap: '대형주', plan: { entryType: 'market', trigger: 100, refClose: 100, stop: 96, target: 108, validDays: 1, riskPct: 0.01, trailMa: 'ema10', trailLabel: 'x' } };
  const r = replayDesk([{ date: days[p0], picks: [pick] }], data);
  assert.equal(r.trades[0].reason, '실적 발표 전 정리');
  assert.equal(r.trades[0].exitDate, days[14]);
});

test('replay: total open risk is capped, so a later order is cut down to fit', () => {
  const n = 30, days = cal(n);
  const flat = Array.from({ length: n }, () => ({ o: 50, h: 50.4, l: 49.8, c: 50, v: 1 }));
  const get = (s) => ({ s: 0, bars: flat });
  const plan = { entryType: 'market', trigger: 50, refClose: 50, stop: 40, target: 70, validDays: 1, riskPct: 0.03, trailMa: 'ema10', trailLabel: 'x' };
  const picks = ['A1', 'A2', 'A3'].map((s, i) => ({ symbol: s, setup: 'breakout', sector: 'S' + i, cap: '대형주', plan }));
  const r = replayDesk([{ date: days[0], picks }], { cal: days, get });
  const heat = r.open.reduce((a, p) => a + p.shares * (50 - p.stop), 0);
  assert.ok(heat <= DESK_RULES.maxHeatPct * DESK_RULES.startEquity + 1, `heat ${heat}`);
  assert.ok(r.events.some((e) => /전체 위험/.test(e.text)) || Object.values(r.outcomes).some((o) => /전체 위험/.test(o.why ?? '')));
});

test('wilson interval, selection edge and verdict stay honest about small samples', async () => {
  const { wilson, selectionEdge, deskVerdict } = await import('../packages/analysis/analyst-desk.mjs');
  const [lo, hi] = wilson(1, 10); assert.ok(lo < 0.05 && hi > 0.35);
  const days = cal(20), up = days.map((_, i) => ({ o: 10 + i, h: 11 + i, l: 9 + i, c: 10 + i, v: 1 })), flat = days.map(() => ({ o: 10, h: 10, l: 10, c: 10, v: 1 }));
  const data = { cal: days, get: (s) => ({ s: 0, bars: s === 'W' ? up : flat }) };
  const e = selectionEdge([{ date: days[0], picks: ['W'], candidates: ['W', 'F1', 'F2', 'F3', 'F4'] }], data, 5);
  assert.equal(e.days, 1); assert.ok(e.edge > 0);
  assert.equal(deskVerdict({ closed: 12 }, e).stage, 'collect');
  assert.equal(deskVerdict({ closed: 40, expectancyR: -0.2, profitFactor: 0.7 }, e).stage, 'review');
});
