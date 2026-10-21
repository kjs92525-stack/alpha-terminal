#!/usr/bin/env node
// Material for, and publishing of, the Claude-written Telegram channel digest (run by a scheduled
// Claude session on a checkout of the data branch).
//   node scripts/telegram-digest.mjs context --data data-branch [--hours 14] > material.md   (prints NO_NEW_POSTS when there is nothing new)
//     --hours: only posts collected in the last N hours (by collectedAt, so a post the 30-minute collector
//     picks up late is not skipped), for sessions that do not publish; the last digest is then ignored
//   node scripts/telegram-digest.mjs publish --data data-branch --text digest.txt
// The material is kept compact (post text and lists capped) so each digest costs little to write.
import fs from 'node:fs';
import path from 'node:path';
import { extractTickers } from '../packages/analysis/telegram.mjs';
import { storyAsOf } from '../packages/analysis/story-pit.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const dataDir = arg('data', 'data-branch');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch { return d; } };
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%` : '—');
const digestDir = path.join(dataDir, 'telegram', 'digest');
const last = readJson('telegram/digest/latest.json', null);
const cmd = process.argv[2];

if (cmd === 'context') {
  const hours = Number(arg('hours', 0));
  const since = hours > 0 ? new Date(Date.now() - hours * 3600000).toISOString() : last?.through ?? null;
  const at = (p) => Date.parse((hours > 0 && p.collectedAt) || p.date || 0) || 0;
  const posts = (readJson('telegram/posts.json', { posts: [] }).posts ?? []).filter((p) => !since || at(p) > Date.parse(since));
  if (!posts.length) { console.log('NO_NEW_POSTS'); process.exit(0); }
  const shown = posts.slice(-60);
  const out = [`# 채널 글 ${posts.length}건 (${since ? `${since.slice(0, 16)} UTC 이후` : '첫 브리핑'})${posts.length > shown.length ? ` · 최근 ${shown.length}건만 표시` : ''}`];
  for (const p of shown) out.push(`\n[${p.channel}/${p.id} · ${(p.date ?? '').slice(5, 16).replace('T', ' ')}] ${p.text.replace(/\n{2,}/g, '\n').slice(0, 500)}${p.text.length > 500 ? '…' : ''}`);

  const mb = readJson('market-brief/latest.json', null);
  if (mb) {
    if (mb.decision?.state === 'UNKNOWN') out.push('\n(주의: 아래 판정은 시장이 나쁘다는 뜻이 아니라 사이트 시황 자료가 부족해 판단을 보류한 상태입니다.)');
    out.push(`\n# 사이트 시장 판정 (${mb.asOf}): ${mb.decision?.label ?? '—'}`, ...(mb.decision?.reasons ?? []).map((r) => `- ${r}`));
    if (mb.story?.paragraphs) out.push(...mb.story.paragraphs.slice(0, 5).map((r) => `- ${r}`));
    const m = mb.macro;
    if (m?.period) out.push(`- CPI ${m.period}: 전년 ${m.headlineAnnual}% · 전월 ${m.headlineMonthly}% · 근원 전년 ${m.coreAnnual}%`);
    if (mb.news?.length) out.push('## 주요 뉴스', ...mb.news.slice(0, 8).map((n) => `- [${n.topic ?? ''}] ${n.headline}`));
  }
  const nc = readJson('next-cycle.json', null);
  if (nc?.sectors) {
    out.push('\n# 업종 사이클 (사이트 계산)');
    for (const s of nc.sectors.filter((x) => x.status !== 'insufficient').slice(0, 6)) out.push(`- ${s.ko}(${s.etf}) ${s.status} · ${s.phaseKo ?? ''} · ${s.why?.[0] ?? ''}${s.risks?.[0] ? ` / 위험: ${s.risks[0]}` : ''}`);
  }

  const setups = new Map();
  for (const r of readJson('setups.json', { candidates: [] }).candidates ?? []) if (!setups.has(r.symbol)) setups.set(r.symbol, r);
  const companies = path.join(dataDir, 'companies');
  const known = new Set(fs.existsSync(companies) ? fs.readdirSync(companies).map((f) => f.replace(/\.json$/, '')) : []);
  const tickers = [...new Set(shown.flatMap((p) => extractTickers(p.text, known)))].slice(0, 15);
  if (tickers.length) {
    const asOf = mb?.asOf ?? new Date().toISOString().slice(0, 10);
    out.push('\n# 글에 나온 종목 — 사이트 데이터');
    for (const t of tickers) {
      const c = readJson(`companies/${t}.json`, null), row = setups.get(t), st = c?.facts ? storyAsOf(c.facts, asOf) : { known: false };
      const d = row?.edge?.dilution;
      out.push(`- ${t} ${c?.name ?? ''}: ${st.known ? `매출 ${pct(st.prevYoY)}→${pct(st.revYoY)}${st.revAccel ? ' (가속)' : ''}, 순이익 ${st.niImproved ? '개선' : '개선 안 됨'}` : '실적 자료 없음'}${d?.offering ? ', 424B 증자' : d?.shelf ? ', S-3 등록' : ''}${row ? `, 3개월 ${pct(row.ret63)}, 차트 ${row.stage}` : ', 스캔 후보 아님'}`);
    }
  }
  out.push('\n# 검증된 근거 (120일, SPY 대비): 매출 가속 +3.1%p · 가속+순이익 개선 +4.5%p · 순이익만 -0.3%p · 424B -8.4%p · S-3 -8.9%p · 차트 규칙 단독은 우위 없음');
  out.push(`THROUGH=${shown.at(-1).date ?? new Date().toISOString()}`);
  console.log(out.join('\n'));
} else if (cmd === 'publish') {
  const text = fs.readFileSync(arg('text', 'digest.txt'), 'utf8').trim();
  const through = arg('through', new Date().toISOString());
  if (!text) { console.error('빈 브리핑'); process.exit(1); }
  const createdAt = new Date().toISOString();
  const d = { id: createdAt, createdAt, through, text };
  fs.mkdirSync(digestDir, { recursive: true });
  fs.writeFileSync(path.join(digestDir, 'latest.json'), JSON.stringify(d, null, 1));
  const hist = readJson('telegram/digest/history.json', { digests: [] });
  hist.digests = [d, ...hist.digests].slice(0, 60);
  fs.writeFileSync(path.join(digestDir, 'history.json'), JSON.stringify(hist, null, 1));
  console.log(`published ${d.id} (${text.length}자)`);
} else {
  console.error('usage: telegram-digest.mjs context|publish --data <dir>');
  process.exit(1);
}
