import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSetup, findBase, tradePlan, evaluateChart, trendTemplate } from '../packages/analysis/setups.mjs';
import { storySignals, quarterlyYoY } from '../packages/analysis/story.mjs';

// Deterministic "PLTR-like" path: long decline, ~13-month base with higher lows and
// contracting range, drying volume, then a high-volume breakout.
function basePath({ breakout = true, seed = 3 } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const bars = [];
  let t = Date.UTC(2021, 0, 4) / 1000;
  const push = (close, range, volume) => {
    const o = close * (1 + (rnd() - 0.5) * range * 0.5);
    bars.push({ time: t, open: o, high: Math.max(o, close) * (1 + range * rnd() * 0.5), low: Math.min(o, close) * (1 - range * rnd() * 0.5), close, volume });
    t += 86400;
  };
  for (let i = 0; i < 260; i++) push(100 * Math.pow(0.4, i / 260), 0.04, 2e6); // decline 100 -> 40
  for (let i = 0; i < 280; i++) {
    const lowFloor = 38 + (i / 280) * 8; // rising floor 38 -> 46
    const ceiling = 52;
    const amp = (ceiling - lowFloor) * (0.5 + 0.5 * Math.sin(i / 9));
    const vol = 0.035 * (1 - i / 400);
    push(Math.min(ceiling - 0.5, lowFloor + amp), vol, 1.5e6 * (1 - i / 500));
  }
  if (breakout) push(55, 0.03, 6e6);
  return bars;
}

test('finds a long base with higher lows', () => {
  const bars = basePath({ breakout: false });
  const base = findBase(bars, bars.length - 1);
  assert.ok(base, 'base found');
  assert.ok(base.window >= 252, `long base (${base?.window})`);
  assert.ok(base.higherLows);
  assert.ok(base.depth < 0.5);
});

test('detects the breakout bar, and only NEAR_PIVOT/IN_BASE before it (no look-ahead)', () => {
  const bars = basePath();
  const s = detectSetup(bars);
  assert.equal(s.stage, 'BREAKOUT');
  assert.ok(s.breakoutVolMult >= 1.4);
  assert.ok(s.pivot < 55 && s.pivot > 50);
  const before = detectSetup(bars.slice(0, -1));
  assert.ok(['NEAR_PIVOT', 'IN_BASE'].includes(before.stage), before.stage);
});

test('post-breakout stays actionable, then becomes EXTENDED when price runs away', () => {
  const bars = basePath();
  const t0 = bars.at(-1).time;
  const plus = (n, px) => Array.from({ length: n }, (_, i) => ({ time: t0 + (i + 1) * 86400, open: px, high: px * 1.01, low: px * 0.99, close: px, volume: 2e6 }));
  assert.equal(detectSetup([...bars, ...plus(3, 55.5)]).stage, 'POST_BREAKOUT');
  assert.equal(detectSetup([...bars, ...plus(3, 66)]).stage, 'EXTENDED');
  assert.equal(detectSetup([...bars, ...plus(3, 49)]).stage, 'FAILED');
});

test('trade plan: stop below entry on structure, measured-move target, R multiple', () => {
  const bars = basePath();
  const s = detectSetup(bars);
  const p = tradePlan(bars, s);
  assert.ok(p.stop < p.entry);
  assert.ok(Math.abs(p.target - (p.entry + (s.base.high - s.base.low))) < 1e-9);
  assert.ok(p.rMultiple > 1);
  assert.ok(['오더블록 하단', '바닥 마지막 저점', '바닥 최저점', 'ATR×2'].includes(p.stopKind));
});

test('a falling stock has no breakout setup and fails the trend template', () => {
  const bars = basePath({ breakout: false }).slice(0, 260);
  assert.notEqual(detectSetup(bars).stage, 'BREAKOUT');
  assert.equal(trendTemplate(bars).ok, false);
  const e = evaluateChart(basePath());
  assert.ok(e.chartScore > evaluateChart(bars).chartScore);
});

test('story: acceleration, profit inflection, doubted-while-improving, dilution penalty', () => {
  const q = (end, value) => ({ end, value, filed: end, form: '10-Q' });
  const fundamentals = {
    revenueQuarterly: [q('2022-03-31', 100), q('2022-06-30', 105), q('2022-09-30', 110), q('2023-03-31', 112), q('2023-06-30', 125), q('2023-09-30', 140)],
    netIncomeQuarterly: [q('2022-09-30', -20), q('2023-06-30', -5), q('2023-09-30', 8)],
    sharesYoY: 0.02, runwayMonths: null,
  };
  assert.deepEqual(quarterlyYoY(fundamentals.revenueQuarterly).map((x) => Math.round(x.yoy * 100)), [12, 19, 27]);
  const news = [
    ...Array.from({ length: 4 }, (_, i) => ({ time: '2023-10-0' + (i + 2) + 'T12:00:00Z', headline: 'Short seller calls it a fraud, shares fall', sentiment: 'negative' })),
    { time: '2023-10-03T12:00:00Z', headline: 'Company launches AI platform for defense', sentiment: 'positive' },
    { time: '2023-09-20T12:00:00Z', headline: 'New AI inference chips ship to data centers', sentiment: 'positive' },
    { time: '2023-09-10T12:00:00Z', headline: 'Generative AI demand lifts orders', sentiment: 'positive' },
    { time: '2023-09-01T12:00:00Z', headline: 'Quarterly update', sentiment: 'neutral' },
  ];
  const s = storySignals({ fundamentals, filings: [], news, asOf: '2023-10-06' });
  const texts = s.reasons.map((r) => r.text).join('\n');
  assert.match(texts, /성장 가속/);
  assert.match(texts, /흑자 전환/);
  assert.match(texts, /의심하는 성장/);
  assert.ok(s.themes.includes('AI'));
  assert.ok(s.storyScore >= 60, `score ${s.storyScore}`);
  const diluted = storySignals({ fundamentals, filings: [{ category: 'DILUTION', importance: 'high', filingDate: '2023-09-01', form: '424B5' }], news, asOf: '2023-10-06' });
  assert.ok(diluted.storyScore < s.storyScore);
  // nothing after asOf is used
  const early = storySignals({ fundamentals, filings: [], news, asOf: '2023-07-01' });
  assert.doesNotMatch(early.reasons.map((r) => r.text).join('\n'), /흑자 전환/);
});

test('a range near the highs is not a base (Apple Oct-2026 case): base must sit 20%+ under the earlier peak', () => {
  // rally 180 -> 345 over 18 months after an earlier peak of ~260: the "range" tops ABOVE the old peak
  let t = Date.UTC(2023, 0, 2) / 1000;
  const bars = [];
  const push = (c, v = 5e7) => { bars.push({ time: t, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: v }); t += 86400; };
  for (let i = 0; i < 150; i++) push(200 + i * 0.4); // up to ~260
  for (let i = 0; i < 120; i++) push(260 - i * 0.65); // down to ~182
  for (let i = 0; i < 260; i++) push(182 + i * 0.62 + 6 * Math.sin(i / 8)); // up to ~343
  for (let i = 0; i < 25; i++) push(335 + 4 * Math.sin(i)); // just under the high
  assert.equal(findBase(bars, bars.length - 1), null);
  assert.equal(detectSetup(bars).stage, 'NONE');
});

test('news: a capped feed that is all from this week is not a surge; one stray word is not a theme', () => {
  const news = Array.from({ length: 50 }, (_, i) => ({ time: new Date(Date.UTC(2026, 9, 12) - i * 3600e3).toISOString(), headline: i === 0 ? 'Apple to launch new iPhone; Army contract rumor' : `Apple stock moves ${i}`, sentiment: 'neutral' }));
  const s = storySignals({ fundamentals: null, filings: [], news, asOf: '2026-10-12' });
  assert.doesNotMatch(s.reasons.map((r) => r.text).join('\n'), /관심 급증/);
  assert.deepEqual(s.themes, []);
});

test('story narrative: loss narrowing + accelerating revenue reads as a turnaround, in plain sentences', () => {
  const q = (end, value) => ({ end, value, filed: end, form: '10-Q' });
  const fundamentals = {
    revenueQuarterly: [q('2025-03-31', 100), q('2025-06-30', 105), q('2025-09-30', 110), q('2026-03-31', 112), q('2026-06-30', 125), q('2026-09-30', 145)],
    netIncomeQuarterly: [q('2025-09-30', -40e6), q('2026-06-30', -20e6), q('2026-09-30', -12e6)],
    runwayMonths: 18,
  };
  const news = [
    { time: '2026-10-08T12:00:00Z', headline: 'Demo wins $120M Army drone contract', sentiment: 'positive', tags: ['계약'] },
    { time: '2026-10-01T12:00:00Z', headline: 'Short report questions Demo accounting', sentiment: 'negative' },
  ];
  const { narrative } = storySignals({ fundamentals, filings: [], news, asOf: '2026-10-12' });
  const text = narrative.lines.join(' ');
  assert.match(text, /순손실 -\$12\.0M로 아직 적자지만, 1년 전\(-\$40\.0M\)보다 적자가 70% 줄었습니다/);
  assert.match(text, /매출 성장률이 3개 분기 연속 빨라지고/);
  assert.match(text, /약 18개월 버틸/);
  assert.match(text, /Army drone contract/);
  assert.match(narrative.takeaway, /흑자 전환이 확인되면 재평가/);
  assert.match(narrative.method, /AI 해석 아님/);
  const none = storySignals({ fundamentals: null, filings: [], news: [], asOf: '2026-10-12' }).narrative;
  assert.match(none.takeaway, /실적 데이터가 없어/);
});

test('narrative does not claim losses are shrinking when there is no year-ago figure', () => {
  const q = (end, value) => ({ end, value, filed: end, form: '10-Q' });
  const fundamentals = { revenueQuarterly: [q('2025-01-31', 100), q('2025-04-30', 100), q('2025-07-31', 100), q('2026-01-31', 116), q('2026-04-30', 120), q('2026-07-31', 140)], netIncomeQuarterly: [q('2026-04-30', 5), q('2026-07-31', -10)] };
  const { narrative } = storySignals({ fundamentals, filings: [], news: [], asOf: '2026-10-12' });
  assert.match(narrative.takeaway, /적자가 줄어드는지는 아직 확인되지 않았습니다/);
});

test('a range after a big rally off the lows is not a base (ROKU Oct-2026 case)', () => {
  let t = Date.UTC(2022, 0, 3) / 1000;
  const bars = [];
  const push = (c, v = 4e6) => { bars.push({ time: t, open: c, high: c * 1.015, low: c * 0.985, close: c, volume: v }); t += 86400; };
  for (let i = 0; i < 250; i++) push(490 * Math.pow(50 / 490, i / 249)); // 490 -> 50 (old bubble peak, 4+ years back)
  for (let i = 0; i < 520; i++) push(i < 260 ? 50 + 50 * Math.sin((i / 260) * Math.PI) : 50 + 8 * Math.sin(i / 10)); // two years of bottoming, a bump to ~100
  for (let i = 0; i < 120; i++) push(50 + i * 0.5); // rally to ~110
  for (let i = 0; i < 130; i++) push(130 + 25 * Math.sin(i / 9) + i * 0.05, 3e6); // 104–160 consolidation
  assert.equal(findBase(bars, bars.length - 1), null, 'not a bottom: base low is 2x the multi-year low');
  // the same chart cut at the end of the real bottom does find a base near the lows
  const atBottom = findBase(bars, 769);
  assert.ok(!atBottom || atBottom.low < 50 * 1.3);
});

test('profit down a lot is not called momentum; a quarter-to-quarter swing is not "turned profitable"', () => {
  const q = (end, value) => ({ end, value, filed: end, form: '10-Q' });
  const fundamentals = {
    revenueQuarterly: [q('2025-03-31', 100), q('2025-06-30', 100), q('2025-09-30', 100), q('2026-03-31', 90), q('2026-06-30', 120), q('2026-09-30', 150)],
    netIncomeQuarterly: [q('2025-09-30', 241e6), q('2026-06-30', -5e6), q('2026-09-30', 13e6)],
  };
  const s = storySignals({ fundamentals, filings: [], news: [], asOf: '2026-10-12' });
  assert.doesNotMatch(s.reasons.map((r) => r.text).join(' '), /흑자 전환/);
  assert.match(s.narrative.takeaway, /이익은 1년 전보다 크게 줄었습니다/);
});

test('a deep 12-month small-cap base (RGTI 2024-like, ~$0.66–$1.95) breaking out on volume is found', async () => {
  const { explainBase } = await import('../packages/analysis/setups.mjs');
  let t = Date.UTC(2021, 0, 4) / 1000;
  const bars = [];
  const push = (c, v = 3e6) => { bars.push({ time: t, open: c, high: c * 1.04, low: c * 0.96, close: c, volume: v }); t += 86400; };
  for (let i = 0; i < 300; i++) push(12 * Math.pow(0.9 / 12, i / 299)); // SPAC-era peak ~12 → 0.9
  for (let i = 0; i < 120; i++) push(0.9 + 0.25 * Math.sin(i / 8)); // early bottom
  // 12-month base: spike to ~1.9 early, slide to ~0.68 three months before the end, then a rising low
  for (let i = 0; i < 252; i++) {
    const c = i < 60 ? 1.1 + 0.8 * Math.sin((i / 60) * Math.PI) : i < 190 ? 1.3 - (i - 60) * 0.0048 : 0.68 + (i - 190) * 0.007;
    push(c, i < 190 ? 2.5e6 : 1.8e6);
  }
  push(2.1, 12e6); // breakout through the base high on ~6x volume
  const s = detectSetup(bars);
  assert.equal(s.stage, 'BREAKOUT', JSON.stringify(explainBase(bars, bars.length - 2)));
  assert.ok(s.base.depth > 0.5 && s.base.window >= 252, 'deep long base accepted');
});

test('volatile small caps: QUBT-like 6-month bottom 61% deep and IONQ-like higher-low base far under its peak are bases', () => {
  const mk = (closes, vols, swing = 0.05) => {
    let t = Date.UTC(2021, 0, 4) / 1000;
    return closes.map((c, i) => { const b = { time: t, open: c, high: c * (1 + swing), low: c * (1 - swing), close: c, volume: vols(i) }; t += 86400; return b; });
  };
  // QUBT-like: big earlier peak, 6-month bottom ~0.35–0.90 with violent daily moves, then an 8x volume breakout
  const q = [];
  for (let i = 0; i < 400; i++) q.push(8 * Math.pow(0.6 / 8, i / 399) * (1 + 0.08 * Math.sin(i)));
  for (let i = 0; i < 140; i++) q.push((0.45 + 0.25 * (0.5 + 0.5 * Math.sin(i / 7))) * (1 + 0.07 * Math.sin(i * 1.7)));
  q.push(1.0);
  const qb = mk(q, (i) => (i === q.length - 1 ? 8e7 : 1e7), 0.07);
  const sq = detectSetup(qb);
  assert.equal(sq.stage, 'BREAKOUT', JSON.stringify(sq));
  // IONQ-like: peak ~21.6, 2022 low ~3, 2024 base 6.2–10.1 (2x the old low but 50%+ under the peak)
  const o = [];
  for (let i = 0; i < 250; i++) o.push(3.2 + 0.4 * Math.sin(i / 9)); // 2022 lows
  for (let i = 0; i < 200; i++) o.push(3.2 + 18 * Math.sin((i / 200) * Math.PI) * (i < 100 ? 1 : 1)); // 2023 rally to ~21 and back
  for (let i = 0; i < 160; i++) o.push(6.6 + 1.6 * (0.5 + 0.5 * Math.sin(i / 8))); // 2024 base 6.6–8.2
  o.push(10.4);
  const ob = mk(o, (i) => (i === o.length - 1 ? 2e7 : 8e6), 0.04);
  const so = detectSetup(ob);
  assert.equal(so.stage, 'BREAKOUT', JSON.stringify(so));
});

test('바닥 다지기: inside the base near its floor → scale-in zone, stop under the floor, target the top', () => {
  const bars = basePath();
  const s = detectSetup(bars);
  const range = s.base.high - s.base.low;
  const px = s.base.low + range * 0.15;
  const atFloor = [...bars.slice(0, -1), { ...bars.at(-1), open: px, high: px * 1.01, low: px * 0.99, close: px }];
  const p = tradePlan(atFloor, { ...s, stage: 'IN_BASE' });
  assert.equal(p.entryType, 'zone');
  assert.ok(p.stop < s.base.low && p.zone[0] === s.base.low && p.zone[1] >= px);
  assert.ok(p.riskPct < 0.2, String(p.riskPct));
  assert.equal(p.target, s.pivot);
  assert.ok(p.rMultiple > 1.5, String(p.rMultiple));
  assert.match(p.how, /분할매수/);
  // middle of the base: limit order at the floor zone, not at today's price
  const mid = s.base.low + range * 0.45;
  const midBars = [...bars.slice(0, -1), { ...bars.at(-1), open: mid, high: mid * 1.01, low: mid * 0.99, close: mid }];
  const pm = tradePlan(midBars, { ...s, stage: 'IN_BASE' });
  assert.equal(pm.entryType, 'limit');
  assert.ok(pm.entry < mid && pm.entry === pm.zone[1]);
  // upper part of the base: wait for the breakout instead
  const hi = s.base.low + range * 0.8;
  const upper = [...bars.slice(0, -1), { ...bars.at(-1), open: hi, high: hi * 1.01, low: hi * 0.99, close: hi }];
  assert.equal(tradePlan(upper, { ...s, stage: 'IN_BASE' }).entryType, 'buy-stop');
});
