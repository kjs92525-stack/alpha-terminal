// Nightly analyst desk. Reads the day's recommendation lists and real bars, writes tonight's picks once
// (desk/ledger/YYYY-MM-DD.json, never modified afterwards) and replays the paper account from every stored
// pick (desk/account.json). Dates before the first stored pick are filled in as a clearly flagged backfill.
// Usage: node scripts/analyst-desk.mjs --data data-branch --bars data-branch/sim/bars.json [--out data-branch]
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pickForDay, replayDesk, deskStats, deskVerdict, selectionEdge, DESK_RULES, ICT_RULES } from '../packages/analysis/analyst-desk.mjs';
import { dilutionSignal } from '../packages/analysis/edge-signals.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const dated = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : []);

/** sim/bars.json → { cal, get(sym) } with bar objects */
export function barsAccess(payload) {
  const cache = new Map();
  const earnings = payload.earnings ?? null;
  return { cal: payload.cal, gates: payload.gates ?? {}, symbols: Object.keys(payload.bars ?? {}),
    volumeReliable: payload.volumeReliable ?? /feed=sip/.test(payload.source ?? ''),
    earningsChecked: payload.earningsChecked ?? (earnings ? true : null),
    earnings: earnings ? (sym) => earnings[sym] : null, // undefined: this symbol is not in the calendar
    get(sym) {
    if (cache.has(sym)) return cache.get(sym);
    const x = payload.bars[sym]; const v = x ? { s: x.s, bars: x.d.map(([o, h, l, c, v2]) => ({ o, h, l, c, v: v2 })) } : null;
    cache.set(sym, v); return v;
  } };
}
const calIdx = (cal, date) => { let lo = 0, hi = cal.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (cal[m] <= date) { a = m; lo = m + 1; } else hi = m - 1; } return a; };

/** trading sessions from session d to the next earnings date (null: none within the data, undefined: unknown) */
function earningsIn(data, sym, d) {
  if (!data.earnings) return undefined;
  const list = data.earnings(sym); if (!list) return undefined; // unknown, not "no report"
  const e = list.find((x) => x.date > data.cal[d]); if (!e) return null;
  let n = 0; for (let t = Date.parse(data.cal[d]) + 864e5; t <= Date.parse(e.date); t += 864e5) { const w = new Date(t).getUTCDay(); if (w && w < 6) n++; }
  return n <= 30 ? n : null;
}

export function candidatesFor(doc, data, d, mcap) {
  const out = [];
  for (const [list, source] of [['mid', '중장기 랭킹'], ['short', '단기 랭킹'], ['setups', '돌파 셋업'], ['pullback', '눌림목 셋업']]) {
    for (const r of doc[list] ?? []) {
      const x = data.get(r.symbol); if (!x || d < x.s) continue;
      const i = d - x.s; if (i >= x.bars.length) continue;
      const filings = data.filings ? data.filings(r.symbol) : undefined;
      out.push({ symbol: r.symbol, name: r.name, sector: r.sector, score: r.score, mcap: mcap.get(r.symbol) ?? null, source, bars: x.bars, i, earningsIn: earningsIn(data, r.symbol, d),
        dilution: filings ? dilutionSignal(filings, doc.asOf, 180, mcap.get(r.symbol) ?? null) : null, dilutionChecked: filings ? true : data.filings ? false : null });
    }
  }
  return out;
}
function spyRet126(data, d) { const x = data.get('SPY'); const i = d - (x?.s ?? 0); return x && i >= 126 ? x.bars[i].c / x.bars[i - 126].c - 1 : null; }
/** state of the account as of session d: symbols held or with a working order, and names cooling off after a stop */
function stateAt(ledgers, data, d, rules = DESK_RULES) {
  if (!ledgers.length) return { busy: new Set(), cooldown: new Map() };
  const r = replayDesk(ledgers, { ...data, cal: data.cal.slice(0, d + 1), get: data.get.bind(data) }, rules);
  const cooldown = new Map();
  for (const [sym, date] of Object.entries(r.stoppedAt)) { const k = data.cal.indexOf(date); if (k >= 0 && d - k < rules.reentryCooldown) cooldown.set(sym, date.slice(5)); }
  return { busy: new Set([...r.open.map((p) => p.symbol), ...r.pending.map((p) => p.symbol)]), cooldown };
}

/** One book of daily picks: stored days are kept as they are, missing days are picked with that day's data only. */
function runBook({ docs, latest, data, stored, today, mcap, rules, universe, candidatesOf = (doc, d) => candidatesFor(doc, data, d, mcap) }) {
  const liveStart = stored.length ? stored[0].date : null;
  const ledgers = [], created = [];
  for (const doc of docs) {
    const d = calIdx(data.cal, doc.asOf); if (d < 0 || data.cal[d] !== doc.asOf) continue; // need that day's close
    const cands = candidatesOf(doc, d);
    universe?.set(doc.asOf, [...new Set(cands.map((c) => c.symbol))]);
    const have = stored.find((s) => s.date === doc.asOf);
    if (have) { ledgers.push(have); continue; }
    const market = data.gates[doc.asOf] ?? (doc.asOf === latest?.asOf ? latest?.marketState : null) ?? 'UNKNOWN';
    const { busy, cooldown } = stateAt(ledgers, data, d, rules);
    const res = pickForDay({ date: doc.asOf, candidates: cands, market, spyRet126: spyRet126(data, d), busy, cooldown, volumeReliable: data.volumeReliable, earningsChecked: data.earningsChecked }, rules);
    const live = doc.asOf === today;
    const entry = { date: doc.asOf, rulesVersion: rules.version, live, backfill: !live, late: !live && liveStart != null && doc.asOf > liveStart, createdAt: new Date().toISOString(), market: res.market, picks: res.picks, passed: res.passed.slice(0, 40) };
    ledgers.push(entry); if (live) created.push(entry);
  }
  ledgers.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { ledgers, created };
}

/** The ICT book's own paper account (see ICT_RULES): same candidates, structure shifts only. */
function ictBook({ docs, latest, data, stored, today, mcap }) {
  // every stock with bars, not only that day's ranking lists: structure shifts are rare (about one a week)
  const names = new Map(); for (const k of ['mid', 'short']) for (const r of latest?.[k] ?? []) if (!names.has(r.symbol)) names.set(r.symbol, r);
  const symbols = (data.symbols ?? []).filter((s) => s !== 'SPY' && s !== 'QQQ');
  const candidatesOf = (doc, d) => {
    const listed = new Map(candidatesFor(doc, data, d, mcap).map((c) => [c.symbol, c]));
    const out = [...listed.values()];
    for (const sym of symbols) {
      if (listed.has(sym)) continue;
      const x = data.get(sym); if (!x || d < x.s || d - x.s >= x.bars.length) continue;
      const n = names.get(sym), filings = data.filings ? data.filings(sym) : undefined;
      out.push({ symbol: sym, name: n?.name ?? sym, sector: n?.sector ?? null, score: 60, mcap: mcap.get(sym) ?? null, source: '시세 보유 전 종목', bars: x.bars, i: d - x.s, earningsIn: earningsIn(data, sym, d),
        dilution: filings ? dilutionSignal(filings, doc.asOf, 180, mcap.get(sym) ?? null) : null, dilutionChecked: filings ? true : data.filings ? false : null });
    }
    return out;
  };
  const { ledgers, created } = runBook({ docs, latest, data, stored, today, mcap, rules: ICT_RULES, candidatesOf });
  const r = replayDesk(ledgers, data, ICT_RULES);
  const days = ledgers.map((l) => ({ date: l.date, live: l.live, market: l.market, picks: l.picks.map((p) => ({ ...p, outcome: r.outcomes[`${l.date}:${p.symbol}`] ?? { status: 'unknown' } })) }));
  return { created, book: { rules: { entry: '구조 전환 다음 날 시가', stop: '쓸고 간 저점 아래', exit: '60일 고점(매수 쪽 유동성)에서 전량' },
    stats: deskStats(r.trades, r.equity), open: r.open, pending: r.pending, trades: r.trades.slice(-30), events: r.events.slice(-30), ledgers: days.slice(-20),
    firstLive: ledgers.find((l) => l.live)?.date ?? null } };
}

export function runDesk({ docs, latest, data, stored, today, storedIct = [] }) {
  const mcap = new Map(); for (const k of ['mid', 'short']) for (const r of latest?.[k] ?? []) if (r.mcap) mcap.set(r.symbol, r.mcap);
  const universe = new Map();
  const { ledgers, created } = runBook({ docs, latest, data, stored, today, mcap, rules: DESK_RULES, universe });
  const ict = ictBook({ docs, latest, data, stored: storedIct, today, mcap });
  const r = replayDesk(ledgers, data);
  const liveTrades = r.trades.filter((t) => t.live);
  const firstLive = ledgers.find((l) => l.live)?.date ?? null;
  const liveEquity = firstLive ? r.equity.filter((e) => e.date >= firstLive) : [];
  const picks = ledgers.map((l) => ({ date: l.date, live: l.live, backfill: !!l.backfill, late: !!l.late, market: l.market,
    picks: l.picks.map((p) => ({ ...p, outcome: r.outcomes[`${l.date}:${p.symbol}`] ?? { status: 'unknown' } })), passed: l === ledgers.at(-1) ? l.passed : undefined }));
  const stats = deskStats(r.trades, r.equity);
  const selection = selectionEdge(ledgers.map((l) => ({ date: l.date, picks: l.picks.map((p) => p.symbol), candidates: universe.get(l.date) ?? [] })), data);
  return {
    created, createdIct: ict.created,
    account: {
      ict: ict.book,
      model: `analyst-desk-v${DESK_RULES.version}`, generatedAt: new Date().toISOString(), asOf: data.cal.at(-1), rules: DESK_RULES, firstLive,
      data: { volumeReliable: data.volumeReliable, earningsChecked: data.earningsChecked, filingsChecked: Boolean(data.filings) },
      stats, statsLive: deskStats(liveTrades, liveEquity), selection, verdict: deskVerdict(stats, selection), risk: r.risk,
      equity: r.equity, trades: r.trades, open: r.open, pending: r.pending, events: r.events.slice(-80), ledgers: picks,
      note: firstLive ? `실시간 기록은 ${firstLive}부터입니다. 그 전 날짜는 같은 규칙을 그날까지의 시세로만 적용한 소급 기록입니다.` : '아직 실시간 기록이 없습니다. 모든 날짜가 같은 규칙을 그날까지의 시세로만 적용한 소급 기록입니다.',
    },
  };
}

/**
 * Share-offering filings from Finnhub (SEC is blocked from GitHub's runners). Tonight's candidates are always
 * refreshed; other symbols are filled from the cache, then fetched while the call budget lasts.
 * Cache: { SYMBOL: { fetchedAt, filings: [{ form, filingDate, url }] } } with only registration/offering forms.
 */
export async function refreshFilings({ cache, todaySymbols, otherSymbols, fetch1, now = Date.now(), budget = 250, log = () => {} }) {
  const fresh = (sym, hours) => cache[sym] && now - Date.parse(cache[sym].fetchedAt) < hours * 3600e3;
  const queue = [...todaySymbols.filter((s) => !fresh(s, 20)), ...otherSymbols.filter((s) => !cache[s])];
  let calls = 0, errors = 0;
  for (const sym of [...new Set(queue)]) {
    if (calls >= budget) break;
    calls++;
    try { cache[sym] = { fetchedAt: new Date(now).toISOString(), filings: (await fetch1(sym)).filter((f) => /^(S-|F-|424B)/i.test(f.form)) }; }
    catch (e) { errors++; if (e.fatal) { log(`filings: stopped (${e.message})`); break; } }
  }
  log(`filings: ${calls} calls, ${errors} errors, cache ${Object.keys(cache).length} symbols`);
  return cache;
}

async function main() {
  const dataDir = arg('data', 'data-branch'), out = arg('out', dataDir), bars = readJSON(arg('bars', join(dataDir, 'sim/bars.json')));
  const data = barsAccess(bars);
  const latest = readJSON(join(dataDir, 'latest.json'));
  try { latest.marketState = readJSON(join(dataDir, 'market-brief/latest.json')).decision?.state ?? null; } catch { latest.marketState = null; }
  const docs = dated(join(dataDir, 'ledger')).map((f) => readJSON(join(dataDir, 'ledger', f)));
  if (!docs.some((d) => d.asOf === latest.asOf)) docs.push({ asOf: latest.asOf, mid: latest.mid.filter((r) => latest.recommendations.mid.includes(r.symbol)), short: latest.short.filter((r) => latest.recommendations.short.includes(r.symbol)) });
  docs.sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
  const ldir = join(out, 'desk/ledger'), srcDir = join(dataDir, 'desk/ledger');
  const stored = [...new Set([...dated(srcDir), ...dated(ldir)])].map((f) => readJSON(existsSync(join(ldir, f)) ? join(ldir, f) : join(srcDir, f)));
  const today = arg('today', latest.asOf);
  // share-offering filings (Finnhub), point-in-time by filing date
  const cachePath = existsSync(join(out, 'desk/filings.json')) ? join(out, 'desk/filings.json') : join(dataDir, 'desk/filings.json');
  let filingsCache = existsSync(cachePath) ? readJSON(cachePath) : {}, earningsCache = {};
  if (process.env.FINNHUB_API_KEY) {
    const { makeFinnhubClient, fetchFilings } = await import('../packages/pipeline/finnhub.mjs');
    const client = makeFinnhubClient({ apiKey: process.env.FINNHUB_API_KEY });
    const syms = (d) => [...new Set(['mid', 'short', 'setups', 'pullback'].flatMap((k) => (d[k] ?? []).map((r) => r.symbol)))];
    const todayDoc = docs.find((d) => d.asOf === latest.asOf), from = new Date(Date.parse(docs[0]?.asOf ?? latest.asOf) - 200 * 864e5).toISOString().slice(0, 10);
    filingsCache = await refreshFilings({ cache: filingsCache, todaySymbols: todayDoc ? syms(todayDoc) : [], otherSymbols: docs.flatMap(syms), budget: Number(process.env.FILINGS_BUDGET ?? 250),
      fetch1: (sym) => fetchFilings(client, sym, from, new Date().toISOString().slice(0, 10)), log: (m) => console.log(m) });
    data.filings = (sym) => filingsCache[sym]?.filings;
    // earnings dates per symbol: candidates of the last 10 sessions (they become pending orders) first
    const ePath = existsSync(join(out, 'desk/earnings.json')) ? join(out, 'desk/earnings.json') : join(dataDir, 'desk/earnings.json');
    earningsCache = existsSync(ePath) ? readJSON(ePath) : {};
    const { fetchEarningsFor } = await import('../packages/pipeline/finnhub.mjs');
    const recent = docs.slice(-10).reverse().flatMap(syms), eFrom = new Date(Date.parse(docs[0]?.asOf ?? latest.asOf) - 30 * 864e5).toISOString().slice(0, 10), eTo = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    let eCalls = 0;
    for (const sym of [...new Set(recent)]) {
      const c = earningsCache[sym]; if (c && Date.now() - Date.parse(c.fetchedAt) < 20 * 3600e3) continue;
      if (eCalls++ >= Number(process.env.EARNINGS_BUDGET ?? 200)) break;
      try { earningsCache[sym] = { fetchedAt: new Date().toISOString(), dates: await fetchEarningsFor(client, sym, eFrom, eTo) }; } catch (e) { if (e.fatal) break; }
    }
    console.log(`earnings: ${eCalls} calls, cache ${Object.keys(earningsCache).length} symbols`);
    const calendar = data.earnings;
    data.earnings = (sym) => earningsCache[sym]?.dates ?? calendar?.(sym);
    data.earningsChecked = true;
  }
  const idir = join(out, 'desk/ict-ledger'), isrc = join(dataDir, 'desk/ict-ledger');
  const storedIct = [...new Set([...dated(isrc), ...dated(idir)])].map((f) => readJSON(existsSync(join(idir, f)) ? join(idir, f) : join(isrc, f)));
  const { created, createdIct, account } = runDesk({ docs, latest, data, stored, today, storedIct });
  for (const [dir, list] of [[ldir, created], [idir, createdIct]]) {
    mkdirSync(dir, { recursive: true });
    for (const c of list) {
      const p = join(dir, `${c.date}.json`);
      if (existsSync(p)) continue; // written once, never replaced
      const { backfill, late, ...rest } = c; writeFileSync(p, JSON.stringify(rest, null, 1));
    }
  }
  writeFileSync(join(out, 'desk/account.json'), JSON.stringify(account));
  if (Object.keys(filingsCache).length) writeFileSync(join(out, 'desk/filings.json'), JSON.stringify(filingsCache));
  if (Object.keys(earningsCache).length) writeFileSync(join(out, 'desk/earnings.json'), JSON.stringify(earningsCache));
  const s = account.stats;
  console.log(`desk: ${account.ledgers.length} days (${created.length} new live), closed ${s.closed}, win ${s.winRate == null ? '-' : (s.winRate * 100).toFixed(0) + '%'}, return ${(s.totalReturn * 100).toFixed(2)}% vs SPY ${s.spyReturn == null ? '-' : (s.spyReturn * 100).toFixed(2) + '%'}, open ${account.open.length}, pending ${account.pending.length}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
