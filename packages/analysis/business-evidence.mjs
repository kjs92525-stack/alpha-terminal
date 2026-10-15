// What the latest reported quarters say, with the same definitions the filing event study measured
// (story-pit.mjs → backtest [공시] rows): sales growth accelerating (YoY > 5% and > the prior
// quarter's YoY + 2%p) and net income better than a year ago (and positive, or the year-ago one
// negative). On 2024-2026 filings, acceleration beat SPY over 120 sessions; income alone did not.
const DAY = 86400000;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

export const EVENT_EVIDENCE = {
  both: { n: 1305, excess120: 0.045 },
  revAccel: { n: 1923, excess120: 0.031 },
  niOnly: { n: 5406, excess120: -0.003 },
  improvingNearLow: { n: 1607, excess120: -0.033 },
};

export function businessEvidence(row, asOf) {
  const rev = (row?.revenueYoY ?? []).filter((q) => q?.end && num(q.yoy)).sort((a, b) => a.end.localeCompare(b.end));
  const ni = (row?.netIncomeQ ?? []).filter((q) => q?.end && num(q.value)).sort((a, b) => a.end.localeCompare(b.end));
  const last = rev.at(-1), prev = rev.at(-2);
  const fresh = (end) => end && Date.parse(asOf) - Date.parse(end) <= 245 * DAY;
  const revAccel = Boolean(fresh(last?.end) && prev && Date.parse(last.end) - Date.parse(prev.end) <= 110 * DAY && last.yoy > 0.05 && last.yoy > prev.yoy + 0.02);
  const lastNi = ni.at(-1), t = lastNi ? Date.parse(lastNi.end) - 365 * DAY : 0;
  const ago = lastNi ? ni.find((q) => Math.abs(Date.parse(q.end) - t) <= 25 * DAY) : null;
  const niImproved = Boolean(fresh(lastNi?.end) && ago && lastNi.value > ago.value && (lastNi.value > 0 || ago.value < 0));
  return { revAccel, niImproved, both: revAccel && niImproved, revYoY: last?.yoy ?? null, prevYoY: prev?.yoy ?? null };
}
