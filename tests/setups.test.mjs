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
