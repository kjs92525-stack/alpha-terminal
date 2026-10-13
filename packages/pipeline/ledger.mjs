// Recommendation ledger + outcome evaluation.
//
// A ledger entry is written once per trading day and never modified. Performance is
// measured as if entering at the NEXT session's open after the signal close (the signal
// is only known after the close) and exiting at the close `h` sessions later, versus SPY
// over the identical window. Pending entries (not enough bars yet) are reported as such.

export const HORIZONS = { mid: [20, 60], short: [1, 5] };

export function makeLedger(asOf, model, recs) {
  const entry = (r) => ({
    rank: r.rank, symbol: r.symbol, name: r.name ?? null, sector: r.sector ?? null, score: r.score,
    factors: r.factors, signalClose: r.features.price,
  });
  return {
    asOf, model, createdAt: new Date().toISOString(),
    rule: '신호일 종가 후 생성 → 다음 거래일 시가 진입 가정, h거래일 후 종가 청산, 같은 기간 SPY와 비교. 수수료·슬리피지 미반영.',
    mid: (recs.mid ?? []).map(entry),
    short: (recs.short ?? []).map(entry),
  };
}

function entryIndex(bars, asOfIso) {
  const t = Date.parse(`${asOfIso}T00:00:00Z`) / 1000;
  return bars.findIndex((b) => b.time > t);
}

/** Return of buying next open after asOf and selling at close h sessions later; null if pending. */
export function forwardReturn(bars, asOfIso, h) {
  if (!bars?.length) return null;
  const i = entryIndex(bars, asOfIso);
  if (i < 0) return null;
  const j = i + h - 1;
  if (j >= bars.length) return null;
  const entry = bars[i].open;
  if (!(entry > 0)) return null;
  return { ret: bars[j].close / entry - 1, entryDate: new Date(bars[i].time * 1000).toISOString().slice(0, 10), exitDate: new Date(bars[j].time * 1000).toISOString().slice(0, 10) };
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Evaluate ledgers. getBars(symbol) -> Bar[] (adjusted), spyBars -> Bar[].
 * Returns per horizon-bucket statistics plus per-ledger detail.
 */
export function evaluateLedgers(ledgers, getBars, spyBars) {
  const detail = [];
  const pools = {};
  for (const L of ledgers) {
    for (const book of ['mid', 'short']) {
      for (const h of HORIZONS[book]) {
        const key = `${book}_${h}d`;
        const spy = forwardReturn(spyBars, L.asOf, h);
        const rows = [];
        let pending = 0;
        for (const e of L[book] ?? []) {
          const fr = spy ? forwardReturn(getBars(e.symbol), L.asOf, h) : null;
          if (!fr) { pending++; continue; }
          rows.push({ symbol: e.symbol, ret: fr.ret, excess: fr.ret - spy.ret });
        }
        if (!rows.length) { detail.push({ asOf: L.asOf, key, status: 'pending', pending }); continue; }
        const avgRet = rows.reduce((s, r) => s + r.ret, 0) / rows.length;
        const avgEx = rows.reduce((s, r) => s + r.excess, 0) / rows.length;
        const d = { asOf: L.asOf, key, status: pending ? 'partial' : 'complete', n: rows.length, pending, portfolioReturn: avgRet, spyReturn: spy.ret, excess: avgEx, hitRate: rows.filter((r) => r.excess > 0).length / rows.length, model: L.model };
        detail.push(d);
        (pools[key] ??= []).push(d);
      }
    }
  }
  const summary = {};
  for (const [key, ds] of Object.entries(pools)) {
    const done = ds.filter((d) => d.status === 'complete');
    const ex = done.map((d) => d.excess);
    summary[key] = {
      cohorts: done.length,
      meanExcess: ex.length ? ex.reduce((s, v) => s + v, 0) / ex.length : null,
      medianExcess: median(ex),
      cohortsBeatingSpy: done.filter((d) => d.excess > 0).length,
      meanHitRate: done.length ? done.reduce((s, d) => s + d.hitRate, 0) / done.length : null,
      note: done.length < 30 ? '표본 30개 미만 — 통계적으로 의미 있는 결론 불가' : null,
    };
  }
  return { summary, detail, evaluatedAt: new Date().toISOString() };
}
