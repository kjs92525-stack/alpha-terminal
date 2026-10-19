import test from 'node:test';
import assert from 'node:assert/strict';
import { telegramTick } from '../apps/api/src/telegram-watch.ts';
import { mergePosts, splitMessage } from '../packages/analysis/telegram.mjs';

const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };

function mockFetch(digest, sent) {
  return async (url, init) => {
    const u = String(url);
    if (u.endsWith('/telegram/state.json')) return Response.json({ lastId: { chan1: 10 }, chatId: '777' });
    if (u.endsWith('/telegram/digest/latest.json')) return digest.value ? Response.json(digest.value) : new Response('nf', { status: 404 });
    if (u.includes('api.telegram.org')) { sent.push(JSON.parse(init.body)); return Response.json({ ok: true }); }
    return new Response('nf', { status: 404 });
  };
}

test('worker tick: sends a new digest once (split into chunks), writes KV only on change', async (t) => {
  const sent = [], store = kv(), digest = { value: { id: 'd1', createdAt: '2026-10-19T00:00:00Z', text: 'a'.repeat(3000) + '\n\n' + 'b'.repeat(3000) } };
  t.mock.method(globalThis, 'fetch', mockFetch(digest, sent));
  const env = { TELEGRAM_BOT_TOKEN: 't', TG_STATE: store };
  assert.equal((await telegramTick(env)).sent, 2);
  assert.equal(sent[0].chat_id, '777');
  assert.equal(JSON.parse(store.m.get('tg:digest')).digestId, 'd1');
  let writes = 0; const put = store.put; store.put = async (...a) => { writes++; return put(...a); };
  assert.equal((await telegramTick(env)).sent, 0);
  assert.equal(writes, 0);
  digest.value = { id: 'd2', createdAt: '2026-10-19T04:00:00Z', text: '새 브리핑' };
  assert.equal((await telegramTick(env)).sent, 1);
  assert.equal(sent.at(-1).text, '새 브리핑');
});

test('worker tick: does nothing without a token or KV', async () => {
  assert.equal((await telegramTick({})).skipped, 'not configured');
});

test('mergePosts dedupes, drops old posts and keeps order; splitMessage respects the limit', () => {
  const now = Date.parse('2026-10-19T00:00:00Z');
  const p = (id, date) => ({ id, channel: 'c', url: '', date, text: String(id) });
  const out = mergePosts([p(1, '2026-10-01T00:00:00Z'), p(2, '2026-10-18T00:00:00Z')], [p(2, '2026-10-18T00:00:00Z'), p(3, '2026-10-18T05:00:00Z')], now);
  assert.deepEqual(out.map((x) => x.id), [2, 3]);
  const parts = splitMessage('x'.repeat(9000));
  assert.ok(parts.every((s) => s.length <= 4000));
  assert.equal(parts.join('').length, 9000);
});
