import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPayload, readGates } from '../scripts/sim-bars.mjs';

const t = (d) => Date.parse(d + 'T00:00:00Z') / 1000;
const bar = (d, c, v = 100) => ({ time: t(d), open: c, high: c + 1, low: c - 1, close: c, volume: v });

test('buildPayload aligns every series to the SPY calendar and fills missing days flat', () => {
  const bars = {
    SPY: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map((d, i) => bar(d, 600 + i)),
    ABC: [bar('2026-10-13', 10), bar('2026-10-15', 12)], // listed late, missing 10-14
  };
  const p = buildPayload([{ asOf: '2026-10-13', mid: [{ symbol: 'ABC', name: 'Abc', sector: 'Tech', score: 80, extra: 1 }], short: [] }], bars, 'now');
  assert.deepEqual(p.cal, ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
  assert.equal(p.bars.ABC.s, 1);
  assert.deepEqual(p.bars.ABC.d.map((r) => r[3]), [10, 10, 12]);
  assert.equal(p.bars.ABC.d[1][4], 0, 'filled day has zero volume');
  assert.deepEqual(p.ledgers[0].mid[0], { symbol: 'ABC', name: 'Abc', sector: 'Tech', score: 80 });
  assert.equal(p.asOf, '2026-10-15');
});

test('buildPayload refuses to build without SPY', () => {
  assert.throws(() => buildPayload([], { ABC: [bar('2026-10-13', 10)] }), /SPY/);
});

test('readGates maps each market-brief history file to its verdict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-')); mkdirSync(join(dir, 'h'));
  writeFileSync(join(dir, 'h/2026-10-20.json'), JSON.stringify({ asOf: '2026-10-20', decision: { state: 'LIMIT' } }));
  writeFileSync(join(dir, 'h/2026-10-21.json'), '{broken');
  assert.deepEqual(readGates(join(dir, 'h')), { '2026-10-20': 'LIMIT' });
  assert.deepEqual(readGates(join(dir, 'missing')), {});
});
