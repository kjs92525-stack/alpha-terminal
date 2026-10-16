import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioRisk, sharesFor, LIMITS } from '../apps/web/src/lib/portfolio.ts';

const tr = (symbol, sector, status, extra = {}) => ({ symbol, sector, entry: 10, stop: 9, result: { status, fill: status === 'open' ? 10 : null, stop: 9, events: [], ...extra } });

test('1R sizing, open risk shrinks as the stop is raised, orders over the sector or book limit are skipped', () => {
  assert.equal(sharesFor(100, 10, 9), 100);
  assert.equal(sharesFor(100, 9, 10), 0);
  const trades = [
    tr('A', 'Tech', 'open'),                                        // full 1R at risk, $1,000 in Tech
    tr('B', 'Tech', 'open', { stop: 10, half: true, lastClose: 13 }), // breakeven stop → 0R, half left
    tr('C', 'Tech', 'pending'),                                     // Tech would reach 1000+650+1000 = 26.5% > 25%
    tr('D', 'Energy', 'pending'),
  ];
  const b = portfolioRisk(trades, 10000, 100);
  assert.equal(b.openR, 1);
  assert.deepEqual(b.orders.C, ['Tech 비중 27% > 25%']);
  assert.deepEqual(b.orders.D, []);
  assert.equal(b.pendingR, 1);
  assert.equal(b.sectors[0].sector, 'Tech');
  // book limit: six live 1R positions already → the next order is skipped
  const full = [...Array(LIMITS.maxOpenR)].map((_, i) => tr(`O${i}`, `S${i}`, 'open'));
  const f = portfolioRisk([...full, tr('X', 'New', 'pending')], 1e6, 100);
  assert.match(f.orders.X[0], /총위험 7\.0R > 6R/);
});
