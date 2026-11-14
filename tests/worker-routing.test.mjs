import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../apps/api/src/worker.ts';

test('production home serves the terminal instead of redirecting to the standalone desk', async () => {
  const seen = [];
  const env = { ASSETS: { fetch: async (req) => {
    seen.push(new URL(req.url).pathname);
    return new Response('<div id="root"></div>', { headers: { 'Content-Type': 'text/html' } });
  } } };
  for (const path of ['/', '/app', '/desk.html', '/simulator.html', '/assets/app.js']) {
    const res = await worker.fetch(new Request(`https://terminal.test${path}`), env, {});
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Location'), null);
  }
  assert.deepEqual(seen, ['/', '/app', '/desk.html', '/simulator.html', '/assets/app.js']);
});

test('health still uses the API handler rather than the SPA fallback', async () => {
  const env = { ASSETS: { fetch: () => { throw new Error('API request reached assets'); } } };
  const res = await worker.fetch(new Request('https://terminal.test/health'), env, {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});
