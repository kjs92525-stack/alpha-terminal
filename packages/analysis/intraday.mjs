// Intraday helpers shared by the 4-hour ICT study, the live 4-hour signals and the API's chart bars.
// Input bars are { time (unix seconds), open, high, low, close, volume } as parsed from Alpaca or Yahoo.
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const offsetCache = new Map(); // UTC date → New York offset in hours (DST-aware, computed once a day)
export const etParts = (iso) => {
  const d = iso.slice(0, 10);
  let off = offsetCache.get(d);
  if (off == null) { const p = Object.fromEntries(ET.formatToParts(new Date(`${d}T16:00:00Z`)).map((x) => [x.type, x.value])); off = Number(p.hour) - 16; offsetCache.set(d, off); }
  const t = new Date(Date.parse(iso) + off * 3600e3);
  return { day: t.toISOString().slice(0, 10), h: t.getUTCHours(), m: t.getUTCMinutes() };
};

/** Alpaca 1-hour bars → regular-session 4-hour bars (09:30-13:30 and 13:30-16:00 ET) plus daily closes. */
export function toFourHour(hourly) {
  const blocks = new Map();
  for (const raw of hourly) {
    const b = { t: new Date(raw.time * 1000).toISOString(), o: raw.open, h: raw.high, l: raw.low, c: raw.close, v: raw.volume };
    const { day, h } = etParts(b.t);
    if (h < 9 || h > 15) continue;                  // the 09:00 bar starts at 09:30 for regular-session data; 16:00+ is after hours
    const key = `${day}|${h < 13 ? 'A' : 'B'}`;
    const x = blocks.get(key);
    if (!x) blocks.set(key, { day, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; x.v += b.v; }
  }
  return [...blocks.values()].sort((a, b) => (a.t < b.t ? -1 : 1));
}


/** keep only regular-session bars (09:30-16:00 New York) from 5- / 15-minute data */
export function regularSession(bars) {
  return bars.filter((b) => { const { h, m } = etParts(new Date(b.time * 1000).toISOString()); const t = h * 60 + m; return t >= 570 && t < 960; });
}
/** 4-hour bars in the API's Bar shape */
export function fourHourBars(hourly) {
  return toFourHour(hourly).map((b) => ({ time: Math.floor(Date.parse(b.t) / 1000), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
}
