import test from 'node:test';import assert from 'node:assert/strict';
import {storySignals} from '../packages/analysis/story.mjs';
import {financialReview} from '../packages/analysis/financial-review.mjs';
const q=(end,value)=>({end,value});
test('old reports cannot create current growth or profit inflection points',()=>{
 const f={revenueQuarterly:[q('2022-03-31',100),q('2022-06-30',100),q('2023-03-31',120),q('2023-06-30',160)],netIncomeQuarterly:[q('2022-06-30',-10),q('2023-06-30',20)]};
 const d=storySignals({fundamentals:f,asOf:'2026-10-14'});assert.equal(d.storyScore,0);assert.equal(d.signals.revenueAcceleration,false);assert.equal(d.signals.profitTurnaround,false);assert.equal(d.narrative.quality.growthFresh,false);assert.match(d.narrative.lines.join(' '),/200일/);
});
test('JAKK refund is not a recurring operating turnaround and period-scoped review cannot leak forward',()=>{
 const review=financialReview('JAKK','2026-10-14','2026-06-30');assert.equal(review.profitCap,0);assert.match(review.quality,/관세 환급/);assert.equal(financialReview('JAKK','2026-07-22','2026-06-30'),null);
 const d=storySignals({ticker:'JAKK',fundamentals:{netIncomeQuarterly:[q('2025-06-30',-2.319e6),q('2026-06-30',5.863e6)]},asOf:'2026-10-14'});assert.equal(d.storyScore,0);assert.equal(d.signals.profitTurnaround,false);assert.equal(d.narrative.quality.profitBlocked,true);assert.match(d.narrative.lines.join(' '),/영업손익/);
});

test('a reviewed cash-buyout situation is not a neglected independent growth inflection',()=>{const d=storySignals({ticker:'ARX',fundamentals:{netIncomeQuarterly:[q('2025-06-30',-10),q('2026-06-30',80)]},asOf:'2026-10-14'});assert.equal(d.signals.profitTurnaround,false);assert.equal(d.storyScore,0);assert.match(d.narrative.lines.join(' '),/인수계약/);});
