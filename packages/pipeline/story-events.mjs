// Event study of the business-change thesis without any chart rule: buy the open after a quarterly
// filing, hold h sessions (no stop), compare with SPY. Split by what that filing showed (point in
// time, story-pit.mjs) and by where the price sat in its 52-week range the day before.
//
// Limits: filings history ~3 years, so events fall in 2024-2026 (one market regime); currently
// listed stocks only (survivorship); filing time of day unknown, so entry is the next session.
import { storyAsOf } from '../analysis/story-pit.mjs';

const HORIZONS = [20, 60, 120];
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

/** One event per revenue filing that made that quarter the latest known one. */
export function storyEvents(bars, facts, spyByTime, { minPrice = 2, minDollarVol = 1e6 } = {}) {
  const dates = bars.map((b) => day(b.time));
  const filed = [...new Set((facts?.revenueQuarterly ?? []).map((q) => q?.filed).filter(Boolean))].sort();
  const out = [];
  for (const d of filed) {
    const story = storyAsOf(facts, d);
    if (!story.known || story.filed !== d) continue;
    let e = dates.findIndex((x) => x > d);
    if (e < 253 || Date.parse(dates[e]) - Date.parse(d) > 5 * 86400000) continue;
    const prev = bars.slice(e - 252, e), last = bars[e - 1];
    const dollarVol = prev.slice(-20).reduce((s, b) => s + b.close * b.volume, 0) / 20;
    if (last.close < minPrice || dollarVol < minDollarVol) continue;
    const hi = Math.max(...prev.map((b) => b.high)), lo = Math.min(...prev.map((b) => b.low));
    const entry = bars[e].open;
    if (!(entry > 0) || !(hi > lo)) continue;
    const ev = { date: dates[e], entry, posIn52w: (last.close - lo) / (hi - lo), ret126: last.close / bars[e - 127].close - 1, story, results: {} };
    const spyEntry = spyByTime.get(bars[e].time)?.open;
    for (const h of HORIZONS) {
      const x = e + h - 1;
      if (x >= bars.length) { ev.results[h] = null; continue; }
      const spyExit = spyByTime.get(bars[x].time)?.close;
      ev.results[h] = { ret: bars[x].close / entry - 1, r: null, stopped: false, spy: spyEntry && spyExit ? spyExit / spyEntry - 1 : null };
    }
    out.push(ev);
  }
  return out;
}

export function storyEventGroups(events) {
  const imp = (e) => e.story.improving, low = (e) => e.posIn52w <= 0.33, high = (e) => e.posIn52w >= 0.8;
  return {
    eventAll: events,
    eventImproving: events.filter(imp),
    eventNotImproving: events.filter((e) => !imp(e)),
    eventRevAccel: events.filter((e) => e.story.revAccel),
    eventNiImproved: events.filter((e) => e.story.niImproved),
    eventBoth: events.filter((e) => e.story.revAccel && e.story.niImproved),
    eventImprovingNearLow: events.filter((e) => imp(e) && low(e)),
    eventImprovingNearHigh: events.filter((e) => imp(e) && high(e)),
    eventNotImprovingNearLow: events.filter((e) => !imp(e) && low(e)),
    eventBothNearLow: events.filter((e) => e.story.revAccel && e.story.niImproved && low(e)),
  };
}

// Forward (out-of-sample) record of the same events: each night, quarters filed in the last few
// days are written once to an append-only ledger with what the filing showed; returns are measured
// from the first open after the night they were recorded, so nothing here can be fitted afterwards.
export function recordFilingEvent(symbol, facts, bars, asOf, { maxAgeDays = 7, minPrice = 2, minDollarVol = 1e6 } = {}) {
  const story = storyAsOf(facts, asOf);
  if (!story.known || !story.filed || Date.parse(asOf) - Date.parse(story.filed) > maxAgeDays * 86400000) return null;
  const prev = (bars ?? []).filter((b) => day(b.time) <= asOf).slice(-252);
  if (prev.length < 130) return null;
  const last = prev.at(-1), dollarVol = prev.slice(-20).reduce((s, b) => s + b.close * b.volume, 0) / 20;
  if (last.close < minPrice || dollarVol < minDollarVol) return null;
  const hi = Math.max(...prev.map((b) => b.high)), lo = Math.min(...prev.map((b) => b.low));
  return { id: `${story.filed}:${symbol}`, symbol, filed: story.filed, recordedAsOf: asOf, close: last.close, posIn52w: hi > lo ? (last.close - lo) / (hi - lo) : null,
    story: { known: true, filed: story.filed, revYoY: story.revYoY, prevYoY: story.prevYoY, revAccel: story.revAccel, niImproved: story.niImproved, improving: story.improving } };
}

export function evaluateFilingEvent(rec, bars, spyByTime) {
  const e = bars.findIndex((b) => day(b.time) > rec.recordedAsOf);
  const results = {};
  for (const h of HORIZONS) {
    const x = e + h - 1;
    if (e < 0 || x >= bars.length) { results[h] = null; continue; }
    const spyEntry = spyByTime.get(bars[e].time)?.open, spyExit = spyByTime.get(bars[x].time)?.close;
    results[h] = { ret: bars[x].close / bars[e].open - 1, r: null, stopped: false, spy: spyEntry && spyExit ? spyExit / spyEntry - 1 : null };
  }
  return { ...rec, entryDate: e >= 0 ? day(bars[e].time) : null, results };
}
