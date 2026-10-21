#!/usr/bin/env node
// Point-in-time market breadth history: for every trading day, the share of stocks above their 50- and
// 200-day averages, with the same sample rules as the nightly marketBreadth (>=200 bars, close >= $1,
// 20-day average dollar volume >= $1M, a bar on that day).
// Two universes, because today's listing alone is survivor-biased:
//   listed — stocks listed today (what the site uses);
//   all    — listed plus Alpaca's inactive (delisted) US equities, where Alpaca still serves their bars.
// Symbols reused by a later company and delistings Alpaca does not list remain a known gap.
// Usage: node scripts/breadth-history.mjs --out <dir> [--start 2015-01-01] [--limit 0]
// Needs ALPACA_KEY_ID / ALPACA_SECRET_KEY. Bars are processed batch by batch and not kept.
import fs from 'node:fs';
import path from 'node:path';
import { fetchAssets, fetchDailyBars } from '../packages/pipeline/alpaca.mjs';
import { buildUniverse } from '../packages/pipeline/universe.mjs';

const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

/** Adds one symbol's daily flags to `acc` (Map date -> [present, sample, above50, above200]). */
export function addSymbol(acc, bars) {
  const n = bars.length;
  if (!n) return;
  const c = bars.map((b) => b.close), dv = bars.map((b) => (Number.isFinite(b.volume) && b.volume >= 0 ? b.volume * b.close : 0));
  const pc = [0], pd = [0];
  for (let i = 0; i < n; i++) { pc.push(pc[i] + c[i]); pd.push(pd[i] + dv[i]); }
  const avg = (p, j, k) => (p[j + 1] - p[j + 1 - k]) / k;
  for (let j = 0; j < n; j++) {
    const d = day(bars[j].time);
    let row = acc.get(d);
    if (!row) acc.set(d, (row = [0, 0, 0, 0]));
    row[0]++;
    if (j < 199 || c[j] < 1 || avg(pd, j, 20) < 1e6) continue;
    row[1]++;
    if (c[j] > avg(pc, j, 50)) row[2]++;
    if (c[j] > avg(pc, j, 200)) row[3]++;
  }
}

/** Map -> sorted rows { asOf, universe, sample, coverage, above50, above200 } in the shape buildMarketBrief reads. */
export function toSeries(acc) {
  return [...acc.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([asOf, [present, sample, a50, a200]]) => ({
    asOf, universe: present, sample, coverage: present ? sample / present : 0,
    above50: sample ? a50 / sample : null, above200: sample ? a200 / sample : null,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const outDir = arg('out', 'research-out'), start = arg('start', '2015-01-01'), limit = Number(arg('limit', 0));
  const keys = { keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY };
  const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
  let listed = buildUniverse(await fetchAssets({ ...keys })).map((u) => u.symbol);
  const listedSet = new Set(listed);
  let inactive = buildUniverse(await fetchAssets({ ...keys, status: 'inactive' })).map((u) => u.symbol).filter((s) => !listedSet.has(s));
  if (limit > 0) { listed = listed.slice(0, limit); inactive = inactive.slice(0, limit); }
  log(`listed ${listed.length} · inactive ${inactive.length} · from ${start}`);
  const accListed = new Map(), accAll = new Map();
  let inactiveWithBars = 0;
  const end = new Date(Date.now() - 20 * 60000).toISOString();
  for (const [group, symbols] of [['listed', listed], ['inactive', inactive]]) {
    for (let i = 0; i < symbols.length; i += 100) {
      const batch = symbols.slice(i, i + 100);
      let bars;
      try { bars = (await fetchDailyBars({ symbols: batch, start, end, ...keys })).bars; }
      catch (e) { log(`${group} batch ${i}: ${e.message}`); continue; }
      for (const s of batch) {
        const b = bars[s] ?? [];
        if (!b.length) continue;
        if (group === 'listed') addSymbol(accListed, b); else inactiveWithBars++;
        addSymbol(accAll, b);
      }
      if ((i / 100) % 10 === 0) log(`${group} ${i + batch.length}/${symbols.length}`);
    }
  }
  const report = {
    model: 'breadth-history-v1', start, generatedAt: new Date().toISOString(),
    counts: { listed: listed.length, inactive: inactive.length, inactiveWithBars },
    method: '날짜별로 그날 종가가 있고 200봉 이상·종가 $1 이상·20일 평균 거래대금 $1M 이상인 종목 중 50일·200일 평균 위 비율(야간 marketBreadth와 같은 표본 규칙).',
    limits: '"listed"는 현재 상장 종목만이라 생존편향이 있습니다. "all"은 Alpaca가 inactive로 남긴 상장폐지 종목을 더했지만, Alpaca 목록에 없는 상장폐지 종목과 티커가 재사용된 경우는 바로잡지 못했습니다. 종목 분류(보통주 여부)는 현재 이름·거래소 기준입니다.',
    listed: toSeries(accListed), all: toSeries(accAll),
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'breadth-history.json'), JSON.stringify(report));
  const pick = (s) => s.filter((_, k) => k % 250 === 0).map((r) => `${r.asOf} n=${r.sample} 50d=${(r.above50 * 100).toFixed(0)}% 200d=${(r.above200 * 100).toFixed(0)}%`);
  log(JSON.stringify({ counts: report.counts, listedSample: pick(report.listed), allSample: pick(report.all) }, null, 1));
}
