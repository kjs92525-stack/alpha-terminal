import test from 'node:test';
import assert from 'node:assert/strict';
import { assetPivotSignals, headlineAmount, classifyPivotHeadline } from '../packages/analysis/asset-pivot.mjs';

const facts = (capex, prior, extra = {}) => ({
  revenue: { value: 200e6 }, operatingCashFlow: { value: 40e6 }, cash: { value: 300e6 },
  capexTtm: { value: capex, end: '2026-06-30' }, capexTtmPrior: prior == null ? null : { value: prior }, ...extra,
});

test('headline amounts and kinds: demand vs financing vs acquisition', () => {
  assert.equal(headlineAmount('IREN signs $9.7 billion AI cloud contract'), 9.7e9);
  assert.equal(headlineAmount('Wins $250M order'), 250e6);
  assert.equal(headlineAmount('no number here'), null);
  assert.equal(classifyPivotHeadline('signs $9.7 billion AI cloud contract with hyperscaler'), 'demand');
  assert.equal(classifyPivotHeadline('prices $1 billion convertible notes offering'), 'financing');
  assert.equal(classifyPivotHeadline('Company to be acquired by Buyer for $2 billion in cash'), 'acquisition');
});

test('a contract worth 10%+ of market cap or a capex build-out is a pivot; financing alone is not', () => {
  const news = [
    { time: '2026-09-20T12:00:00Z', headline: 'Miner signs $1.5 billion multi-year AI cloud contract', url: 'https://x' },
    { time: '2026-09-25T12:00:00Z', headline: 'Miner prices $500 million convertible notes offering', url: 'https://y' },
  ];
  const p = assetPivotSignals({ news, facts: facts(150e6, 40e6), mcap: 3e9, asOf: '2026-10-14' });
  assert.equal(p.pivot, true);
  assert.equal(p.material, 1);
  assert.ok(Math.abs(p.contracts[0].ratio - 0.5) < 1e-9);
  assert.equal(p.financing.length, 1);
  assert.equal(p.investmentPhase, true);
  // operations +40M, capex 150M → burns 110M a year; 300M cash ≈ 33 months
  assert.equal(p.fundedMonths, 33);
  const onlyRaise = assetPivotSignals({ news: [news[1]], facts: facts(30e6, 25e6), mcap: 3e9, asOf: '2026-10-14' });
  assert.equal(onlyRaise.pivot, false);
});

test('small contracts, old headlines, buyouts and unknown capex do not make a pivot', () => {
  const small = [{ time: '2026-10-01T00:00:00Z', headline: 'Signs $20 million supply agreement' }];
  assert.equal(assetPivotSignals({ news: small, facts: null, mcap: 3e9, asOf: '2026-10-14' }).pivot, false);
  const old = [{ time: '2026-03-01T00:00:00Z', headline: 'Signs $2 billion lease agreement' }];
  assert.equal(assetPivotSignals({ news: old, facts: null, mcap: 1e9, asOf: '2026-10-14' }).pivot, false);
  const buyout = [{ time: '2026-10-01T00:00:00Z', headline: 'Company to be acquired by Rival in $2 billion deal' }, { time: '2026-10-02T00:00:00Z', headline: 'Signs $900 million contract' }];
  const b = assetPivotSignals({ news: buyout, facts: null, mcap: 1e9, asOf: '2026-10-14' });
  assert.equal(b.pivot, false);
  assert.ok(b.acquisition);
  const none = assetPivotSignals({ news: null, facts: { revenue: { value: 1e8 } }, mcap: 1e9, asOf: '2026-10-14' });
  assert.equal(none.capex, null);
  assert.equal(none.newsChecked, false);
  assert.equal(none.fundedMonths, null);
});
