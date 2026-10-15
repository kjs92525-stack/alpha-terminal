// Event study (DESIGN P4) of the information-edge signals shown on the site: did an insider buying
// cluster or an offering / shelf filing, known on the day it became public, lead to excess return?
// Point in time: Form 4 rows count from their filing date, filings from theirs; entry is the open
// of the next session; exit h sessions later at the close; no stop; vs SPY.
//
// Limits: Finnhub history depth varies by symbol; currently listed stocks only (survivorship);
// market cap at the event is not known, so large-cap note programmes (424B5) are not separated.
import { insiderSignal } from '../analysis/edge-signals.mjs';
import { storyAsOf } from '../analysis/story-pit.mjs';

const HORIZONS = [20, 60, 120];
const DAY = 86400000;
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const COOLDOWN = 60;

function measure(bars, dates, d, spyByTime, { minPrice = 2, minDollarVol = 1e6 } = {}) {
  const e = dates.findIndex((x) => x > d);
  if (e < 130 || Date.parse(dates[e]) - Date.parse(d) > 5 * DAY) return null;
  const last = bars[e - 1];
  const dollarVol = bars.slice(e - 20, e).reduce((s, b) => s + b.close * b.volume, 0) / 20;
  if (last.close < minPrice || dollarVol < minDollarVol || !(bars[e].open > 0)) return null;
  const prev = bars.slice(Math.max(0, e - 252), e), hi = Math.max(...prev.map((b) => b.high)), lo = Math.min(...prev.map((b) => b.low));
  const entry = bars[e].open, spyEntry = spyByTime.get(bars[e].time)?.open, results = {};
  for (const h of HORIZONS) {
    const x = e + h - 1;
    if (x >= bars.length) { results[h] = null; continue; }
    const spyExit = spyByTime.get(bars[x].time)?.close;
    results[h] = { ret: bars[x].close / entry - 1, r: null, stopped: false, spy: spyEntry && spyExit ? spyExit / spyEntry - 1 : null };
  }
  return { date: dates[e], entry, posIn52w: hi > lo ? (last.close - lo) / (hi - lo) : null, ret63: e >= 64 ? last.close / bars[e - 64].close - 1 : null, results };
}

/** First day (by Form 4 filing date) each insider cluster became public; one per COOLDOWN days. */
export function insiderEvents(bars, rows, spyByTime, facts = null) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const dates = bars.map((b) => day(b.time));
  const filed = [...new Set(rows.filter((r) => r?.transactionCode === 'P' && r.filingDate).map((r) => String(r.filingDate).slice(0, 10)))].sort();
  const out = [];
  let until = '';
  for (const d of filed) {
    if (d < until) continue;
    const known = rows.filter((r) => r?.filingDate && String(r.filingDate).slice(0, 10) <= d);
    const sig = insiderSignal(known, d, 30);
    if (!sig?.cluster) continue;
    const m = measure(bars, dates, d, spyByTime);
    if (!m) continue;
    out.push({ kind: 'insider', filed: d, buyers: sig.buyers, buyValue: sig.buyValue, story: facts ? storyAsOf(facts, d) : null, ...m });
    until = new Date(Date.parse(d) + COOLDOWN * DAY).toISOString().slice(0, 10);
  }
  return out;
}

const OFFERING = /^424B[1345](\/A)?$/i, SHELF = /^(S-3|S-3ASR|F-3|S-1|F-1)(\/A)?$/i;
/** Offering prospectuses and shelf/IPO registrations, by filing date; one per kind per COOLDOWN days. */
export function filingEvents(bars, filings, spyByTime, facts = null) {
  if (!Array.isArray(filings) || !filings.length) return [];
  const dates = bars.map((b) => day(b.time));
  const out = [];
  for (const [kind, re] of [['offering', OFFERING], ['shelf', SHELF]]) {
    let until = '';
    for (const d of [...new Set(filings.filter((f) => re.test(String(f?.form ?? '').trim())).map((f) => String(f.filingDate ?? '').slice(0, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort()) {
      if (d < until) continue;
      const m = measure(bars, dates, d, spyByTime);
      if (!m) continue;
      out.push({ kind, filed: d, story: facts ? storyAsOf(facts, d) : null, ...m });
      until = new Date(Date.parse(d) + COOLDOWN * DAY).toISOString().slice(0, 10);
    }
  }
  return out;
}

export function edgeEventGroups(events) {
  const ins = events.filter((e) => e.kind === 'insider'), off = events.filter((e) => e.kind === 'offering'), shelf = events.filter((e) => e.kind === 'shelf');
  const accel = (e) => e.story?.known && e.story.revAccel, imp = (e) => e.story?.known && e.story.improving;
  return {
    insiderCluster: ins,
    insiderMultiBuyers: ins.filter((e) => e.buyers >= 2),
    insiderOver1M: ins.filter((e) => e.buyValue >= 1e6),
    insiderNearLow: ins.filter((e) => e.posIn52w != null && e.posIn52w <= 0.33),
    insiderRevAccel: ins.filter(accel),
    insiderNotImproving: ins.filter((e) => e.story?.known && !e.story.improving),
    offering424B: off,
    offeringNotImproving: off.filter((e) => e.story?.known && !e.story.improving),
    offeringImproving: off.filter(imp),
    shelfRegistration: shelf,
  };
}
