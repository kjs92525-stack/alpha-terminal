#!/usr/bin/env node
// Every 30 minutes (GitHub Actions): read new posts of public Telegram channels from their web
// preview, fact-check the tickers they mention against the data branch, send the result to the
// owner's Telegram bot and keep the last results in telegram/latest.json.
// Env: TELEGRAM_CHANNELS (comma-separated public channel names), TELEGRAM_BOT_TOKEN,
//      TELEGRAM_CHAT_ID (optional — otherwise taken from the first private "/start" sent to the bot).
import fs from 'node:fs';
import path from 'node:path';
import { parseChannelHtml, analyzePost, formatReport } from '../packages/analysis/telegram.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const dataDir = arg('data', 'data-branch');
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const channels = String(process.env.TELEGRAM_CHANNELS ?? '').split(/[,\s]+/).map((c) => c.replace(/^@|^https?:\/\/t\.me\/(s\/)?/g, '').replace(/\/.*$/, '')).filter((c) => /^[A-Za-z0-9_]{4,64}$/.test(c));
const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
if (!channels.length) { console.log('::notice::TELEGRAM_CHANNELS 비어 있음 — 분석할 채널 없음'); process.exit(0); }

const stateFile = path.join(dataDir, 'telegram', 'state.json');
const state = readJson(stateFile, { lastId: {}, chatId: null });
const bot = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => null);
  if (!j?.ok) throw new Error(`Telegram ${method}: ${j?.description ?? r.status}`);
  return j.result;
};
let chatId = process.env.TELEGRAM_CHAT_ID || state.chatId;
if (token && !chatId) {
  try {
    const me = await bot('getMe');
    const ups = await bot('getUpdates', { limit: 100 });
    // which bot the token belongs to, and what it has received (no message text is logged)
    log(`봇 @${me.username} · 받은 업데이트 ${ups.length}건 (${[...new Set(ups.map((u) => Object.keys(u).find((k) => k !== 'update_id') + ':' + (u.message?.chat?.type ?? u.my_chat_member?.chat?.type ?? '-')))].join(', ') || '없음'})`);
    // any private message to the bot links the chat (the Start button sends /start)
    const start = ups.map((u) => u.message).filter((m) => m?.chat?.type === 'private').at(-1);
    if (start) {
      chatId = String(start.chat.id); state.chatId = chatId; log('봇 대화 연결됨');
      // confirm the link once, so the owner sees it works before any ticker post arrives
      try { await bot('sendMessage', { chat_id: chatId, text: `✅ 연결됐습니다. ${channels.join(', ')} 채널의 새 글을 30분마다 확인해 종목이 나오면 사이트 데이터로 점검한 결과를 보내드립니다.` }); } catch (e) { console.log(`::warning::연결 확인 메시지 실패: ${e.message}`); }
    }
    else console.log(`::notice::@${me.username} 봇과의 대화방에서 아무 메시지나(/start 등) 보내세요 — 그 전까지 결과는 사이트에만 저장됩니다.`);
  } catch (e) { console.log(`::warning::봇 확인 실패: ${e.message}`); }
}

const setupsJson = readJson(path.join(dataDir, 'setups.json'), { asOf: null, candidates: [] });
const setups = new Map();
for (const r of setupsJson.candidates ?? []) if (!setups.has(r.symbol) || (r.plan && !setups.get(r.symbol).plan)) setups.set(r.symbol, r);
const companiesDir = path.join(dataDir, 'companies');
const known = new Set([...setups.keys(), ...(fs.existsSync(companiesDir) ? fs.readdirSync(companiesDir).map((f) => f.replace(/\.json$/, '')) : [])]);
const brief = readJson(path.join(dataDir, 'market-brief', 'latest.json'), null);
const gate = brief?.decision ? { state: brief.decision.state, label: brief.decision.label } : null;
const asOf = setupsJson.asOf ?? new Date().toISOString().slice(0, 10);
const ctx = { asOf, setups, known, facts: (s) => readJson(path.join(companiesDir, `${s}.json`), null)?.facts ?? null };

const latestFile = path.join(dataDir, 'telegram', 'latest.json');
const latest = readJson(latestFile, { posts: [] });
let sent = 0, analysed = 0;
for (const ch of channels) {
  let posts;
  try {
    const res = await fetch(`https://t.me/s/${ch}`, { headers: { 'user-agent': 'Mozilla/5.0 (alpha-terminal channel check)', 'accept-language': 'ko,en' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    posts = parseChannelHtml(await res.text(), ch);
  } catch (e) { console.log(`::warning::${ch} 읽기 실패: ${e.message}`); continue; }
  if (!posts.length) { console.log(`::warning::${ch}: 공개 미리보기에 글이 없음 (비공개 채널이거나 이름 오류)`); continue; }
  const last = state.lastId[ch] ?? null;
  // first run: only the latest 3 posts, so the bot does not flood the chat with history
  const fresh = last == null ? posts.slice(-3) : posts.filter((p) => p.id > last);
  state.lastId[ch] = posts.at(-1).id;
  for (const p of fresh) {
    const a = analyzePost(p, ctx);
    if (!a.items.length) continue;
    analysed++;
    latest.posts.unshift({ ...a, analysedAt: new Date().toISOString() });
    if (token && chatId) {
      try { await bot('sendMessage', { chat_id: chatId, text: formatReport(a, gate), disable_web_page_preview: true }); sent++; } catch (e) { console.log(`::warning::전송 실패: ${e.message}`); }
    }
  }
  log(`${ch}: 새 글 ${fresh.length} · 종목 언급 ${fresh.filter((p) => analyzePost(p, ctx).items.length).length}`);
}
latest.posts = latest.posts.slice(0, 60);
latest.updatedAt = new Date().toISOString();
latest.dataAsOf = asOf;
latest.channels = channels;
fs.mkdirSync(path.dirname(stateFile), { recursive: true });
fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
fs.writeFileSync(latestFile, JSON.stringify(latest, null, 1));
log(`분석 ${analysed}건 · 전송 ${sent}건`);
