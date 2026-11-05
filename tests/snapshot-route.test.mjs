import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../apps/api/src/handler.ts';

const seen = [];
globalThis.fetch = async (url) => {
  const u = String(url); seen.push(u);
  if (u.endsWith('/data/desk/account.json')) return Response.json({ asOf: '2026-11-04', stats: { closed: 8 } });
  return new Response('nf', { status: 404 });
};
const env = { ALLOWED_ORIGIN: '*' };
const get = (p) => handle(new Request('https://x.test' + p), env);

test('the snapshot route serves whitelisted data-branch files from our own domain', async () => {
  const r = await get('/api/v1/snapshot/desk/account.json');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).asOf, '2026-11-04');
  assert.match(r.headers.get('Cache-Control'), /max-age=120/);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
  assert.ok(seen.some((u) => u === 'https://raw.githubusercontent.com/kjs92525-stack/alpha-terminal/data/desk/account.json'));
});

test('the snapshot route refuses anything outside the whitelist and passes through a missing file as 404', async () => {
  const before = seen.length;
  assert.equal((await get('/api/v1/snapshot/companies/AAPL.json')).status, 404);
  assert.equal((await get('/api/v1/snapshot/../../etc/passwd')).status, 404);
  assert.equal(seen.length, before, 'no upstream request for a refused path');
  assert.equal((await get('/api/v1/snapshot/sim/watch.json')).status, 404);
});
