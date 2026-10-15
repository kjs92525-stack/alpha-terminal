import test from 'node:test';
import assert from 'node:assert/strict';
import { storyEvents, storyEventGroups } from '../packages/pipeline/story-events.mjs';

const t0 = Date.UTC(2024, 0, 1) / 1000;
const bars = Array.from({ length: 700 }, (_, i) => { const c = 10 + (i < 400 ? -i * 0.01 : (i - 400) * 0.02); return { time: t0 + i * 86400, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1e6 }; });
const spy = new Map(bars.map((b, i) => [b.time, { ...b, open: 100 + i * 0.01, close: 100 + i * 0.01 }]));
const d = (i) => new Date((t0 + i * 86400) * 1000).toISOString().slice(0, 10);
// quarters ending every ~91 days, filed 40 days later; sales flat then accelerating
const q = (k, value) => ({ end: d(k * 91), value, filed: d(k * 91 + 40) });
const facts = {
  revenueQuarterly: [q(0, 100), q(1, 100), q(2, 100), q(3, 100), q(4, 101), q(5, 110), q(6, 130)],
  netIncomeQuarterly: [q(0, -10), q(1, -10), q(2, -10), q(3, -10), q(4, -10), q(5, -8), q(6, -5)],
};

test('one event per new quarter, entered the session after the filing, judged only on filed quarters', () => {
  const ev = storyEvents(bars, facts, spy);
  assert.ok(ev.length >= 2);
  for (const e of ev) assert.ok(e.date > e.story.filed);
  const last = ev.at(-1);
  assert.equal(last.story.filed, d(6 * 91 + 40));
  assert.ok(last.story.improving && last.story.revAccel);
  assert.equal(last.entry, bars.find((b) => d((b.time - t0) / 86400) > last.story.filed).open);
  assert.ok(last.results[20].ret > 0 && last.results[20].r === null);
  // later price moves do not change the event set
  const crash = bars.map((b, i) => (i > 600 ? { ...b, open: 1, high: 1, low: 1, close: 1 } : b));
  assert.deepEqual(storyEvents(crash, facts, spy).map((e) => e.date), ev.map((e) => e.date));
});

test('groups split by story and 52-week position; illiquid names are skipped', () => {
  const ev = storyEvents(bars, facts, spy);
  const g = storyEventGroups(ev);
  assert.equal(g.eventImproving.length + g.eventNotImproving.length, g.eventAll.length);
  assert.ok(g.eventImprovingNearLow.every((e) => e.posIn52w <= 0.33 && e.story.improving));
  assert.equal(storyEvents(bars.map((b) => ({ ...b, volume: 10 })), facts, spy).length, 0);
});
