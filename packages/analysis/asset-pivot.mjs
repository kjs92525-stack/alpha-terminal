// "Asset pivot" signals: a loss-making company whose existing assets (power, sites, plants,
// licences) find a new, higher-value use, shown by large contracts and a capex build-out rather
// than by this quarter's profit (IREN-type). Headline evidence is only a lead for the filing text;
// financing headlines are kept apart because a raise is not demand.
const DAY = 86400000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const DEMAND = /\b(agreements?|contracts?|deals?|leases?|award(?:ed|s)?|orders?|offtake|colocation|hosting|cloud services?|capacity|purchase orders?|partnership)\b/i;
const FINANCING = /\b(offering|notes|convertible|loan|credit facility|financing|private placement|at-the-market|ATM program|debt|raises?|priced)\b/i;
const ACQUISITION = /\b(to acquire|acquired by|acquisition of|merger|to be acquired|take[- ]private|buyout|go(?:es|ing)? private)\b|\btake\b.{0,40}\bprivate\b/i;
const AMOUNT = /\$\s?(\d+(?:\.\d+)?)\s?(billion|bn|b|million|mn|m)\b/i;

export function headlineAmount(headline) {
  const m = String(headline ?? '').match(AMOUNT);
  if (!m) return null;
  const v = Number(m[1]) * (/^b/i.test(m[2]) ? 1e9 : 1e6);
  return finite(v) && v > 0 ? v : null;
}

/** Classify one headline: 'acquisition' | 'financing' | 'demand' | null. */
export function classifyPivotHeadline(headline) {
  const h = String(headline ?? '');
  if (ACQUISITION.test(h)) return 'acquisition';
  if (FINANCING.test(h)) return 'financing';
  if (DEMAND.test(h)) return 'demand';
  return null;
}

/**
 * news: [{time, headline, url}] (null = not collected); facts: fundamentals incl. capexTtm,
 * capexTtmPrior, revenue, operatingCashFlow, cash; mcap in dollars.
 */
export function assetPivotSignals({ news = null, facts = null, mcap = null, asOf, windowDays = 90 }) {
  const end = Date.parse(asOf) + DAY;
  const recent = (news ?? []).filter((n) => Number.isFinite(Date.parse(n?.time)) && Date.parse(n.time) <= end && end - Date.parse(n.time) <= windowDays * DAY);
  const contracts = [], financing = [];
  let acquisition = null;
  for (const n of recent) {
    const kind = classifyPivotHeadline(n.headline);
    const amount = headlineAmount(n.headline);
    const row = { date: String(n.time).slice(0, 10), headline: n.headline, url: n.url ?? null, amount, ratio: amount && finite(mcap) && mcap > 0 ? amount / mcap : null };
    if (kind === 'acquisition') acquisition ??= row;
    else if (kind === 'financing') financing.push(row);
    else if (kind === 'demand' && amount) contracts.push(row);
  }
  contracts.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  const material = contracts.filter((c) => (c.ratio ?? 0) >= 0.1);

  const ttm = facts?.capexTtm?.value, prior = facts?.capexTtmPrior?.value, revenue = facts?.revenue?.value;
  const capex = finite(ttm) ? { ttm, prior: finite(prior) ? prior : null, growth: finite(prior) && prior > 0 ? ttm / prior : null, toRevenue: finite(revenue) && revenue > 0 ? ttm / revenue : null, end: facts.capexTtm.end ?? null } : null;
  // build-out: capex at least doubled and large relative to sales (or to a tiny sales base)
  const investmentPhase = Boolean(capex && capex.ttm >= 20e6 && (capex.growth ?? 0) >= 2 && (capex.toRevenue === null || capex.toRevenue >= 0.25));

  // months of cash after operations AND capex (stricter than an operating-only runway)
  const ocf = facts?.operatingCashFlow?.value, cash = facts?.cash?.value;
  const burn = finite(ocf) && capex ? -(ocf - capex.ttm) : null;
  const fundedMonths = finite(cash) && finite(burn) ? (burn > 0 ? (cash / burn) * 12 : null) : null;
  const selfFunded = finite(burn) ? burn <= 0 : null;

  return {
    pivot: !acquisition && (material.length > 0 || investmentPhase),
    newsChecked: news !== null,
    contracts: contracts.slice(0, 3), material: material.length, financing: financing.slice(0, 3), acquisition,
    capex, investmentPhase, fundedMonths: finite(fundedMonths) ? Math.round(fundedMonths) : null, selfFunded,
  };
}
