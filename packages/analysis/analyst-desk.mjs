// Analyst desk: every evening the desk reads the day's candidate lists, classifies each chart the way a
// swing-trading analyst would (breakout, tight base, trend pullback, oversold reversal), writes a trade
// plan (trigger, stop, first target, trailing average) and chooses position sizes from a fixed risk budget.
// The picks are stored once and never edited; the paper account is replayed from them every night on real
// daily bars, so win rate and P&L are reproducible from the stored picks plus prices.
//
// Fill conventions (conservative, daily bars only): orders work from the session after the pick; a bar that
// touches both the stop and a profit level is treated as stopped first; gaps through a stop fill at the open.

export const DESK_RULES = {
  version: 2,
  startEquity: 100_000,
  costPerSide: 0.001,            // commission + spread, each side (liquid names)
  costSmallPerSide: 0.0025,      // small caps and sub-$10 stocks: wider spreads
  stopSlippage: 0.002,           // a resting stop fills a little below its price
  picksPerDay: { SELECTIVE: 5, LIMIT: 3, UNKNOWN: 3, WAIT: 1 },
  riskPct: { SELECTIVE: 0.01, LIMIT: 0.007, UNKNOWN: 0.007, WAIT: 0.0035 }, // equity risked per trade
  maxPositionPct: 0.15,
  maxOpen: 12,
  maxHeatPct: 0.06,              // all open positions together may lose at most 6% of equity to their stops
  maxSectorOpen: 3,
  ddHalfRisk: 0.08, ddHalt: 0.15, // account drawdown: halve new risk at -8%, stop new entries at -15%
  ddHaltSessions: 20,            // a halt lasts this many sessions, then the desk restarts from the current equity
  recoverGain: 0.05,             // after a restart, new risk stays halved until equity is 5% above the restart level
  reentryCooldown: 10,           // sessions before re-buying a name that was stopped out
  earningsBlackout: 5,           // no new entry with a report inside this many sessions
  offeringBlackoutDays: 90,      // a share offering (424B, non-large-cap) this recent excludes the stock
  minQuality: 55,
  minQualityWait: 80,            // when the market verdict is WAIT, only the strongest single setup
  maxStopPct: 0.12,
  minStopPct: 0.02,              // a stop closer than 2% is noise, not a plan
  minAtrPct: 0.008,              // daily range under 0.8%: pinned price (pending takeover, etc.), not a trend trade              // skip plans whose stop is further than 12% below the trigger
  maxChase: 0.04,                // never buy an open more than 4% above the planned price
  partialAtR: 2, breakevenAtR: 1,
  timeStopSessions: 25, timeStopMinR: 0.5, maxSessions: 120,
  minPrice: 5,
  minAdv: 10_000_000,            // applied only when bars carry consolidated (SIP) volume
  maxAdvPct: 0.01,               // never more than 1% of a day's dollar volume
};
const FUND_NAME = /\b(ETF|ETN|Fund|Trust|ProShares|Direxion|iShares|SPDR|Invesco QQQ|Leveraged|Ultra(Pro|Short)?|[23]x)\b/i;

export const SETUP_LABEL = { breakout: '신고가 돌파', base: '수축 후 돌파 대기', pullback: '추세 눌림목', reversal: '과매도 반등' };
export const capBucket = (mcap) => (mcap == null ? '미분류' : mcap >= 10e9 ? '대형주' : mcap >= 2e9 ? '중형주' : '소형주');

// ---------- indicators ----------
function emaSeries(cl, n) { const o = new Array(cl.length).fill(NaN), k = 2 / (n + 1); let e = NaN; for (let i = 0; i < cl.length; i++) { if (i === n - 1) { let s = 0; for (let j = 0; j < n; j++) s += cl[j]; e = s / n; } else if (i >= n) e = cl[i] * k + e * (1 - k); o[i] = e; } return o; }
function smaSeries(cl, n) { const o = new Array(cl.length).fill(NaN); let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= n) s -= cl[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
const series = new WeakMap();
/** Cached per-bars-array indicator series (bars arrays are not mutated). */
export function seriesFor(bars) {
  let x = series.get(bars); if (x) return x;
  const cl = bars.map((b) => b.c);
  x = { cl, ema10: emaSeries(cl, 10), ema20: emaSeries(cl, 20), sma50: smaSeries(cl, 50), sma200: smaSeries(cl, 200) };
  series.set(bars, x); return x;
}
function atrAt(bars, i, n) { let s = 0, k = 0; for (let j = Math.max(1, i - n + 1); j <= i; j++) { const b = bars[j], pc = bars[j - 1].c; s += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); k++; } return k ? s / k : NaN; }
function rsiAt(cl, i, n = 14) { if (i < n + 1) return null; let g = 0, l = 0; const from = Math.max(1, i - 120); for (let j = from; j <= i; j++) { const d = cl[j] - cl[j - 1], up = Math.max(d, 0), dn = Math.max(-d, 0); if (j < from + n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; } } return 100 - 100 / (1 + g / (l || 1e-9)); }

export function indicatorsAt(bars, i) {
  const s = seriesFor(bars), c = bars[i].c;
  let hi20 = 0, lo5 = Infinity, lo10 = Infinity, hi52 = 0, v20 = 0, dv20 = 0;
  for (let j = Math.max(0, i - 20); j < i; j++) hi20 = Math.max(hi20, bars[j].h);
  for (let j = Math.max(0, i - 4); j <= i; j++) lo5 = Math.min(lo5, bars[j].l);
  for (let j = Math.max(0, i - 9); j <= i; j++) lo10 = Math.min(lo10, bars[j].l);
  for (let j = Math.max(0, i - 251); j <= i; j++) hi52 = Math.max(hi52, bars[j].h);
  const nv = Math.min(20, i + 1); for (let j = i - nv + 1; j <= i; j++) { v20 += bars[j].v; dv20 += bars[j].v * bars[j].c; }
  const lr = []; for (let j = Math.max(1, i - 59); j <= i; j++) lr.push(Math.log(s.cl[j] / s.cl[j - 1]));
  const m = lr.reduce((a, b) => a + b, 0) / (lr.length || 1);
  const vol60 = lr.length > 10 ? Math.sqrt(lr.reduce((a, b) => a + (b - m) ** 2, 0) / (lr.length - 1) * 252) : null;
  const atr14 = atrAt(bars, i, 14), atr10 = atrAt(bars, i, 10), atr50 = atrAt(bars, i, 50);
  return {
    c, h: bars[i].h, l: bars[i].l, o: bars[i].o, ema10: s.ema10[i], ema20: s.ema20[i], sma50: s.sma50[i], sma200: s.sma200[i],
    atr: atr14, atrPct: atr14 / c, contraction: atr10 / atr50, rsi: rsiAt(s.cl, i), hi20, hi52, lo5, lo10,
    relVol: v20 ? bars[i].v / (v20 / nv) : 1, adv20: dv20 / nv, vol60,
    ret1: i >= 1 ? c / s.cl[i - 1] - 1 : 0, ret5: i >= 5 ? c / s.cl[i - 5] - 1 : 0, ret126: i >= 126 ? c / s.cl[i - 126] - 1 : null,
    ext50: Number.isFinite(s.sma50[i]) ? c / s.sma50[i] - 1 : null, bars: i + 1,
  };
}

const r2 = (x) => Math.round(x * 100) / 100;
const nextWeekday = (date) => { const t = new Date(date + 'T00:00:00Z'); do t.setUTCDate(t.getUTCDate() + 1); while (t.getUTCDay() % 6 === 0); return t.toISOString().slice(0, 10); };
/** Wilson 95% interval for a proportion: how wide the truth can be around an observed win rate. */
export function wilson(k, n, z = 1.96) { if (!n) return null; const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }
const pctS = (x, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function trailFor(atrPct) { return atrPct < 0.025 ? { ma: 'sma50', label: '50일선' } : atrPct < 0.045 ? { ma: 'ema20', label: '20일 지수이평' } : { ma: 'ema10', label: '10일 지수이평' }; }

/**
 * Read one chart at bar i. meta: { score (0-100 list score), spyRet126 }.
 * Returns { setup, quality, plan, reasons[], warnings[], thesis } or { pass: reason }.
 */
export function analyze(bars, i, meta = {}, rules = DESK_RULES) {
  if (i < 60) return { pass: '시세 이력 부족' };
  const x = indicatorsAt(bars, i), up = Number.isFinite(x.sma200) && x.sma50 > x.sma200 && x.c > x.sma200;
  if (x.c < rules.minPrice) return { pass: `주가 $${rules.minPrice} 미만` };
  if (meta.volumeReliable && rules.minAdv && x.adv20 < rules.minAdv) return { pass: `하루 거래대금 $${(x.adv20 / 1e6).toFixed(1)}M, 기준 미달` };
  if (meta.earningsIn != null && meta.earningsIn <= rules.earningsBlackout) return { pass: `실적 발표 ${meta.earningsIn}거래일 전, 발표 뒤에 다시 봄` };
  const dil = meta.dilution ?? null; // edge-signals dilutionSignal() over 180 days, or null when not checked
  const recentOffer = dil?.offering ? dil.recent.find((d) => /^424B/i.test(d.form) && Date.parse(meta.asOf ?? d.date) - Date.parse(d.date) <= rules.offeringBlackoutDays * 864e5) : null;
  if (recentOffer) return { pass: `${recentOffer.date} 증자 공시(${recentOffer.form}), 매물 부담으로 제외` };
  if (Number.isFinite(x.sma200) && x.c < x.sma200 && x.sma50 < x.sma200) return { pass: '200일선 아래 하락 추세' };
  if (x.vol60 != null && x.vol60 > 1.2) return { pass: '변동성 과다' };
  if (x.atrPct < rules.minAtrPct) return { pass: `하루 변동폭 ${(x.atrPct * 100).toFixed(1)}%로 가격이 묶여 있음(인수합병 진행 등), 추세 매매 대상 아님` };
  if (x.rsi != null && x.rsi > 78) return { pass: `RSI ${x.rsi.toFixed(0)} 과열` };
  if (x.ext50 != null && x.ext50 > 0.25) return { pass: `50일선 대비 ${pctS(x.ext50, 0)} 과도한 이격` };

  let setup = null, trigger, stop, entryType, validDays, riskMult = 1;
  const nearHigh = x.c / x.hi52;
  if (up && x.c > x.hi20 && nearHigh >= 0.97 && x.relVol >= 1.4 && x.ret1 > 0) {
    setup = 'breakout'; entryType = 'market'; trigger = x.c; validDays = 1;
    stop = clamp(x.lo5 - 0.25 * x.atr, trigger - 2.5 * x.atr, trigger - 1.2 * x.atr);
  } else if (up && x.c >= x.hi20 * 0.94 && x.c <= x.hi20 && x.contraction < 0.8 && nearHigh >= 0.85) {
    setup = 'base'; entryType = 'buy-stop'; trigger = x.hi20 * 1.002; validDays = 10;
    stop = clamp(x.lo10 - 0.2 * x.atr, trigger - 2.5 * x.atr, trigger - 1.2 * x.atr);
  } else if (up && nearHigh >= 0.8 && x.rsi != null && x.rsi >= 36 && x.rsi <= 55 && (x.c < x.ema20 || Math.abs(x.c / x.sma50 - 1) < 0.025)) {
    setup = 'pullback'; entryType = 'buy-stop'; trigger = x.h * 1.001; validDays = 5;
    stop = clamp(x.lo5 - 0.3 * x.atr, trigger - 2.5 * x.atr, trigger - 1.2 * x.atr);
  } else if (Number.isFinite(x.sma200) && x.c > x.sma200 && x.rsi != null && x.rsi < 32 && x.ret5 < -0.08) {
    setup = 'reversal'; entryType = 'buy-stop'; trigger = x.h * 1.001; validDays = 3; riskMult = 0.5;
    stop = clamp(x.l - 0.5 * x.atr, trigger - 3 * x.atr, trigger - 1.5 * x.atr);
  }
  if (!setup) return { pass: '정해 둔 네 가지 자리(돌파·수축·눌림·과매도 반등) 중 어디에도 해당하지 않음' };
  stop = Math.min(stop, trigger * (1 - rules.minStopPct));
  const stopPct = 1 - stop / trigger;
  if (stopPct > rules.maxStopPct) return { pass: `손절폭 ${(stopPct * 100).toFixed(1)}% 과다` };

  const reasons = [], warnings = [];
  const rs = x.ret126 != null && meta.spyRet126 != null ? x.ret126 - meta.spyRet126 : null;
  // buy weakness only in leaders: a pullback or base in a stock lagging the market is not a setup
  if ((setup === 'pullback' || setup === 'base') && rs != null && rs < 0) return { pass: `${SETUP_LABEL[setup]}지만 6개월 수익률이 SPY보다 약함` };
  if (meta.earningsIn == null && meta.earningsChecked) reasons.push('30거래일 안에 실적 발표 없음');
  if (meta.earningsChecked === false) warnings.push('실적 발표일을 확인하지 못함');
  else if (meta.earningsIn != null && meta.earningsIn <= 20) warnings.push(`${meta.earningsIn}거래일 뒤 실적 발표, 그 전에 +1R 보호가 안 되면 정리`);
  let q = 0.35 * (meta.score ?? 60) + { breakout: 30, base: 26, pullback: 24, reversal: 14 }[setup];
  if (rs != null) { q += clamp(rs * 40, -10, 15); if (rs > 0.15) reasons.push(`6개월 수익률이 SPY보다 ${pctS(rs, 0)}p 강함`); else if (rs < 0) warnings.push(`6개월 수익률이 SPY보다 약함 (${pctS(rs, 0)}p)`); }
  if (up) { q += 8; reasons.push('50일선이 200일선 위 정배열'); }
  if (x.relVol > 1.5 && x.ret1 > 0) { q += 5; reasons.push(`상승일 거래량 평소의 ${x.relVol.toFixed(1)}배`); }
  if (x.relVol > 1.5 && x.ret1 < 0) { q -= 4; warnings.push(`하락일 거래량 평소의 ${x.relVol.toFixed(1)}배`); }
  if (x.rsi > 72) { q -= 8; warnings.push(`RSI ${x.rsi.toFixed(0)}로 단기 과열`); }
  if (x.ext50 > 0.15) { q -= 6; warnings.push(`50일선 위 ${pctS(x.ext50, 0)} 떠 있음`); }
  if (x.vol60 > 0.8) { q -= 5; warnings.push(`연 변동성 ${(x.vol60 * 100).toFixed(0)}%`); }
  if (setup === 'base' && x.contraction < 0.65) { q += 3; reasons.push(`최근 변동폭이 50일 평균의 ${(x.contraction * 100).toFixed(0)}%로 수축`); }
  if (dil) {
    const reg = dil.recent.filter((d) => /^(S-|F-)/i.test(d.form));
    if (dil.shelf || reg.some((d) => /^(S-1|F-1)/i.test(d.form))) { q -= 5; warnings.push(`증자 가능 서류 제출(${reg.map((d) => `${d.form} ${d.date}`).slice(0, 2).join(', ')})`); }
    else if (dil.likelyDebt) warnings.push('최근 424B 공시가 있으나 대형주라 채권 발행일 가능성이 큼');
    else if (!dil.count) reasons.push('최근 180일 증자 공시 없음');
  } else if (meta.dilutionChecked === false) warnings.push('증자 공시를 확인하지 못함');

  const trail = trailFor(x.atrPct), R = trigger - stop, target = trigger + rules.partialAtR * R;
  const lead = {
    breakout: `20일 고점 $${r2(x.hi20)}을 거래량 ${x.relVol.toFixed(1)}배로 넘었고 52주 고점의 ${(nearHigh * 100).toFixed(0)}% 자리입니다. 돌파 다음 날 시가에 삽니다(시가가 ${(rules.maxChase * 100).toFixed(0)}% 넘게 뛰면 추격하지 않음).`,
    base: `고점 $${r2(x.hi20)} 바로 아래에서 변동폭이 줄며 쉬고 있습니다. $${r2(trigger)}를 넘는 날 돌파 매수, ${validDays}거래일 안에 안 넘으면 주문을 거둡니다.`,
    pullback: `상승 추세 속에서 ${x.c < x.ema20 ? '20일 지수이평 아래로' : '50일선까지'} 눌렸고 RSI ${x.rsi.toFixed(0)}입니다. 오늘 고점 $${r2(trigger)}를 다시 넘어 반등이 확인되면 삽니다.`,
    reversal: `200일선 위 종목이 5일 ${pctS(x.ret5, 0)} 급락해 RSI ${x.rsi.toFixed(0)}입니다. 오늘 고점 $${r2(trigger)} 회복 때만 들어가고, 위험은 평소의 절반만 겁니다.`,
  }[setup];
  const thesis = `${lead} 손절은 $${r2(stop)}(${pctS(-stopPct)}), 1차 목표 $${r2(target)}(+${rules.partialAtR}R)에서 절반 익절 후 나머지는 ${trail.label} 종가 이탈 때 정리합니다.`;
  return { setup, label: SETUP_LABEL[setup], quality: Math.round(clamp(q, 0, 100)), reasons, warnings, thesis,
    plan: { entryType, trigger: r2(trigger), stop: r2(stop), target: r2(target), refClose: r2(x.c), validDays, riskMult, trailMa: trail.ma, trailLabel: trail.label, stopPct: r2(stopPct * 100) / 100 },
    snapshot: { close: r2(x.c), rsi: x.rsi != null ? Math.round(x.rsi) : null, atrPct: Math.round(x.atrPct * 1000) / 1000, relVol: Math.round(x.relVol * 10) / 10, ext50: x.ext50 != null ? Math.round(x.ext50 * 1000) / 1000 : null, rs126: rs != null ? Math.round(rs * 1000) / 1000 : null } };
}

/**
 * Choose the day's picks. candidates: [{ symbol, name, sector, mcap, score, source, bars, i }].
 * busy: symbols already held or with a working order. Returns { picks, passed }.
 */
export function pickForDay({ date, candidates, market, spyRet126, busy = new Set(), cooldown = new Map(), volumeReliable = false, earningsChecked = null }, rules = DESK_RULES) {
  const state = market ?? 'UNKNOWN', seen = new Set(), rows = [], passed = [];
  for (const c of candidates) {
    if (seen.has(c.symbol)) continue; seen.add(c.symbol);
    if (FUND_NAME.test(c.name ?? '') || ['SPY', 'QQQ', 'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'UPRO', 'SPXL', 'IWM'].includes(c.symbol)) { passed.push({ symbol: c.symbol, why: 'ETF·레버리지 상품 제외' }); continue; }
    if (busy.has(c.symbol)) { passed.push({ symbol: c.symbol, why: '이미 보유·주문 중' }); continue; }
    if (cooldown.has(c.symbol)) { passed.push({ symbol: c.symbol, why: `${cooldown.get(c.symbol)} 손절 뒤 ${rules.reentryCooldown}거래일 쉬는 중` }); continue; }
    const a = analyze(c.bars, c.i, { score: c.score, spyRet126, volumeReliable, earningsIn: c.earningsIn ?? null, earningsChecked, dilution: c.dilution ?? null, dilutionChecked: c.dilutionChecked ?? null, asOf: date }, rules);
    if (a.pass) { passed.push({ symbol: c.symbol, why: a.pass }); continue; }
    const bar = state === 'WAIT' ? rules.minQualityWait : rules.minQuality;
    if (a.quality < bar) { passed.push({ symbol: c.symbol, why: `${a.label} ${a.quality}점 (기준 ${bar}${state === 'WAIT' ? ', 진입 대기 시장' : ''})` }); continue; }
    rows.push({ c, a });
  }
  rows.sort((x, y) => y.a.quality - x.a.quality);
  const n = rules.picksPerDay[state] ?? 3, sectors = new Set(), picks = [];
  for (const { c, a } of rows) {
    if (picks.length >= n) { passed.push({ symbol: c.symbol, why: `${a.label} ${a.quality}점, 오늘 자리 부족` }); continue; }
    const sec = c.sector && c.sector !== 'Unknown' ? c.sector : null;
    if (sec && sectors.has(sec)) { passed.push({ symbol: c.symbol, why: `${sec} 이미 담음` }); continue; }
    if (sec) sectors.add(sec);
    picks.push({ symbol: c.symbol, name: c.name ?? c.symbol, sector: c.sector ?? null, cap: capBucket(c.mcap), mcap: c.mcap ?? null, source: c.source, listScore: c.score ?? null,
      setup: a.setup, label: a.label, quality: a.quality, reasons: a.reasons, warnings: a.warnings, thesis: a.thesis, plan: { ...a.plan, riskPct: (rules.riskPct[state] ?? 0.006) * a.plan.riskMult }, snapshot: a.snapshot, earningsIn: c.earningsIn ?? null, dilution: c.dilution ?? null });
  }
  return { date, market: state, picks, passed };
}

/**
 * Replay the paper account. ledgers: [{ date, live, market, picks }] sorted by date.
 * data: { cal: ['YYYY-MM-DD'], get(symbol) -> { s, bars } | null }.
 */
export function replayDesk(ledgers, data, rules = DESK_RULES, opts = {}) {
  const cal = data.cal, idxOf = (date) => { let lo = 0, hi = cal.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (cal[m] <= date) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
  const bar = (sym, d) => { const x = data.get(sym); if (!x || d < x.s || d - x.s >= x.bars.length) return null; const b = x.bars[d - x.s]; return b; };
  const lastClose = (sym, d) => { const x = data.get(sym); if (!x) return null; const k = Math.min(d - x.s, x.bars.length - 1); return k >= 0 ? x.bars[k].c : null; };
  const maAt = (sym, d, ma) => { const x = data.get(sym); if (!x || d < x.s) return NaN; return seriesFor(x.bars)[ma][d - x.s]; };
  const byDay = new Map(); for (const l of ledgers) { const d = idxOf(l.date); if (d >= 0) (byDay.get(d) ?? byDay.set(d, []).get(d)).push(l); }
  // opts.picker(d, { busy, cooldown }) -> { date, market, picks } lets a backtest choose picks session by session
  // from the account's own state, in one pass. opts.start / opts.end bound the sessions replayed.
  const first = opts.start ?? Math.min(...byDay.keys()), endIdx = opts.end ?? cal.length - 1;
  const generated = [];
  let cash = rules.startEquity, prevEquity = rules.startEquity;
  const open = [], pending = [], trades = [], equity = [], outcomes = new Map(), events = [];
  const spy = data.get('SPY'), spyStart = spy ? bar('SPY', first) : null;
  const key = (date, sym) => `${date}:${sym}`;
  const costRate = (p, px) => (p.cap === '소형주' || px < 10 ? rules.costSmallPerSide : rules.costPerSide);
  const nextReport = (sym, d) => { const list = data.earnings?.(sym); if (!list) return null; const today = cal[d]; return list.find((e) => e.date >= today) ?? null; };
  const spyOpenAt = (d) => bar('SPY', d)?.o ?? null, spyCloseAt = (d) => bar('SPY', d)?.c ?? null;
  let peak = rules.startEquity, haltSince = null, recovering = false, restartEq = null;

  const close = (pos, d, px, reason) => {
    const cost = (v) => v * pos.costRate;
    const proceeds = pos.shares * px; cash += proceeds - cost(proceeds);
    pos.realized += pos.shares * (px - pos.entry) - cost(proceeds); pos.exitValue += proceeds; pos.exitShares += pos.shares; pos.shares = 0;
    const exitPx = pos.exitValue / pos.exitShares, pnl = pos.realized - pos.entryCost;
    const t = { symbol: pos.symbol, name: pos.name, setup: pos.setup, label: pos.label, cap: pos.cap, sector: pos.sector, live: pos.live, pickDate: pos.pickDate,
      entryDate: cal[pos.entryIdx], exitDate: cal[d], days: d - pos.entryIdx, entry: r2(pos.entry), exit: r2(exitPx), shares: pos.initShares,
      pnl: r2(pnl), pnlPct: pnl / (pos.initShares * pos.entry), R: pnl / (pos.initShares * pos.R), reason, partial: pos.partial, market: pos.market ?? null };
    const so = spyOpenAt(pos.entryIdx), sc = spyCloseAt(d);
    t.spyPct = so && sc ? sc / so - 1 : null; t.alpha = t.spyPct != null ? t.pnlPct - t.spyPct : null;
    if (/^손절/.test(reason) || reason === '체결 당일 손절') stopped.set(pos.symbol, d);
    trades.push(t); outcomes.set(key(pos.pickDate, pos.symbol), { status: 'closed', ...t }); events.push({ date: cal[d], symbol: pos.symbol, kind: 'exit', text: `${reason} $${r2(px)} (${pctS(t.pnlPct)})` });
  };

  const stopped = new Map(); // symbol -> session of its last losing stop
  for (let d = first; d <= endIdx; d++) {
    // 1) manage open positions
    for (const pos of [...open]) {
      const b = bar(pos.symbol, d); if (!b || d <= pos.entryIdx) continue;
      const held = d - pos.entryIdx;
      if (b.o <= pos.stop) { close(pos, d, b.o, pos.stop >= pos.entry ? '본전 손절(갭)' : '손절(갭)'); }
      else if (b.l <= pos.stop) { close(pos, d, Math.min(b.o, pos.stop * (1 - rules.stopSlippage)), pos.stop >= pos.entry ? '본전 손절' : '손절'); }
      else {
        if (!pos.partial && b.h >= pos.target) {
          const px = Math.max(b.o, pos.target), half = Math.floor(pos.shares / 2);
          if (half > 0) { const v = half * px, c = v * pos.costRate; cash += v - c; pos.realized += half * (px - pos.entry) - c; pos.exitValue += v; pos.exitShares += half; pos.shares -= half; }
          pos.partial = true; pos.stop = Math.max(pos.stop, pos.entry);
          events.push({ date: cal[d], symbol: pos.symbol, kind: 'partial', text: `+${rules.partialAtR}R 절반 익절 $${r2(px)}` });
        }
        if (pos.stop < pos.entry && b.h >= pos.entry + rules.breakevenAtR * pos.R) { pos.stop = pos.entry; events.push({ date: cal[d], symbol: pos.symbol, kind: 'breakeven', text: `+1R 도달, 손절을 매수가 $${r2(pos.entry)}로` }); }
        const ma = maAt(pos.symbol, d, pos.trailMa);
        if (pos.partial && Number.isFinite(ma) && b.c < ma) close(pos, d, b.c, `${pos.trailLabel} 이탈`);
        else if (!pos.partial && held >= rules.timeStopSessions && b.c < pos.entry + rules.timeStopMinR * pos.R) close(pos, d, b.c, `${rules.timeStopSessions}거래일 진전 없음`);
        else if (held >= rules.maxSessions) close(pos, d, b.c, '최대 보유 기간');
        else if (pos.stop < pos.entry) {
          // an unprotected position does not sit through an earnings report: sell at the close before it
          const e = nextReport(pos.symbol, d), tomorrow = cal[d + 1] ?? nextWeekday(cal[d]);
          if (e && ((e.date === cal[d] && e.hour !== 'bmo') || (e.date > cal[d] && e.date < tomorrow) || (e.date === tomorrow && e.hour !== 'amc'))) close(pos, d, b.c, '실적 발표 전 정리');
        }
      }
      if (pos.shares === 0) open.splice(open.indexOf(pos), 1);
    }
    // 2) work pending orders (created on an earlier session)
    for (const o of [...pending]) {
      const drop = (status, why) => { pending.splice(pending.indexOf(o), 1); outcomes.set(key(o.pickDate, o.symbol), { status, why, date: cal[d] }); };
      if (d > o.expiry) { drop('expired', `${o.plan.validDays}거래일 안에 매수 가격에 닿지 않음`); continue; }
      const b = bar(o.symbol, d); if (!b) continue;
      if (b.o <= o.plan.stop) { drop('cancelled', '매수 전에 손절 가격 아래로 내려감'); continue; }
      let fill = null;
      if (o.plan.entryType === 'market') { if (b.o > o.plan.refClose * (1 + rules.maxChase)) { drop('cancelled', `시가가 ${pctS(b.o / o.plan.refClose - 1)} 갭 상승해 추격 안 함`); continue; } fill = b.o; }
      else if (b.h >= o.plan.trigger) { if (b.o > o.plan.trigger * (1 + rules.maxChase)) { drop('cancelled', '매수 가격 위로 크게 갭 상승해 추격 안 함'); continue; } fill = Math.max(b.o, o.plan.trigger); }
      if (fill == null) continue;
      if (open.length >= rules.maxOpen) { drop('cancelled', `보유 종목 ${rules.maxOpen}개 한도`); continue; }
      const dd = prevEquity / peak - 1;
      if (haltSince != null) { drop('cancelled', `계좌 낙폭 ${pctS(dd)}로 신규 매수 중단 중 (${cal[Math.min(haltSince + rules.ddHaltSessions, cal.length - 1)]}까지)`); continue; }
      const sec = o.sector && o.sector !== 'Unknown' ? o.sector : null;
      if (sec && open.filter((p) => p.sector === sec).length >= rules.maxSectorOpen) { drop('cancelled', `${sec} 이미 ${rules.maxSectorOpen}종목 보유`); continue; }
      const R = fill - o.plan.stop; if (!(R > 0)) { drop('cancelled', '체결가가 손절가 아래'); continue; }
      const riskPct = o.plan.riskPct * (dd <= -rules.ddHalfRisk || recovering ? 0.5 : 1);
      const heat = open.reduce((a, p) => a + p.shares * Math.max(0, (lastClose(p.symbol, d - 1) ?? p.entry) - p.stop), 0);
      const heatRoom = rules.maxHeatPct * prevEquity - heat;
      const rate = costRate(o, fill);
      let shares = Math.floor(prevEquity * riskPct / R), limit = '';
      const caps = [[Math.floor(prevEquity * rules.maxPositionPct / fill), '종목당 비중 한도'], [Math.floor(cash / (fill * (1 + rate))), '현금 부족'], [Math.floor(Math.max(0, heatRoom) / R), `전체 위험 ${(rules.maxHeatPct * 100).toFixed(0)}% 한도`]];
      if (data.volumeReliable) { const x = data.get(o.symbol); const i = d - 1 - x.s; if (i >= 20) caps.push([Math.floor(rules.maxAdvPct * indicatorsAt(x.bars, i).adv20 / fill), '거래대금 1% 한도']); }
      for (const [n, why] of caps) if (n < shares) { shares = n; limit = why; }
      if (shares < 1) { drop('cancelled', limit || '수량 0'); continue; }
      const v = shares * fill; cash -= v + v * rate;
      const pos = { ...o, shares, initShares: shares, entry: fill, entryIdx: d, R, stop: o.plan.stop, target: fill + rules.partialAtR * R, trailMa: o.plan.trailMa, trailLabel: o.plan.trailLabel,
        partial: false, realized: 0, entryCost: v * rate, costRate: rate, exitValue: 0, exitShares: 0, sizedBy: limit || null, riskUsed: riskPct };
      pos.realized = 0; open.push(pos); pending.splice(pending.indexOf(o), 1);
      outcomes.set(key(o.pickDate, o.symbol), { status: 'open', entryDate: cal[d], entry: r2(fill), shares });
      events.push({ date: cal[d], symbol: o.symbol, kind: 'buy', text: `${shares}주 $${r2(fill)} 매수 (위험 ${(riskPct * 100).toFixed(2)}%${limit ? `, ${limit}로 줄임` : ''})` });
      // same-session stop after the fill (conservative)
      if (b.l <= pos.stop) { close(pos, d, pos.stop * (1 - rules.stopSlippage), '체결 당일 손절'); open.splice(open.indexOf(pos), 1); }
    }
    // 3) tonight's picks become orders for the next session
    const todays = [...(byDay.get(d) ?? [])];
    if (opts.picker) {
      const busy = new Set([...open.map((p) => p.symbol), ...pending.map((p) => p.symbol)]);
      const cooldown = new Map([...stopped].filter(([, k]) => d - k < rules.reentryCooldown).map(([sym, k]) => [sym, cal[k].slice(5)]));
      const l = opts.picker(d, { busy, cooldown, equity: prevEquity });
      if (l) { todays.push(l); generated.push(l); }
    }
    for (const l of todays) for (const p of l.picks) {
      pending.push({ ...p, pickDate: l.date, live: !!l.live, market: l.market ?? null, expiry: d + p.plan.validDays });
      outcomes.set(key(l.date, p.symbol), { status: 'pending' });
    }
    // 4) mark to market
    let mv = 0; for (const pos of open) mv += pos.shares * (lastClose(pos.symbol, d) ?? pos.entry);
    const eq = cash + mv; prevEquity = eq; peak = Math.max(peak, eq);
    // drawdown breaker: stop at -ddHalt, rest ddHaltSessions, then restart from here at half risk
    if (haltSince == null && eq / peak - 1 <= -rules.ddHalt) { haltSince = d; events.push({ date: cal[d], symbol: '계좌', kind: 'halt', text: `고점 대비 ${pctS(eq / peak - 1)}, ${rules.ddHaltSessions}거래일 신규 매수 중단` }); }
    else if (haltSince != null && d - haltSince >= rules.ddHaltSessions) { haltSince = null; peak = eq; recovering = true; restartEq = eq; events.push({ date: cal[d], symbol: '계좌', kind: 'restart', text: '중단 기간 끝, 위험 절반으로 다시 시작' }); }
    if (recovering && eq >= restartEq * (1 + rules.recoverGain)) recovering = false;
    const sb = spy ? bar('SPY', d) : null;
    equity.push({ date: cal[d], equity: r2(eq), cash: r2(cash), spy: sb && spyStart ? r2(rules.startEquity * sb.c / spyStart.c) : null, open: open.length });
  }
  const last = endIdx;
  const openRows = open.map((p) => { const px = lastClose(p.symbol, last); return { symbol: p.symbol, name: p.name, setup: p.setup, label: p.label, cap: p.cap, live: p.live, pickDate: p.pickDate, entryDate: cal[p.entryIdx], entry: r2(p.entry), last: r2(px), shares: p.shares, stop: r2(p.stop), target: r2(p.target), partial: p.partial, trailLabel: p.trailLabel,
    unrealized: r2(p.shares * (px - p.entry) + p.realized), pnlPct: (p.shares * (px - p.entry) + p.realized) / (p.initShares * p.entry), R: (p.shares * (px - p.entry) + p.realized) / (p.initShares * p.R), weight: (p.shares * px) / equity.at(-1).equity, days: last - p.entryIdx }; });
  const pendingRows = pending.map((o) => ({ symbol: o.symbol, name: o.name, setup: o.setup, label: o.label, pickDate: o.pickDate, live: o.live, entryType: o.plan.entryType, trigger: o.plan.trigger, stop: o.plan.stop, expires: cal[Math.min(o.expiry, last)] ?? null, sessionsLeft: o.expiry - last }));
  const lastEq = equity.at(-1)?.equity ?? rules.startEquity;
  const heatNow = open.reduce((a, p) => a + p.shares * Math.max(0, (lastClose(p.symbol, last) ?? p.entry) - p.stop), 0);
  const ddNow = lastEq / peak - 1;
  const risk = { heatPct: heatNow / lastEq, heatLimit: rules.maxHeatPct, drawdown: ddNow, mode: haltSince != null ? 'halt' : ddNow <= -rules.ddHalfRisk || recovering ? 'half' : 'normal', haltUntil: haltSince != null ? cal[Math.min(haltSince + rules.ddHaltSessions, cal.length - 1)] : null,
    cooldown: [...stopped].filter(([, d]) => last - d < rules.reentryCooldown).map(([sym, d]) => { let u = cal[d + rules.reentryCooldown]; if (!u) { u = cal[last]; for (let k = last - d; k < rules.reentryCooldown; k++) u = nextWeekday(u); } return { symbol: sym, until: u }; }) };
  return { trades, open: openRows, pending: pendingRows, equity, events, outcomes: Object.fromEntries(outcomes), risk, stoppedAt: Object.fromEntries([...stopped].map(([k, d]) => [k, cal[d]])), generated };
}

/**
 * Market state from SPY alone, for history before the market-brief verdicts existed: below the 200-day average →
 * WAIT; below the 50-day → LIMIT; above a rising 200-day with the 50-day on top → SELECTIVE; otherwise LIMIT.
 */
export function regimeFromSpy(spyBars, i) {
  const s = seriesFor(spyBars), c = s.cl[i], m50 = s.sma50[i], m200 = s.sma200[i], m200prev = s.sma200[i - 20];
  if (!Number.isFinite(m200)) return 'UNKNOWN';
  if (c < m200) return 'WAIT';
  if (c < m50) return 'LIMIT'; // like the live verdict: an index below its 50-day average means fewer, smaller entries
  if (m50 > m200 && m200 > m200prev) return 'SELECTIVE';
  return 'LIMIT';
}

export function deskStats(trades, equity = []) {
  const n = trades.length, wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
  let pk = -Infinity, dd = 0; for (const e of equity) { pk = Math.max(pk, e.equity); dd = Math.min(dd, e.equity / pk - 1); }
  const first = equity[0], lastE = equity.at(-1);
  const group = (k) => { const g = {}; for (const t of trades) (g[t[k]] ??= []).push(t); return Object.fromEntries(Object.entries(g).map(([name, ts]) => [name, { n: ts.length, winRate: ts.filter((t) => t.pnl > 0).length / ts.length, avgPct: mean(ts.map((t) => t.pnlPct)), avgR: mean(ts.map((t) => t.R)), pnl: r2(ts.reduce((a, t) => a + t.pnl, 0)) }])); };
  return {
    closed: n, wins: wins.length, losses: losses.length, winRate: n ? wins.length / n : null,
    avgWinPct: mean(wins.map((t) => t.pnlPct)), avgLossPct: mean(losses.map((t) => t.pnlPct)), avgPct: mean(trades.map((t) => t.pnlPct)),
    payoff: wins.length && losses.length ? mean(wins.map((t) => t.pnlPct)) / -mean(losses.map((t) => t.pnlPct)) : null,
    profitFactor: gl > 0 ? gw / gl : null, expectancyR: mean(trades.map((t) => t.R)), avgDays: mean(trades.map((t) => t.days)), realized: r2(gw - gl),
    totalReturn: first && lastE ? lastE.equity / DESK_RULES.startEquity - 1 : 0, spyReturn: lastE?.spy ? lastE.spy / DESK_RULES.startEquity - 1 : null, maxDrawdown: dd,
    bySetup: group('setup'), byCap: group('cap'), byMarket: group('market'), enough: n >= 30,
    winRateCI: wilson(wins.length, n),
    // the win rate that breaks even at the observed payoff: below it the system loses money
    breakevenWinRate: wins.length && losses.length ? 1 / (1 + mean(wins.map((t) => t.pnlPct)) / -mean(losses.map((t) => t.pnlPct))) : null,
    avgAlpha: mean(trades.filter((t) => t.alpha != null).map((t) => t.alpha)), beatSpy: n ? trades.filter((t) => t.alpha > 0).length / n : null,
  };
}

/**
 * Did the analyst's choices beat simply buying every candidate on the same day? For each pick day, the picks'
 * and all candidates' returns from the next open to the close `h` sessions later. Uses only days with h
 * sessions of future data.
 */
export function selectionEdge(days, data, h = 10) {
  const fwd = (sym, d) => { const x = data.get(sym); if (!x) return null; const i0 = d + 1 - x.s, i1 = d + h - x.s; if (i0 < 0 || i1 >= x.bars.length) return null; return x.bars[i1].c / x.bars[i0].o - 1; };
  const idx = (date) => data.cal.indexOf(date), rows = [];
  for (const day of days) {
    const d = idx(day.date); if (d < 0 || !day.picks.length) continue;
    const p = day.picks.map((s) => fwd(s, d)).filter((v) => v != null), c = day.candidates.map((s) => fwd(s, d)).filter((v) => v != null);
    if (!p.length || c.length < 5) continue;
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    rows.push({ date: day.date, picks: avg(p), all: avg(c), edge: avg(p) - avg(c), n: c.length });
  }
  const m = (k) => (rows.length ? rows.reduce((a, r) => a + r[k], 0) / rows.length : null);
  return { horizon: h, days: rows.length, picks: m('picks'), all: m('all'), edge: m('edge'), beatDays: rows.length ? rows.filter((r) => r.edge > 0).length / rows.length : null, rows };
}

/**
 * Plain verdict on whether the record is good enough to act on. Thresholds are set before seeing results:
 * at least 30 closed trades, positive expectancy, profit factor above 1.3 and picks beating the candidate list.
 */
export function deskVerdict(stats, sel) {
  const n = stats.closed;
  if (n < 30) return { stage: 'collect', label: '표본 모으는 중', text: `청산 ${n}건. 30건이 넘기 전에는 승률·손익 모두 운일 수 있어 판단하지 않습니다.`, progress: n / 30 };
  const ok = stats.expectancyR > 0.1 && (stats.profitFactor ?? 0) > 1.3 && (sel?.edge ?? 0) > 0;
  if (ok && n >= 60) return { stage: 'live-small', label: '소액 실전 검토 가능', text: '60건 넘게 기대값·이익 계수·선택 효과가 모두 기준을 넘었습니다. 계좌의 일부, 거래당 위험 0.5% 이하로 실전을 시작해 같은 기록과 비교하세요.', progress: 1 };
  if (ok) return { stage: 'promising', label: '유망, 계속 검증', text: '기준은 넘었지만 60건 전까지는 모의로 계속 확인합니다.', progress: n / 60 };
  if (stats.expectancyR < 0) return { stage: 'review', label: '규칙 재검토', text: '30건 넘게 거래당 기대값이 음수입니다. 실전에 쓰지 말고, 어느 패턴·시장에서 잃는지 표를 보고 규칙을 고칩니다. 고친 규칙은 새 버전으로 처음부터 다시 기록합니다.', progress: 1 };
  return { stage: 'neutral', label: '아직 우위 불분명', text: '손실은 아니지만 기준(기대값 +0.1R, 이익 계수 1.3, 후보 대비 우위)에 못 미칩니다. 모의로 계속 기록합니다.', progress: n / 60 };
}
