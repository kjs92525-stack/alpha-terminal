// SEC data refresh for the nightly pipeline.
// Strategy: re-fetch a company's submissions only when it appears in the EDGAR daily
// form index since the last run (or its cache is missing/stale). Re-fetch XBRL company
// facts only when a new 10-K/10-Q/20-F/40-F is seen. Keeps nightly traffic small and
// within SEC fair-access limits (<= 10 req/s with a descriptive User-Agent).

import { parseFilings, summarizeFacts, padCik } from '../analysis/sec.mjs';
import { fetchRetry, throttle } from './http.mjs';

const PERIODIC = /^(10-K|10-Q|20-F|40-F)(\/A)?$/;

export function dailyIndexUrl(isoDate) {
  const [y, m, d] = isoDate.split('-');
  const q = Math.floor((Number(m) - 1) / 3) + 1;
  return `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${y}${m}${d}.idx`;
}

/** Parse an EDGAR daily form index (fixed-width text). */
export function parseDailyIndex(text) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^-{20,}/.test(l.trim()));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^(.+?)\s{2,}(.+?)\s{2,}(\d{1,10})\s{2,}(\d{8}|\d{4}-\d{2}-\d{2})\s{2,}(edgar\/\S+)\s*$/);
    if (!m) continue;
    const date = m[4].includes('-') ? m[4] : `${m[4].slice(0, 4)}-${m[4].slice(4, 6)}-${m[4].slice(6, 8)}`;
    out.push({ form: m[1].trim(), name: m[2].trim(), cik: padCik(m[3]), date, file: m[5] });
  }
  return out;
}

/** Business days (Mon–Fri) strictly after `fromIso` up to and including `toIso`. */
export function businessDaysBetween(fromIso, toIso, max = 10) {
  const out = [];
  let t = Date.parse(`${fromIso}T00:00:00Z`) + 86400000;
  const end = Date.parse(`${toIso}T00:00:00Z`);
  while (t <= end && out.length < max) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

export function makeSecClient({ userAgent, fetchImpl = fetch, minIntervalMs = 125, wait } = {}) {
  if (!userAgent) throw new Error('SEC_USER_AGENT missing');
  const gate = throttle(minIntervalMs);
  const headers = { 'User-Agent': userAgent, Accept: 'application/json, text/plain, */*' };
  const get = async (url) => {
    await gate();
    return fetchRetry(url, { headers }, { fetchImpl, wait });
  };
  return {
    requests: 0,
    async json(url) {
      this.requests++;
      const res = await get(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`SEC HTTP ${res.status} ${url}`);
      return res.json();
    },
    async text(url) {
      this.requests++;
      const res = await get(url);
      if (res.status === 404 || res.status === 403) return null; // holidays / not yet published
      if (!res.ok) throw new Error(`SEC HTTP ${res.status} ${url}`);
      return res.text();
    },
  };
}

const compactFiling = (f) => ({ accession: f.accession, form: f.form, filingDate: f.filingDate, acceptedAt: f.acceptedAt, items: f.items, url: f.url, label: f.label, category: f.category, importance: f.importance });

/**
 * Decide which CIKs to refresh and refresh them.
 * cache: { get(cik) -> record|null, set(cik, record) }
 */
export async function refreshCompanies({ ciks, cache, client, changed = new Set(), now = Date.now(), staleDays = 30, maxRefresh = 2500, onProgress }) {
  const todo = [];
  for (const cik of ciks) {
    const rec = cache.get(cik);
    const stale = !rec || now - Date.parse(rec.fetchedAt) > staleDays * 86400000;
    if (stale || changed.has(cik)) todo.push(cik);
  }
  // changed filers first, then missing, then oldest
  todo.sort((a, b) => Number(changed.has(b)) - Number(changed.has(a)) || String(cache.get(a)?.fetchedAt ?? '').localeCompare(String(cache.get(b)?.fetchedAt ?? '')));
  const selected = todo.slice(0, maxRefresh);
  let factsFetched = 0;
  const errors = [];
  for (let i = 0; i < selected.length; i++) {
    const cik = selected[i];
    try {
      const subs = await client.json(`https://data.sec.gov/submissions/CIK${cik}.json`);
      if (!subs) continue;
      const filings = parseFilings(subs, { limit: 80 });
      const lastPeriodic = filings.find((f) => PERIODIC.test(f.form))?.filingDate ?? null;
      const prev = cache.get(cik);
      let facts = prev?.facts ?? null;
      let factsPeriodic = prev?.factsPeriodic ?? null;
      if (!facts || (lastPeriodic && lastPeriodic !== factsPeriodic)) {
        const raw = await client.json(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
        facts = raw ? summarizeFacts(raw) : null;
        factsPeriodic = lastPeriodic;
        factsFetched++;
      }
      cache.set(cik, {
        cik, fetchedAt: new Date(now).toISOString(), name: subs.name ?? null, sic: subs.sic ?? null, sicDescription: subs.sicDescription ?? null,
        filings: filings.map(compactFiling), facts, factsPeriodic,
      });
    } catch (e) {
      errors.push(`${cik}: ${e.message}`);
    }
    onProgress?.(i + 1, selected.length);
  }
  return { refreshed: selected.length, pending: todo.length - selected.length, factsFetched, errors };
}
