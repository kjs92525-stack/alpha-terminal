// Paper trading with one fixed rule set, so the site's picks build a real forward track record.
// Every night each recorded signal is re-simulated from its signal date on the bars known so far
// (deterministic, no hidden state). Fills and exits use daily bars: when a bar touches both the
// stop and a profit level, the stop is assumed first (conservative).
export const PAPER_RULES = {
  fillWindow: 10,      // sessions an entry order stays live after the signal
  breakevenAtR: 1,     // move the stop to the entry once price reaches +1R
  partialAtR: 2,       // sell half at +2R
  trailMa: 50,         // after the partial, exit the rest on a close below the 50-day average
  timeStopSessions: 40, timeStopMinR: 0.5, // no partial and under +0.5R after 40 sessions → exit
  maxSessions: 120,
};
const sma = (bars, i, n) => (i + 1 >= n ? bars.slice(i + 1 - n, i + 1).reduce((s, b) => s + b.close, 0) / n : null);
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * signal: { signalDate, entry, stop, target, entryType: 'buy-stop'|'limit'|'zone'|'market' }
 * bars: daily bars ascending (time in seconds). spy: SPY daily bars for the comparison.
 */
export function simulatePaperTrade(signal, bars, spy = [], rules = PAPER_RULES) {
  const start = bars.findIndex((b) => day(b.time) > signal.signalDate);
  const base = { status: 'pending', fill: null, events: [] };
  if (!(signal.entry > signal.stop) || signal.stop <= 0) return { ...base, status: 'invalid' };
  if (start < 0) return base;
  let fillIdx = -1, fill = null;
  for (let i = start; i < bars.length && i < start + rules.fillWindow; i++) {
    const b = bars[i];
    if (b.low <= signal.stop && !(signal.entryType === 'market' && i === start)) return { ...base, status: 'invalidated', events: [{ date: day(b.time), kind: 'invalidated', text: `진입 전에 무효화 가격 $${signal.stop} 이탈 — 주문 취소` }] };
    if (signal.entryType === 'market') { fill = b.open; fillIdx = i; break; }
    if (signal.entryType === 'buy-stop' && b.high >= signal.entry) { fill = Math.max(b.open, signal.entry); fillIdx = i; break; }
    if ((signal.entryType === 'limit' || signal.entryType === 'zone') && b.low <= signal.entry) { fill = Math.min(b.open, signal.entry); fillIdx = i; break; }
  }
  if (fillIdx < 0) return bars.length - start >= rules.fillWindow ? { ...base, status: 'expired' } : base;

  const R = fill - signal.stop;
  if (!(R > 0)) return { ...base, status: 'invalid' };
  const events = [{ date: day(bars[fillIdx].time), kind: 'filled', text: `$${fill.toFixed(2)} 체결 (1R = $${R.toFixed(2)})` }];
  let stop = signal.stop, half = false, remaining = 1, realized = 0, exitIdx = -1, exitReason = null;
  const exitAll = (i, px, reason) => { realized += remaining * (px - fill); remaining = 0; exitIdx = i; exitReason = reason; events.push({ date: day(bars[i].time), kind: 'exit', text: `${reason} $${px.toFixed(2)}` }); };
  for (let i = fillIdx; i < bars.length && remaining > 0; i++) {
    const b = bars[i], held = i - fillIdx;
    // stop first (gap through the stop fills at the open)
    if (i > fillIdx && b.open <= stop) { exitAll(i, b.open, stop >= fill ? '본전 손절(갭)' : '손절(갭)'); break; }
    if (b.low <= stop) { exitAll(i, stop, stop >= fill ? '본전 손절' : '손절'); break; }
    if (!half && b.high >= fill + rules.partialAtR * R) {
      const px = Math.max(b.open, fill + rules.partialAtR * R);
      realized += 0.5 * (px - fill); remaining = 0.5; half = true;
      events.push({ date: day(b.time), kind: 'partial', text: `+${rules.partialAtR}R 절반 익절 $${px.toFixed(2)}` });
    }
    if (stop < fill && b.high >= fill + rules.breakevenAtR * R) { stop = fill; events.push({ date: day(b.time), kind: 'breakeven', text: `+${rules.breakevenAtR}R 도달 — 손절가를 매수가 $${fill.toFixed(2)}로 올림` }); }
    const ma = sma(bars, i, rules.trailMa);
    if (half && ma !== null && b.close < ma) { exitAll(i, b.close, `${rules.trailMa}일선 이탈 매도`); break; }
    if (!half && held >= rules.timeStopSessions && b.close < fill + rules.timeStopMinR * R) { exitAll(i, b.close, `${rules.timeStopSessions}거래일 진전 없음 — 시간 손절`); break; }
    if (held >= rules.maxSessions) { exitAll(i, b.close, `최대 보유 ${rules.maxSessions}거래일 만료`); break; }
  }
  const lastIdx = exitIdx >= 0 ? exitIdx : bars.length - 1;
  const markPx = bars[lastIdx].close;
  const totalPnl = realized + remaining * (markPx - fill);
  const spyAt = (t) => { let px = null; for (const s of spy) { if (s.time <= t) px = s.close; else break; } return px; };
  const spyFrom = (() => { for (const s of spy) if (s.time >= bars[fillIdx].time) return s.open; return null; })(), spyTo = spyAt(bars[lastIdx].time);
  const ret = totalPnl / fill, spyRet = spyFrom && spyTo ? spyTo / spyFrom - 1 : null;
  return {
    status: remaining > 0 ? 'open' : 'closed', fill, fillDate: day(bars[fillIdx].time), stop, half, R,
    rMultiple: totalPnl / R, ret, spyRet, vsSpy: spyRet === null ? null : ret - spyRet,
    exitDate: exitIdx >= 0 ? day(bars[exitIdx].time) : null, exitReason, sessions: lastIdx - fillIdx, lastClose: markPx, events,
  };
}

/** Summary over simulated trades; closed trades only for win rate / expectancy. */
export function summarizePaper(trades) {
  const closed = trades.filter((t) => t.result?.status === 'closed');
  const open = trades.filter((t) => t.result?.status === 'open');
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const vs = closed.map((t) => t.result.vsSpy).filter((v) => typeof v === 'number');
  return {
    signals: trades.length, filled: closed.length + open.length, closed: closed.length, open: open.length,
    pending: trades.filter((t) => t.result?.status === 'pending').length,
    expiredOrInvalidated: trades.filter((t) => ['expired', 'invalidated', 'invalid'].includes(t.result?.status)).length,
    winRate: closed.length ? closed.filter((t) => t.result.rMultiple > 0).length / closed.length : null,
    avgR: mean(closed.map((t) => t.result.rMultiple)), totalR: closed.reduce((s, t) => s + t.result.rMultiple, 0),
    avgReturn: mean(closed.map((t) => t.result.ret)), avgVsSpy: mean(vs),
    openR: open.reduce((s, t) => s + t.result.rMultiple, 0),
    enough: closed.length >= 30,
  };
}
