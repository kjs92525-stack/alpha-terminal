import test from 'node:test';
import assert from 'node:assert/strict';
import { runGateBacktest, priceGateState } from '../scripts/market-gate-backtest.mjs';

const mk = (n, f) => Array.from({ length: n }, (_, i) => { const t = Date.UTC(2020, 0, 1) / 1000 + i * 86400; const c = f(i); return { time: t, open: c, high: c, low: c, close: c, volume: 1e6 }; });
const now = Date.UTC(2030, 0, 1);

test('steady uptrend is SELECTIVE and a crash flips the gate before the damage compounds', () => {
  const up = (i) => 100 * 1.001 ** i;
  const crash = (i) => (i < 400 ? up(i) : up(400) * 0.97 ** (i - 400));
  const calm = runGateBacktest({ SPY: mk(450, up), QQQ: mk(450, up), IWM: mk(450, up) }, { now });
  assert.ok(calm.byState.SELECTIVE.days > 0 && calm.byState.WAIT.days === 0);
  const bad = runGateBacktest({ SPY: mk(450, crash), QQQ: mk(450, crash), IWM: mk(450, crash) }, { now });
  assert.ok(bad.byState.WAIT.days > 0);
  assert.ok(bad.gatedIwm.maxDrawdown > bad.holdIwm.maxDrawdown, 'gate must lose less than holding in a one-way crash');
});

test('missing history yields no state', () => {
  assert.equal(priceGateState({ SPY: null, QQQ: null, IWM: null }), null);
});
