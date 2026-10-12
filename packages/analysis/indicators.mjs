// ALPHA TERMINAL — deterministic technical analytics.
//
// Every function is causal: the value at index i depends only on bars[0..i].
// Pattern detectors that need future bars to be known (swing pivots) report
// `confirmedIndex`, the first bar index at which the pattern is knowable.
// Consumers must never display a pattern before its confirmedIndex, and must
// treat anything confirmed on a still-forming bar as provisional.
//
// Bar shape: { time: number (unix seconds), open, high, low, close, volume }

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values. */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** EMA over a series that may begin with nulls (used for MACD signal). */
function emaSparse(values, period) {
  const out = new Array(values.length).fill(null);
  const start = values.findIndex(isNum);
  if (start < 0) return out;
  const tail = ema(values.slice(start), period);
  for (let i = 0; i < tail.length; i++) out[start + i] = tail[i];
  return out;
}

/** Wilder RSI. */
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = val();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = val();
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => (isNum(f[i]) && isNum(s[i]) ? f[i] - s[i] : null));
  const signal = emaSparse(line, signalPeriod);
  const hist = line.map((v, i) => (isNum(v) && isNum(signal[i]) ? v - signal[i] : null));
  return { macd: line, signal, hist };
}

export function trueRange(bars) {
  return bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
}

/** Wilder ATR. */
export function atr(bars, period = 14) {
  const tr = trueRange(bars);
  const out = new Array(bars.length).fill(null);
  if (bars.length < period) return out;
  let prev = 0;
  for (let i = 0; i < period; i++) prev += tr[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** US/Eastern calendar day key, used to reset intraday VWAP each session. */
export function easternDayKey(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * VWAP from typical price.
 * anchor: 'session' resets each US/Eastern trading day (intraday charts);
 *         'none' accumulates from the first bar supplied (anchored VWAP).
 */
export function vwap(bars, anchor = 'session') {
  const out = new Array(bars.length).fill(null);
  let pv = 0;
  let vol = 0;
  let key = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (anchor === 'session') {
      const k = easternDayKey(b.time);
      if (k !== key) { pv = 0; vol = 0; key = k; }
    }
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume;
    vol += b.volume;
    out[i] = vol > 0 ? pv / vol : tp;
  }
  return out;
}

export function obv(bars) {
  const out = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    out[i] = out[i - 1] + (d > 0 ? bars[i].volume : d < 0 ? -bars[i].volume : 0);
  }
  return out;
}

/**
 * Strict pivot highs/lows. A pivot at index i needs `right` later bars, so it
 * is only knowable at confirmedIndex = i + right.
 */
export function swings(bars, left = 3, right = 3) {
  const out = [];
  for (let i = left; i < bars.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isHigh = false;
      if (bars[j].low <= bars[i].low) isLow = false;
    }
    if (isHigh) out.push({ type: 'high', index: i, time: bars[i].time, price: bars[i].high, confirmedIndex: i + right });
    if (isLow) out.push({ type: 'low', index: i, time: bars[i].time, price: bars[i].low, confirmedIndex: i + right });
  }
  return out;
}

/**
 * Close-based market structure.
 *  - BOS: close beyond the latest confirmed swing in the direction of the prevailing structure.
 *  - CHoCH: first close beyond a confirmed swing against the prevailing structure.
 * Only swings whose confirmedIndex <= i are visible at bar i, so no future data is used.
 * `lastBarClosed=false` marks events on the final bar as provisional (bar still forming).
 */
export function marketStructure(bars, { left = 3, right = 3, lastBarClosed = false } = {}) {
  const piv = swings(bars, left, right).sort((a, b) => a.confirmedIndex - b.confirmedIndex || a.index - b.index);
  const events = [];
  let p = 0;
  let lastHigh = null;
  let lastLow = null;
  let trend = 'neutral';
  for (let i = 0; i < bars.length; i++) {
    while (p < piv.length && piv[p].confirmedIndex <= i) {
      const s = piv[p++];
      if (s.type === 'high') lastHigh = { ...s, broken: false };
      else lastLow = { ...s, broken: false };
    }
    const c = bars[i].close;
    const provisional = i === bars.length - 1 && !lastBarClosed;
    if (lastHigh && !lastHigh.broken && i > lastHigh.index && c > lastHigh.price) {
      events.push({
        kind: trend === 'down' ? 'CHoCH' : 'BOS', direction: 'bull', index: i, time: bars[i].time,
        level: lastHigh.price, swingIndex: lastHigh.index, confirmedIndex: i, provisional,
      });
      lastHigh.broken = true;
      trend = 'up';
    }
    if (lastLow && !lastLow.broken && i > lastLow.index && c < lastLow.price) {
      events.push({
        kind: trend === 'up' ? 'CHoCH' : 'BOS', direction: 'bear', index: i, time: bars[i].time,
        level: lastLow.price, swingIndex: lastLow.index, confirmedIndex: i, provisional,
      });
      lastLow.broken = true;
      trend = 'down';
    }
  }
  return { events, trend, swings: piv };
}

/**
 * Three-candle fair value gaps. Gap is known when bar i closes (confirmedIndex = i).
 * `filledIndex` is the first later bar that trades through the whole gap.
 */
export function fairValueGaps(bars, { lastBarClosed = false, minGapPct = 0 } = {}) {
  const out = [];
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2];
    const c = bars[i];
    let gap = null;
    if (c.low > a.high) gap = { direction: 'bull', top: c.low, bottom: a.high };
    else if (c.high < a.low) gap = { direction: 'bear', top: a.low, bottom: c.high };
    if (!gap) continue;
    if ((gap.top - gap.bottom) / bars[i - 1].close < minGapPct) continue;
    let filledIndex = null;
    for (let j = i + 1; j < bars.length; j++) {
      if (gap.direction === 'bull' ? bars[j].low <= gap.bottom : bars[j].high >= gap.top) { filledIndex = j; break; }
    }
    out.push({
      ...gap, index: i - 1, startTime: a.time, time: bars[i - 1].time, confirmedIndex: i,
      filledIndex, provisional: i === bars.length - 1 && !lastBarClosed,
    });
  }
  return out;
}

/**
 * Order blocks: the last opposite-colour candle between the broken swing and the
 * structure break. Known once the break is known (confirmedIndex = break index).
 */
export function orderBlocks(bars, structureEvents) {
  const out = [];
  for (const ev of structureEvents) {
    const wantDown = ev.direction === 'bull';
    for (let k = ev.index - 1; k >= ev.swingIndex; k--) {
      const b = bars[k];
      if (wantDown ? b.close < b.open : b.close > b.open) {
        let mitigatedIndex = null;
        for (let j = ev.index + 1; j < bars.length; j++) {
          if (wantDown ? bars[j].low <= b.high : bars[j].high >= b.low) { mitigatedIndex = j; break; }
        }
        out.push({
          direction: ev.direction, index: k, time: b.time, top: b.high, bottom: b.low,
          confirmedIndex: ev.confirmedIndex, provisional: ev.provisional, source: ev.kind, mitigatedIndex,
        });
        break;
      }
    }
  }
  return out;
}

/** Volume-at-price histogram. Each bar's volume is spread evenly over its high-low range. */
export function volumeProfile(bars, binCount = 24, valueAreaPct = 0.7) {
  if (!bars.length) return { bins: [], poc: null, valueAreaLow: null, valueAreaHigh: null };
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) { lo = Math.min(lo, b.low); hi = Math.max(hi, b.high); }
  if (hi === lo) hi = lo + 1e-9;
  const size = (hi - lo) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({ low: lo + i * size, high: lo + (i + 1) * size, volume: 0 }));
  for (const b of bars) {
    const range = b.high - b.low;
    if (range <= 0) {
      bins[Math.min(binCount - 1, Math.floor((b.close - lo) / size))].volume += b.volume;
      continue;
    }
    for (const bin of bins) {
      const overlap = Math.min(b.high, bin.high) - Math.max(b.low, bin.low);
      if (overlap > 0) bin.volume += (b.volume * overlap) / range;
    }
  }
  let pocIdx = 0;
  bins.forEach((b, i) => { if (b.volume > bins[pocIdx].volume) pocIdx = i; });
  const total = bins.reduce((s, b) => s + b.volume, 0);
  let acc = bins[pocIdx].volume;
  let l = pocIdx;
  let h = pocIdx;
  while (acc < total * valueAreaPct && (l > 0 || h < binCount - 1)) {
    const down = l > 0 ? bins[l - 1].volume : -1;
    const up = h < binCount - 1 ? bins[h + 1].volume : -1;
    if (up >= down) acc += bins[++h].volume; else acc += bins[--l].volume;
  }
  const poc = (bins[pocIdx].low + bins[pocIdx].high) / 2;
  return { bins, poc, valueAreaLow: bins[l].low, valueAreaHigh: bins[h].high };
}

/**
 * Horizontal support/resistance from clustered, confirmed swing pivots.
 * Levels are classified relative to the last close.
 */
export function supportResistance(bars, { left = 3, right = 3, tolerance, maxLevels = 6 } = {}) {
  if (bars.length < left + right + 2) return [];
  const a = atr(bars, 14);
  const lastAtr = a[a.length - 1] ?? (bars[bars.length - 1].high - bars[bars.length - 1].low);
  const tol = tolerance ?? lastAtr * 0.5;
  const piv = swings(bars, left, right);
  const clusters = [];
  for (const s of piv) {
    const c = clusters.find((x) => Math.abs(x.price - s.price) <= tol);
    if (c) {
      c.price = (c.price * c.touches + s.price) / (c.touches + 1);
      c.touches += 1;
      c.lastIndex = Math.max(c.lastIndex, s.index);
    } else {
      clusters.push({ price: s.price, touches: 1, lastIndex: s.index });
    }
  }
  const last = bars[bars.length - 1].close;
  return clusters
    .map((c) => ({ ...c, kind: c.price >= last ? 'resistance' : 'support', strength: c.touches + c.lastIndex / bars.length }))
    .sort((x, y) => y.strength - x.strength)
    .slice(0, maxLevels)
    .sort((x, y) => y.price - x.price);
}

/** Simple trend regime from moving averages. Uses only completed values. */
export function trendRegime(closes) {
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const i = closes.length - 1;
  const c = closes[i];
  const m50 = s50[i];
  const m200 = s200[i];
  const m50Prev = s50[i - 10];
  if (!isNum(m50)) return { regime: 'insufficient', sma50: null, sma200: null };
  const slopeUp = isNum(m50Prev) ? m50 > m50Prev : null;
  let regime = 'range';
  if (c > m50 && (!isNum(m200) || m50 > m200) && slopeUp) regime = 'uptrend';
  else if (c < m50 && (!isNum(m200) || m50 < m200) && slopeUp === false) regime = 'downtrend';
  return { regime, sma50: m50, sma200: isNum(m200) ? m200 : null, slopeUp };
}

/** Aggregate daily bars into weeks (Monday-based, UTC). */
export function resampleWeekly(bars) {
  const out = [];
  let cur = null;
  let curKey = null;
  for (const b of bars) {
    const d = new Date(b.time * 1000);
    const dow = (d.getUTCDay() + 6) % 7;
    const key = Math.floor(b.time / 86400) - dow;
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { time: key * 86400, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      curKey = key;
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** One-call bundle used by both the API and the UI. */
export function analyzeBars(bars, { lastBarClosed = false, vwapAnchor = 'session' } = {}) {
  const closes = bars.map((b) => b.close);
  const structure = marketStructure(bars, { lastBarClosed });
  return {
    sma20: sma(closes, 20),
    ema20: ema(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    atr14: atr(bars, 14),
    vwap: vwap(bars, vwapAnchor),
    obv: obv(bars),
    structure,
    fvg: fairValueGaps(bars, { lastBarClosed }),
    orderBlocks: orderBlocks(bars, structure.events),
    levels: supportResistance(bars),
    profile: volumeProfile(bars),
    regime: trendRegime(closes),
  };
}
