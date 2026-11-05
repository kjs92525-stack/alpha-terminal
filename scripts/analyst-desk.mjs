// Nightly analyst desk. Reads the day's recommendation lists and real bars, writes tonight's picks once
// (desk/ledger/YYYY-MM-DD.json, never modified afterwards) and replays the paper account from every stored
// pick (desk/account.json). Dates before the first stored pick are filled in as a clearly flagged backfill.
// Usage: node scripts/analyst-desk.mjs --data data-branch --bars data-branch/sim/bars.json [--out data-branch]
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pickForDay, replayDesk, deskStats, DESK_RULES } from '../packages/analysis/analyst-desk.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const dated = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : []);

/** sim/bars.json → { cal, get(sym) } with bar objects */
export function barsAccess(payload) {
  const cache = new Map();
  return { cal: payload.cal, gates: payload.gates ?? {}, get(sym) {
    if (cache.has(sym)) return cache.get(sym);
    const x = payload.bars[sym]; const v = x ? { s: x.s, bars: x.d.map(([o, h, l, c, v2]) => ({ o, h, l, c, v: v2 })) } : null;
    cache.set(sym, v); return v;
  } };
}
const calIdx = (cal, date) => { let lo = 0, hi = cal.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (cal[m] <= date) { a = m; lo = m + 1; } else hi = m - 1; } return a; };

export function candidatesFor(doc, data, d, mcap) {
  const out = [];
  for (const [list, source] of [['mid', '중장기 랭킹'], ['short', '단기 랭킹'], ['setups', '돌파 셋업'], ['pullback', '눌림목 셋업']]) {
    for (const r of doc[list] ?? []) {
      const x = data.get(r.symbol); if (!x || d < x.s) continue;
      const i = d - x.s; if (i >= x.bars.length) continue;
      out.push({ symbol: r.symbol, name: r.name, sector: r.sector, score: r.score, mcap: mcap.get(r.symbol) ?? null, source, bars: x.bars, i });
    }
  }
  return out;
}
function spyRet126(data, d) { const x = data.get('SPY'); const i = d - (x?.s ?? 0); return x && i >= 126 ? x.bars[i].c / x.bars[i - 126].c - 1 : null; }
/** state of the account as of session d: symbols held or with a working order */
function busyAt(ledgers, data, d) {
  if (!ledgers.length) return new Set();
  const r = replayDesk(ledgers, { cal: data.cal.slice(0, d + 1), get: data.get.bind(data) });
  return new Set([...r.open.map((p) => p.symbol), ...r.pending.map((p) => p.symbol)]);
}

export function runDesk({ docs, latest, data, stored, today }) {
  const mcap = new Map(); for (const k of ['mid', 'short']) for (const r of latest?.[k] ?? []) if (r.mcap) mcap.set(r.symbol, r.mcap);
  const liveStart = stored.length ? stored[0].date : null;
  const ledgers = [], created = [];
  for (const doc of docs) {
    const d = calIdx(data.cal, doc.asOf); if (d < 0 || data.cal[d] !== doc.asOf) continue; // need that day's close
    const have = stored.find((s) => s.date === doc.asOf);
    if (have) { ledgers.push(have); continue; }
    const market = data.gates[doc.asOf] ?? (doc.asOf === latest?.asOf ? latest?.marketState : null) ?? 'UNKNOWN';
    const res = pickForDay({ date: doc.asOf, candidates: candidatesFor(doc, data, d, mcap), market, spyRet126: spyRet126(data, d), busy: busyAt(ledgers, data, d) });
    const live = doc.asOf === today;
    const entry = { date: doc.asOf, live, backfill: !live, late: !live && liveStart != null && doc.asOf > liveStart, createdAt: new Date().toISOString(), market: res.market, picks: res.picks, passed: res.passed.slice(0, 40) };
    ledgers.push(entry); if (live) created.push(entry);
  }
  ledgers.sort((a, b) => (a.date < b.date ? -1 : 1));
  const r = replayDesk(ledgers, data);
  const liveTrades = r.trades.filter((t) => t.live);
  const firstLive = ledgers.find((l) => l.live)?.date ?? null;
  const liveEquity = firstLive ? r.equity.filter((e) => e.date >= firstLive) : [];
  const picks = ledgers.map((l) => ({ date: l.date, live: l.live, backfill: !!l.backfill, late: !!l.late, market: l.market,
    picks: l.picks.map((p) => ({ ...p, outcome: r.outcomes[`${l.date}:${p.symbol}`] ?? { status: 'unknown' } })), passed: l === ledgers.at(-1) ? l.passed : undefined }));
  return {
    created,
    account: {
      model: 'analyst-desk-v1', generatedAt: new Date().toISOString(), asOf: data.cal.at(-1), rules: DESK_RULES, firstLive,
      stats: deskStats(r.trades, r.equity), statsLive: deskStats(liveTrades, liveEquity),
      equity: r.equity, trades: r.trades, open: r.open, pending: r.pending, events: r.events.slice(-80), ledgers: picks,
      note: firstLive ? `실시간 기록은 ${firstLive}부터입니다. 그 전 날짜는 같은 규칙을 그날까지의 시세로만 적용한 소급 기록입니다.` : '아직 실시간 기록이 없습니다. 모든 날짜가 같은 규칙을 그날까지의 시세로만 적용한 소급 기록입니다.',
    },
  };
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
  const { created, account } = runDesk({ docs, latest, data, stored, today });
  mkdirSync(ldir, { recursive: true });
  for (const c of created) {
    const p = join(ldir, `${c.date}.json`);
    if (existsSync(p)) continue; // written once, never replaced
    const { backfill, late, ...rest } = c; writeFileSync(p, JSON.stringify(rest, null, 1));
  }
  writeFileSync(join(out, 'desk/account.json'), JSON.stringify(account));
  const s = account.stats;
  console.log(`desk: ${account.ledgers.length} days (${created.length} new live), closed ${s.closed}, win ${s.winRate == null ? '-' : (s.winRate * 100).toFixed(0) + '%'}, return ${(s.totalReturn * 100).toFixed(2)}% vs SPY ${s.spyReturn == null ? '-' : (s.spyReturn * 100).toFixed(2) + '%'}, open ${account.open.length}, pending ${account.pending.length}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
