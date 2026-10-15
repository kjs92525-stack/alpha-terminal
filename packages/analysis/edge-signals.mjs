// Information-edge signals from free Finnhub endpoints, each kept as evidence (not a score):
//  - insider buying clusters: open-market purchases (Form 4 code P) by several insiders;
//  - dilution overhang: shelf registrations / offering prospectuses (S-3, S-1, 424B*);
//  - analyst trend: change in the share of buy ratings over ~3 months (opinion, not information).
const DAY = 86400000;
const ENTITY = /\b(inc|corp|corporation|co|company|llc|l\.?p|lp|ltd|plc|ag|sa|nv|fund|funds|capital|partners|holdings|insurance|trust|bank|group|management|advisors|investments?|ventures)\b\.?$|\b(insurance|capital|partners|holdings|fund|llc)\b/i;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** rows: Finnhub /stock/insider-transactions data[]. Purchases only (code P), last `days`. */
export function insiderSignal(rows, asOf, days = 90) {
  if (!Array.isArray(rows)) return null;
  const end = Date.parse(asOf) + DAY, from = end - days * DAY;
  const seen = new Set();
  const all = rows.filter((r) => r?.transactionCode === 'P' && finite(r.change) && r.change > 0 && finite(r.transactionPrice) && r.transactionPrice > 0)
    .filter((r) => { const t = Date.parse(r.transactionDate ?? r.filingDate); return Number.isFinite(t) && t <= end && t >= from; })
    .map((r) => ({ name: String(r.name ?? '').trim() || '이름 미상', date: String(r.transactionDate ?? r.filingDate).slice(0, 10), shares: r.change, value: r.change * r.transactionPrice }))
    // amended Form 4s repeat the same trade
    .filter((b) => { const k = `${b.name}|${b.date}|${b.shares}|${b.value}`; if (seen.has(k)) return false; seen.add(k); return true; });
  // companies / funds buying (10% holders, strategic stakes) are not managers betting their own money
  const buys = all.filter((b) => !ENTITY.test(b.name)), holders = all.filter((b) => ENTITY.test(b.name));
  const sells = rows.filter((r) => r?.transactionCode === 'S' && finite(r.change) && finite(r.transactionPrice))
    .filter((r) => { const t = Date.parse(r.transactionDate ?? r.filingDate); return Number.isFinite(t) && t <= end && t >= from; });
  const buyers = new Set(buys.map((b) => b.name.toLowerCase()));
  const buyValue = buys.reduce((s, b) => s + b.value, 0);
  const sellValue = sells.reduce((s, r) => s + Math.abs(r.change) * r.transactionPrice, 0);
  // several insiders buying with their own money, or one sizeable purchase
  const cluster = (buyers.size >= 2 && buyValue >= 100e3) || buyValue >= 250e3;
  const holderValue = holders.reduce((s, b) => s + b.value, 0);
  return { days, buyers: buyers.size, buyValue: Math.round(buyValue), sellValue: Math.round(sellValue), cluster, recent: buys.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5), holderBuys: holders.length ? { names: [...new Set(holders.map((h) => h.name))].slice(0, 3), value: Math.round(holderValue) } : null };
}

// 424B2 is the debt / structured-note prospectus form; large companies' 424B5s are mostly notes too
const DILUTIVE = /^(S-3|S-3ASR|S-1|F-3|F-1|424B[1345])(\/A)?$/i;
/** filings: [{form, filingDate}] (Finnhub /stock/filings). Shelf / offering documents in `days`. */
export function dilutionSignal(filings, asOf, days = 180, mcap = null) {
  if (!Array.isArray(filings)) return null;
  const end = Date.parse(asOf) + DAY, from = end - days * DAY;
  const docs = filings.filter((f) => DILUTIVE.test(String(f?.form ?? '').trim()) && Number.isFinite(Date.parse(f.filingDate)) && Date.parse(f.filingDate) <= end && Date.parse(f.filingDate) >= from)
    .map((f) => ({ form: f.form, date: String(f.filingDate).slice(0, 10), url: f.url ?? null })).sort((a, b) => b.date.localeCompare(a.date));
  const large = finite(mcap) && mcap > 10e9;
  return { days, count: docs.length, shelf: docs.some((d) => /^(S-3|F-3)/i.test(d.form)), offering: !large && docs.some((d) => /^424B/i.test(d.form)), likelyDebt: large && docs.some((d) => /^424B/i.test(d.form)), recent: docs.slice(0, 4) };
}

/** rows: Finnhub /stock/recommendation (monthly, newest first). */
export function analystTrend(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const sorted = [...rows].filter((r) => r?.period).sort((a, b) => String(b.period).localeCompare(String(a.period)));
  const share = (r) => { const bull = (r.strongBuy ?? 0) + (r.buy ?? 0), all = bull + (r.hold ?? 0) + (r.sell ?? 0) + (r.strongSell ?? 0); return all > 0 ? { bull: bull / all, all } : null; };
  const now = sorted[0] ? share(sorted[0]) : null, then = sorted[3] ? share(sorted[3]) : null;
  if (!now) return null;
  const change = then ? now.bull - then.bull : null;
  return { period: sorted[0].period, analysts: now.all, bullShare: now.bull, change3m: change, direction: change == null ? 'unknown' : change >= 0.1 ? 'up' : change <= -0.1 ? 'down' : 'flat' };
}
