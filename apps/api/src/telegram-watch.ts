// Every minute (Cron Trigger): when a new Claude-written channel digest appears on the data branch
// (telegram/digest/latest.json), send it to the owner's bot. The digest itself is written by a
// scheduled Claude session from the posts the GitHub Actions job collects (telegram/posts.json).
// State (linked chat, last digest sent) lives in KV and is written only when it changes, so the
// free plan's daily write limit is never approached.
import { splitMessage } from '../../../packages/analysis/telegram.mjs';

export interface TgEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TG_STATE?: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
  SNAPSHOT_BASE_URL?: string;
}
interface TgState { chatId: string | null; digestId: string | null }
interface Digest { id: string; createdAt: string; text: string }

const DATA = 'https://raw.githubusercontent.com/kjs92525-stack/alpha-terminal/data';
const KEY = 'tg:digest';

async function json<T>(url: string, ttl: number): Promise<T | null> {
  try {
    const res = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true } } as RequestInit);
    return res.ok ? ((await res.json()) as T) : null;
  } catch { return null; }
}

export async function telegramTick(env: TgEnv, now = Date.now()): Promise<{ sent: number; skipped?: string }> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TG_STATE) return { sent: 0, skipped: 'not configured' };
  const base = (env.SNAPSHOT_BASE_URL || DATA).replace(/\/+$/, '');
  const saved = await env.TG_STATE.get(KEY);
  const state: TgState = saved ? JSON.parse(saved) : { chatId: null, digestId: null };
  let dirty = !saved;
  // the chat is linked by the GitHub Actions job (any private message to the bot)
  if (!env.TELEGRAM_CHAT_ID && !state.chatId) {
    const gh = await json<{ chatId?: string | null }>(`${base}/telegram/state.json`, 60);
    if (gh?.chatId) { state.chatId = gh.chatId; dirty = true; }
  }
  const chatId = env.TELEGRAM_CHAT_ID || state.chatId;
  let sent = 0;
  const d = chatId ? await json<Digest>(`${base}/telegram/digest/latest.json`, 60) : null;
  if (d?.id && d.text && d.id !== state.digestId) {
    let ok = true;
    for (const text of splitMessage(d.text)) {
      const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }) });
      if (!r.ok) { ok = false; break; }
      sent++;
    }
    // a failed send is retried on the next tick; a partly sent digest is not repeated
    if (ok || sent) { state.digestId = d.id; dirty = true; }
  }
  if (dirty) await env.TG_STATE.put(KEY, JSON.stringify({ ...state, updatedAt: new Date(now).toISOString() }));
  return { sent };
}
