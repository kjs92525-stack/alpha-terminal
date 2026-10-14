import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEarlyStory, representativeEvidence } from '../packages/analysis/early-story.mjs';
const row = { ticker: 'FF', name: 'FutureFuel', status: 'watch', evidence: [], reasons: [], risk: { level: 'unknown', checked: false } };
test('reviewed stories separate business facts, conditional interpretation and accounting risk', () => {
  const s = buildEarlyStory(row, '2026-10-13');
  assert.equal(s.reviewed, true);
  assert.match(s.change, /신규 고객/); assert.match(s.risk, /헤지/);
  assert.match(s.thesis, /때/); assert.match(s.status, /관찰/); assert.match(s.funding, /불완전/);
  const chip = buildEarlyStory({ ...row, ticker: 'ICHR' }, '2026-10-13');
  assert.match(chip.risk, /ATM/); assert.match(chip.risk, /음수/);
  const biotech = buildEarlyStory({ ...row, ticker: 'ARVN' }, '2026-10-13');
  assert.match(biotech.change, /이연수익/); assert.match(biotech.thesis, /반복 매출로 가정.*성립하지/);
  const defense = buildEarlyStory({ ...row, ticker: 'KOPN' }, '2026-10-13');
  assert.match(defense.change, /시제품/); assert.match(defense.risk, /보장하지/);
});
test('future publications, stale context, newer financial report and invalid asOf cannot show editorial thesis', () => {
  assert.equal(buildEarlyStory(row, '2026-08-09').reviewed, false);
  assert.equal(buildEarlyStory(row, '2027-01-01').reviewed, false);
  assert.equal(buildEarlyStory(row, 'bad').reviewed, false);
  assert.equal(buildEarlyStory({ ...row, evidence: [{ kind: 'financial', publishedAt: '2026-11-01', period: '2026-09-30' }] }, '2026-11-02').reviewed, false);
});
test('unreviewed fallback does not invent losses, contracts or macro benefits', () => {
  const s = buildEarlyStory({ ...row, ticker: 'UNKNOWN' }, '2026-10-13');
  assert.equal(s.reviewed, false); assert.match(s.change, /부족/); assert.doesNotMatch(s.change, /적자|흑자|계약/);
  assert.match(s.next, /확인되지 않은/);
  assert.match(buildEarlyStory({ ...row, ticker: 'UNKNOWN', status: 'excluded' }, '2026-10-13').status, /제외/);
});
test('representative evidence deduplicates same fact, bounds history, preserves dilution, rejects future evidence', () => {
  const point = (period, value, title = '성장 가속') => ({ kind: 'financial', title, period, value, publishedAt: period, source: 'SEC', url: 'https://sec.gov/a', confidence: 'reported' });
  const e = [point('2026-06-30', 10), point('2026-06-30', 10, '매출 YoY'), point('2026-03-31', 5), point('2025-12-31', 3), point('2026-12-31', 99), { kind: 'filing', title: 'ATM', publishedAt: '2026-05-01' }];
  const compact = representativeEvidence({ ...row, evidence: e }, '2026-10-13');
  assert.equal(compact.filter((p) => p.kind === 'financial').length, 2);
  assert.ok(compact.some((p) => p.title === 'ATM'));
  assert.ok(compact.every((p) => p.publishedAt <= '2026-10-13'));
});
