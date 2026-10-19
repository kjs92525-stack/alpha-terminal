import test from 'node:test';
import assert from 'node:assert/strict';
import { telegramTick } from '../apps/api/src/telegram-watch.ts';

const post = (id, html) => `<div class="tgme_widget_message js-widget_message" data-post="chan1/${id}"><div class="tgme_widget_message_text js-message_text" dir="auto">${html}</div><time datetime="2026-10-19T05:00:00+00:00"></time></div>`;
const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const lookup = { asOf: '2026-10-16', gate: { state: 'WAIT', label: '신규 진입 대기' }, symbols: ['IREN', 'AP'], setups: { IREN: { name: 'IREN Ltd', stage: 'BREAKOUT', ret63: 0.1, ret21: 0.05, plan: { entry: 40, stop: 35 }, edge: null } } };

function mockFetch(pages, sent) {
  return async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://t.me/s/')) return new Response(pages.shift() ?? '', { status: 200 });
    if (u.endsWith('/telegram/state.json')) return Response.json({ lastId: { chan1: 10 }, chatId: '777' });
    if (u.endsWith('/telegram/lookup.json')) return Response.json(lookup);
    if (u.includes('/companies/')) return Response.json({ facts: null });
    if (u.includes('api.telegram.org')) { sent.push(JSON.parse(init.body)); return Response.json({ ok: true }); }
    return new Response('nf', { status: 404 });
  };
}

test('worker tick: continues from the Actions state, sends only new ticker posts, writes KV only on change', async (t) => {
  const sent = [], store = kv();
  const pages = [post(10, 'old $IREN') + post(11, 'AP통신: 시황') + post(12, '$IREN 흑자 전환'), post(10, 'old') + post(11, 'x') + post(12, 'y')];
  t.mock.method(globalThis, 'fetch', mockFetch(pages, sent));
  const env = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHANNELS: 'chan1', TG_STATE: store };
  const r1 = await telegramTick(env);
  assert.equal(r1.sent, 1);
  assert.equal(sent[0].chat_id, '777');
  assert.match(sent[0].text, /\[IREN IREN Ltd\]/);
  assert.equal(JSON.parse(store.m.get('tg:state')).lastId.chan1, 12);
  // nothing new: no message, no KV write
  let writes = 0; const put = store.put; store.put = async (...a) => { writes++; return put(...a); };
  const r2 = await telegramTick(env);
  assert.equal(r2.sent, 0);
  assert.equal(writes, 0);
});

test('worker tick: does nothing without a token, channels or KV', async () => {
  assert.equal((await telegramTick({ TELEGRAM_CHANNELS: 'chan1' })).skipped, 'not configured');
});
