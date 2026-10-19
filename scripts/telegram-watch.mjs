#!/usr/bin/env node
// Every 30 minutes (GitHub Actions): collect new posts of public Telegram channels from their web
// preview into telegram/posts.json (full text, last 7 days). A scheduled Claude session reads them
// with the site data and writes a digest (telegram/digest/latest.json); the Worker sends it to the bot.
// Env: TELEGRAM_CHANNELS (comma-separated public channel names), TELEGRAM_BOT_TOKEN,
//      TELEGRAM_CHAT_ID (optional — otherwise taken from the first private message sent to the bot).
import fs from 'node:fs';
import path from 'node:path';
import { parseChannelHtml, mergePosts } from '../packages/analysis/telegram.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const dataDir = arg('data', 'data-branch');
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const channels = String(process.env.TELEGRAM_CHANNELS ?? '').split(/[,\s]+/).map((c) => c.replace(/^@|^https?:\/\/t\.me\/(s\/)?/g, '').replace(/\/.*$/, '')).filter((c) => /^[A-Za-z0-9_]{4,64}$/.test(c));
const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
if (!channels.length) { console.log('::notice::TELEGRAM_CHANNELS 비어 있음 — 모을 채널 없음'); process.exit(0); }

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
    log(`봇 @${me.username} · 받은 업데이트 ${ups.length}건`);
    // any private message to the bot links the chat (the Start button sends /start)
    const start = ups.map((u) => u.message).filter((m) => m?.chat?.type === 'private').at(-1);
    if (start) {
      chatId = String(start.chat.id); state.chatId = chatId; log('봇 대화 연결됨');
      try { await bot('sendMessage', { chat_id: chatId, text: `✅ 연결됐습니다. ${channels.join(', ')} 채널 글을 모아 Claude가 정리한 시장·투자 방향 브리핑을 보내드립니다.` }); } catch (e) { console.log(`::warning::연결 확인 메시지 실패: ${e.message}`); }
    }
    else console.log(`::notice::@${me.username} 봇과의 대화방에서 아무 메시지나(/start 등) 보내세요.`);
  } catch (e) { console.log(`::warning::봇 확인 실패: ${e.message}`); }
}

const postsFile = path.join(dataDir, 'telegram', 'posts.json');
const archive = readJson(postsFile, { posts: [] });
const firstArchive = !archive.posts.length;
let added = 0;
const fresh = [];
for (const ch of channels) {
  let posts;
  try {
    const res = await fetch(`https://t.me/s/${ch}`, { headers: { 'user-agent': 'Mozilla/5.0 (alpha-terminal channel check)', 'accept-language': 'ko,en' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    posts = parseChannelHtml(await res.text(), ch);
  } catch (e) { console.log(`::warning::${ch} 읽기 실패: ${e.message}`); continue; }
  if (!posts.length) { console.log(`::warning::${ch}: 공개 미리보기에 글이 없음 (비공개 채널이거나 이름 오류)`); continue; }
  const last = state.lastId[ch] ?? null;
  // first archive: keep the whole preview page (about 20 posts) so the first digest has material
  const take = firstArchive || last == null ? posts : posts.filter((p) => p.id > last);
  state.lastId[ch] = posts.at(-1).id;
  fresh.push(...take.map((p) => ({ ...p, collectedAt: new Date().toISOString() })));
  added += take.length;
  log(`${ch}: 새 글 ${take.length}`);
}
archive.posts = mergePosts(archive.posts, fresh);
archive.updatedAt = new Date().toISOString();
archive.channels = channels;
fs.mkdirSync(path.dirname(stateFile), { recursive: true });
fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
fs.writeFileSync(postsFile, JSON.stringify(archive, null, 1));
log(`저장 ${added}건 · 보관 ${archive.posts.length}건`);
