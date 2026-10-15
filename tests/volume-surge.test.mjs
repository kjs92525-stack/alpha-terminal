import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVolumeSurge, explainSurge, classifyCause } from '../packages/analysis/volume-surge.mjs';

const t0 = Date.UTC(2025, 0, 2) / 1000;
function bars({ n = 200, last = null, drift = 0 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) { const c = 10 * Math.pow(1 + drift, i) * (1 + 0.01 * Math.sin(i / 3)); out.push({ time: t0 + i * 86400, open: c, high: c * 1.02, low: c * 0.98, close: c, volume: 1e6 + 1e5 * Math.sin(i) }); }
  if (last) out.push({ time: t0 + n * 86400, ...last });
  return out;
}

test('surge: last session 5x the 50-day average volume with enough dollar volume', () => {
  const b = bars({ last: { open: 10.2, high: 11.6, low: 10.1, close: 11.5, volume: 5e6 } });
  const s = detectVolumeSurge(b);
  assert.ok(s && s.volMult >= 4.5, JSON.stringify(s));
  assert.equal(s.sessionsAgo, 0);
  assert.ok(s.ret1 > 0.1 && s.closePos > 0.9);
  assert.equal(detectVolumeSurge(bars()), null, 'normal volume is not a surge');
  assert.equal(detectVolumeSurge(bars({ last: { open: 0.5, high: 0.6, low: 0.5, close: 0.55, volume: 9e6 } })), null, 'below $1 is ignored');
  assert.equal(detectVolumeSurge(bars({ last: { open: 10, high: 10.2, low: 9.9, close: 10, volume: 2.5e6 } })), null, 'under 3x is not a surge');
  assert.ok(detectVolumeSurge(bars({ last: { open: 10, high: 10.2, low: 9.9, close: 10, volume: 3.5e6 } })).volMult >= 3);
});

test('cause: from dated headlines near the surge day, most specific first; none found stays unexplained', () => {
  const s = detectVolumeSurge(bars({ last: { open: 10.2, high: 11.6, low: 10.1, close: 11.5, volume: 5e6 } }));
  const day = s.date;
  const news = [
    { time: `${day}T13:00:00Z`, headline: 'Analyst upgrades X to Buy, raises price target', url: 'https://a' },
    { time: `${day}T12:00:00Z`, headline: 'X prices $50 million registered direct offering', url: 'https://b' },
    { time: '2024-01-01T00:00:00Z', headline: 'X to be acquired by Y', url: 'https://old' },
  ];
  const e = explainSurge({ surge: s, news, asOf: day });
  assert.equal(e.cause, 'financing');
  assert.equal(e.headlines.length, 2, 'old headlines are not a cause');
  assert.equal(e.confidence, 'headline_only');
  const none = explainSurge({ surge: s, news: [], asOf: day });
  assert.equal(none.cause, 'unexplained');
  assert.equal(none.confidence, 'none');
  assert.equal(explainSurge({ surge: s, news: null, asOf: day }).newsChecked, false);
  assert.equal(classifyCause('FDA approves X drug'), 'regulatory');
  assert.equal(classifyCause('X reports third quarter results'), 'earnings');
  assert.equal(classifyCause('X to join S&P 600'), 'index');
  assert.equal(classifyCause('Company announces leadership update'), null);
});

test('context: a surge after a big run that closes weak reads as possible distribution', () => {
  const b = bars({ drift: 0.01 });
  const prev = b.at(-1).close;
  b.push({ time: b.at(-1).time + 86400, open: prev * 1.05, high: prev * 1.08, low: prev * 0.95, close: prev * 0.96, volume: 6e6 });
  const s = detectVolumeSurge(b);
  assert.equal(s.context, 'after_run');
  assert.match(explainSurge({ surge: s, news: [], asOf: s.date }).tone, /분산/);
});

test('thin shells and market-wrap headlines do not dominate', async () => {
  const { isRoundup } = await import('../packages/analysis/volume-surge.mjs');
  // normal trading ~$0.5M a day: any big print would be a "1000x" surge — skipped
  const thin = [];
  for (let i = 0; i < 200; i++) thin.push({ time: t0 + i * 86400, open: 3, high: 3.1, low: 2.9, close: 3, volume: 150e3 });
  thin.push({ time: t0 + 200 * 86400, open: 3, high: 6, low: 3, close: 5.5, volume: 60e6 });
  assert.equal(detectVolumeSurge(thin), null);
  assert.ok(isRoundup("12 Industrials Stocks Moving In Tuesday's After-Market Session"));
  assert.ok(isRoundup('Why Is SkyAI Stock Surging Monday?'));
  assert.equal(classifyCause("12 Health Care Stocks Moving In Tuesday's Pre-Market Session"), null);
  const s = detectVolumeSurge(bars({ last: { open: 10.2, high: 11.6, low: 10.1, close: 11.5, volume: 5e6 } }));
  const e = explainSurge({ surge: s, news: [{ time: `${s.date}T10:00:00Z`, headline: '10 Stocks Moving In Wednesday\'s Pre-Market Session' }, { time: `${s.date}T12:00:00Z`, headline: 'X reports record quarterly revenue' }], asOf: s.date });
  assert.equal(e.cause, 'earnings');
  assert.equal(e.headlines[0].roundup, false, 'the specific headline comes first');
});
