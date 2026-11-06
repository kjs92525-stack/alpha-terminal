import test from 'node:test';
import assert from 'node:assert/strict';
import { nightlyKick, nyClock } from '../apps/api/src/nightly-kick.ts';

const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const env = (store) => ({ GITHUB_DISPATCH_TOKEN: 't', TG_STATE: store });

test('nyClock follows US daylight saving', () => {
  assert.deepEqual(nyClock(Date.parse('2026-11-05T21:30:00Z')), { date: '2026-11-05', weekday: 4, minutes: 16 * 60 + 30 }); // EST
  assert.deepEqual(nyClock(Date.parse('2026-07-01T20:30:00Z')), { date: '2026-07-01', weekday: 3, minutes: 16 * 60 + 30 }); // EDT
});

test('nightly kick: starts once per weekday after 16:25 New York, retries on failure', async (t) => {
  const calls = []; let status = 204;
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(null, { status }); });
  const store = kv();
  assert.equal((await nightlyKick(env(store), Date.parse('2026-11-05T21:20:00Z'))).skipped, 'outside window'); // 16:20 EST
  assert.equal(calls.length, 0);
  status = 500;
  assert.equal((await nightlyKick(env(store), Date.parse('2026-11-05T21:26:00Z'))).started, false);
  assert.equal(store.m.size, 0, 'a failed dispatch is retried next minute');
  status = 204;
  assert.equal((await nightlyKick(env(store), Date.parse('2026-11-05T21:27:00Z'))).started, true);
  assert.match(calls.at(-1).url, /repos\/kjs92525-stack\/alpha-terminal\/actions\/workflows\/nightly\.yml\/dispatches$/);
  assert.deepEqual(calls.at(-1).body, { ref: 'main' });
  assert.equal((await nightlyKick(env(store), Date.parse('2026-11-05T21:40:00Z'))).skipped, 'already started');
  assert.equal(calls.length, 2);
  assert.equal((await nightlyKick(env(store), Date.parse('2026-11-07T21:30:00Z'))).skipped, 'weekend');
  assert.equal((await nightlyKick(env(store), Date.parse('2026-11-06T01:30:00Z'))).skipped, 'outside window'); // 20:30 NY
  assert.equal((await nightlyKick({ TG_STATE: store }, Date.parse('2026-11-05T21:30:00Z'))).skipped, 'not configured');
});
