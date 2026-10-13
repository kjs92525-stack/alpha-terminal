// Ticker -> SEC CIK without www.sec.gov (which refuses some cloud runners).
// data.sec.gov XBRL "frames" list every filer's CIK and entity name for one concept/period;
// we match those names to the broker's company names, then the caller confirms each match
// against the `tickers` field of the company's submissions file before trusting it.

const SUFFIX = new Set(['inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc', 'llc', 'lp', 'sa', 'nv', 'ag', 'se', 'the', 'de', 'common', 'stock', 'shares', 'ordinary', 'class', 'a', 'b', 'c', 'new', 'adr', 'ads', 'american', 'depositary', 'each', 'representing', 'share', 'par', 'value', 'usd', 'com']);

export function normalizeCompanyName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\/[a-z]{2}\/?/g, ' ') // SEC state tags like /DE/
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SUFFIX.has(w) && !/^\d+(\.\d+)?$/.test(w))
    .join(' ');
}

/** frames: array of frame JSONs ({ data: [{ cik, entityName }] }). Ambiguous names are dropped. */
export function buildNameIndex(frames) {
  const idx = new Map();
  const dup = new Set();
  for (const fr of frames) {
    for (const r of fr?.data ?? []) {
      const key = normalizeCompanyName(r.entityName);
      if (!key) continue;
      const cik = String(r.cik).padStart(10, '0');
      if (idx.has(key) && idx.get(key) !== cik) dup.add(key);
      else idx.set(key, cik);
    }
  }
  for (const k of dup) idx.delete(k);
  return idx;
}

/** Recent completed quarter-end instants (two quarters back and three back) for frames requests. */
export function framePeriods(asOfIso) {
  const d = new Date(`${asOfIso}T00:00:00Z`);
  let y = d.getUTCFullYear();
  let q = Math.floor(d.getUTCMonth() / 3) + 1;
  const out = [];
  for (let k = 0; k < 3; k++) {
    q -= 1;
    if (q === 0) { q = 4; y -= 1; }
    if (k >= 1) out.push(`CY${y}Q${q}I`);
  }
  return out;
}

export const frameUrl = (period, concept = 'Assets') => `https://data.sec.gov/api/xbrl/frames/us-gaap/${concept}/USD/${period}.json`;
