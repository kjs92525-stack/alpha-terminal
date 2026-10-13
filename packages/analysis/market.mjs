// ALPHA TERMINAL — market data parsers (provider responses -> normalized bars).

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

function valid(b) {
  return [b.open, b.high, b.low, b.close].every(Number.isFinite) && b.high >= b.low && Number.isFinite(b.time);
}

/** Stooq daily CSV: Date,Open,High,Low,Close,Volume */
export function parseStooqCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  if (!lines.length || !/^date,open,high,low,close/i.test(lines[0])) return [];
  const bars = [];
  for (const line of lines.slice(1)) {
    const [date, o, h, l, c, v] = line.split(',');
    const t = Date.parse(`${date}T00:00:00Z`);
    const bar = { time: t / 1000, open: num(o), high: num(h), low: num(l), close: num(c), volume: Number.isFinite(num(v)) ? num(v) : 0 };
    if (valid(bar)) bars.push(bar);
  }
  return bars.sort((a, b) => a.time - b.time);
}

/** Yahoo Finance chart JSON (v8/finance/chart). Daily bars are normalised to 00:00 UTC of the exchange date. */
export function parseYahooChart(json, { daily = false } = {}) {
  const r = json?.chart?.result?.[0];
  if (!r || !Array.isArray(r.timestamp)) return { bars: [], meta: null };
  const q = r.indicators?.quote?.[0] ?? {};
  const offset = r.meta?.gmtoffset ?? 0;
  const bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    let t = r.timestamp[i];
    if (daily) {
      const local = new Date((t + offset) * 1000);
      t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) / 1000;
    }
    const bar = { time: t, open: num(q.open?.[i]), high: num(q.high?.[i]), low: num(q.low?.[i]), close: num(q.close?.[i]), volume: num(q.volume?.[i]) || 0 };
    if (valid(bar)) bars.push(bar);
  }
  const dedup = [];
  for (const b of bars.sort((a, b) => a.time - b.time)) {
    if (dedup.length && dedup[dedup.length - 1].time === b.time) dedup[dedup.length - 1] = b;
    else dedup.push(b);
  }
  return {
    bars: dedup,
    meta: {
      symbol: r.meta?.symbol ?? null,
      currency: r.meta?.currency ?? null,
      exchange: r.meta?.exchangeName ?? null,
      timezone: r.meta?.exchangeTimezoneName ?? null,
      regularMarketTime: r.meta?.regularMarketTime ?? null,
      regularMarketPrice: r.meta?.regularMarketPrice ?? null,
    },
  };
}

/** Drop the last bar if it belongs to a session that has not closed yet (daily data, US equities). */
export function isDailyBarClosed(barTimeSec, nowMs = Date.now()) {
  // US regular session closes 16:00 America/New_York. Compare using ET wall-clock.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const barDay = new Date(barTimeSec * 1000).toISOString().slice(0, 10);
  if (barDay < today) return true;
  if (barDay > today) return false;
  // 16:20 ET: the close plus the free SIP feed's 15-minute delay, so the bar is final
  const h = Number(parts.hour) % 24;
  return h > 16 || (h === 16 && Number(parts.minute) >= 20);
}
