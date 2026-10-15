// Point-in-time story check for backtests: only quarters whose filing date is on or before the
// trade date count, so a breakout is judged with what an investor could have read that day.
const DAY = 86400000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function known(list, date) {
  return (list ?? []).filter((q) => q?.end && q.filed && finite(q.value) && q.filed <= date && q.end < q.filed).sort((a, b) => a.end.localeCompare(b.end));
}
function yearAgo(list, end) {
  const t = Date.parse(end) - 365 * DAY;
  return list.find((q) => Math.abs(Date.parse(q.end) - t) <= 25 * DAY) ?? null;
}

/**
 * facts: { revenueQuarterly, netIncomeQuarterly } with {end, value, filed}. date: 'YYYY-MM-DD'.
 * improving = same idea as the live screen: accelerating sales, or net income better than a year ago.
 */
export function storyAsOf(facts, date) {
  const rev = known(facts?.revenueQuarterly, date), ni = known(facts?.netIncomeQuarterly, date);
  const last = rev.at(-1);
  if (!last || Date.parse(date) - Date.parse(last.filed) > 200 * DAY) return { known: false };
  const yoy = (q) => { const a = yearAgo(rev, q.end); return a && a.value > 0 ? q.value / a.value - 1 : null; };
  const revYoY = yoy(last), prev = rev.at(-2), prevYoY = prev ? yoy(prev) : null;
  const lastNi = ni.at(-1), agoNi = lastNi ? yearAgo(ni, lastNi.end) : null;
  if (!finite(revYoY) && !(lastNi && agoNi)) return { known: false };
  const revAccel = finite(revYoY) && finite(prevYoY) && revYoY > 0.05 && revYoY > prevYoY + 0.02;
  const niImproved = Boolean(lastNi && agoNi && lastNi.value > agoNi.value && (lastNi.value > 0 || agoNi.value < 0));
  return { known: true, revYoY, prevYoY, revAccel, niImproved, improving: revAccel || niImproved, filed: last.filed };
}
