// Every minute (Cron Trigger): read new posts of public Telegram channels from their web preview,
// fact-check the tickers they name against the nightly data and send the result to the owner's bot.
// State (last post id per channel, linked chat) lives in KV; it is written only when it changes, so
// the free plan's daily write limit is never approached.
import { parseChannelHtml, extractTickers, analyzePost, formatReport, type TgLookup } from '../../../packages/analysis/telegram.mjs';

export interface TgEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_CHANNELS?: string;
  TG_STATE?: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
  SNAPSHOT_BASE_URL?: string;
}
interface TgState { lastId: Record<string, number>; chatId: string | null }

const DATA = 'https://raw.githubusercontent.com/kjs92525-stack/alpha-terminal/data';
const KEY = 'tg:state';

async function json<T>(url: string, ttl: number): Promise<T | null> {
  try {
    const res = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true } } as RequestInit);
    return res.ok ? ((await res.json()) as T) : null;
  } catch { return null; }
}

export async function telegramTick(env: TgEnv, now = Date.now()): Promise<{ checked: string[]; sent: number; skipped?: string }> {
  const channels = String(env.TELEGRAM_CHANNELS ?? '').split(/[,\s]+/).filter((c) => /^[A-Za-z0-9_]{4,64}$/.test(c));
  if (!channels.length || !env.TELEGRAM_BOT_TOKEN || !env.TG_STATE) return { checked: [], sent: 0, skipped: 'not configured' };
  const base = (env.SNAPSHOT_BASE_URL || DATA).replace(/\/+$/, '');
  const saved = await env.TG_STATE.get(KEY);
  const state: TgState = saved ? JSON.parse(saved) : { lastId: {}, chatId: null };
  let dirty = false;
  // first run: continue from where the GitHub Actions checker stopped (and reuse its linked chat)
  if (!saved) {
    const gh = await json<TgState>(`${base}/telegram/state.json`, 60);
    if (gh) { state.lastId = { ...gh.lastId }; state.chatId = gh.chatId ?? null; }
    dirty = true;
  }
  const chatId = env.TELEGRAM_CHAT_ID || state.chatId;
  let lookup: TgLookup | null = null, sent = 0;
  for (const ch of channels) {
    let posts;
    try {
      const res = await fetch(`https://t.me/s/${ch}`, { headers: { 'user-agent': 'Mozilla/5.0 (alpha-terminal channel check)', 'accept-language': 'ko,en' } });
      if (!res.ok) continue;
      posts = parseChannelHtml(await res.text(), ch);
    } catch { continue; }
    if (!posts.length) continue;
    const last = state.lastId[ch];
    const fresh = last == null ? [] : posts.filter((p) => p.id > last);
    if (last !== posts.at(-1)!.id) { state.lastId[ch] = posts.at(-1)!.id; dirty = true; }
    if (!fresh.length || !chatId) continue;
    lookup ??= await json<TgLookup>(`${base}/telegram/lookup.json`, 600);
    if (!lookup) continue;
    const known = new Set(lookup.symbols), setups = new Map(Object.entries(lookup.setups));
    for (const p of fresh) {
      const tickers = extractTickers(p.text, known);
      if (!tickers.length) continue;
      const facts = new Map<string, unknown>();
      await Promise.all(tickers.map(async (t) => facts.set(t, (await json<{ facts?: unknown }>(`${base}/companies/${t}.json`, 3600))?.facts ?? null)));
      const a = analyzePost(p, { asOf: lookup.asOf, setups, known, facts: (s) => facts.get(s) ?? null });
      if (!a.items.length) continue;
      const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: formatReport(a, lookup.gate), disable_web_page_preview: true }) });
      if (r.ok) sent++;
    }
  }
  if (dirty) await env.TG_STATE.put(KEY, JSON.stringify({ ...state, updatedAt: new Date(now).toISOString() }));
  return { checked: channels, sent };
}
