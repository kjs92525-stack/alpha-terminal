import test from 'node:test';
import assert from 'node:assert/strict';
import { storyPicks, buildStoryPrompt } from '../apps/web/src/lib/storyPicks.ts';

const row = (o) => ({
  type: 'pullback', symbol: 'X', name: 'X Corp', sector: 'Information Technology', price: 10, mcap: 1e9, adv20: 5e6, stage: 'BOUNCE',
  plan: { entry: 10.2, stop: 9.5, stopKind: '눌림 저점 아래', target: 12, riskPct: 0.07, rMultiple: 2.6, note: null, how: '다음 거래일 오늘 고가 $10.20 위에서 매수 · 손절 $9.50' },
  mcap: 2e9,
  chartScore: 70, storyScore: 40, score: 57, reasons: [], themes: [], revenueYoY: [], news: [], newsChecked: true, ...o,
});

test('story picks: chart buy area + story signals, turnaround ranked first, chart-only excluded', () => {
  const data = { asOf: '2026-10-12', candidates: [
    row({ symbol: 'TURN', reasons: [{ kind: 'plus', text: '매출 성장 가속: 10% → 30% (3개 분기)', pts: 20 }, { kind: 'plus', text: '부정적 기사 비중 40%인데 실적은 개선 중 — 시장이 의심하는 성장', pts: 10 }],
      narrative: { lines: ['2026-09 분기 순손실 -$12.0M로 아직 적자지만, 1년 전(-$40.0M)보다 적자가 70% 줄었습니다.'], takeaway: '적자지만 …', method: 'm' } }),
    row({ symbol: 'THEME', themes: ['AI'], reasons: [{ kind: 'plus', text: '테마 연결: AI', pts: 5 }] }),
    row({ symbol: 'CHART', chartScore: 95 }), // no story signal
    row({ symbol: 'RISKY', stage: 'BOUNCE', plan: { ...row({}).plan, riskPct: 0.3 }, reasons: [{ kind: 'plus', text: '흑자 전환', pts: 25 }] }),
    row({ symbol: 'EXT', stage: 'EXTENDED', reasons: [{ kind: 'plus', text: '흑자 전환', pts: 25 }] }),
    row({ symbol: 'LOWR', plan: { ...row({}).plan, rMultiple: 0.4 }, reasons: [{ kind: 'plus', text: '흑자 전환', pts: 25 }] }),
    row({ symbol: 'WIDE', reasons: [{ kind: 'plus', text: '매출 성장 가속: 30% → 36% (3개 분기)', pts: 20 }],
      narrative: { lines: ['2026-06 분기 순손실 -$170.0M로 아직 적자지만, 1년 전(-$50.4M)보다 적자가 237% 늘었습니다.'], takeaway: 't', method: 'm' } }),
  ] };
  const picks = storyPicks(data,8,'legacy');
  assert.deepEqual(picks.map((p) => p.row.symbol), ['TURN', 'THEME', 'WIDE']);
  assert.ok(picks[0].why.includes('적자지만 개선 중') && picks[0].why.includes('시장은 의심 중'));
  const wide = picks.find((p) => p.row.symbol === 'WIDE');
  assert.ok(wide.why.includes('⚠ 적자 확대') && !wide.why.includes('적자지만 개선 중'), 'growing losses are flagged, not praised');
});

test('story prompt carries the setup, buy point, numbers, headlines and the analysis checklist', () => {
  const r = row({ symbol: 'ACME', news: [{ time: '2026-10-08T12:00:00Z', headline: 'ACME wins Army contract' }], narrative: { lines: ['매출 가속'], takeaway: '개선 중', method: 'm' } });
  const p = buildStoryPrompt(r, '2026-10-12');
  for (const s of ['ACME', '눌림목', '지지 반등', '오늘 고가 $10.20', '손절 $9.50 (-7.0%)', '2.6R', 'ACME wins Army contract', '→ 개선 중', '시장이 의심하는 이유', '반대 논리', '출처']) assert.ok(p.includes(s), s);
});

test('review-rejected profit and growth cannot reappear as pick bonuses via stale positive text',()=>{
 const r=row({symbol:'KOPN',themes:['방산'],reasons:[{kind:'plus',text:'흑자 전환',pts:25},{kind:'plus',text:'매출 성장 가속',pts:20},{kind:'minus',text:'원문 검토에서 가점 제외',pts:-45}],narrative:{lines:['1년 전 적자에서 흑자로 돌아섰습니다.'],takeaway:'본업 미검증',method:'review',quality:{profitBlocked:true,growthBlocked:true}}});
 const p=storyPicks({asOf:'2026-10-13',candidates:[r]},8,'legacy');assert.equal(p.length,1);assert.deepEqual(p[0].why,['테마: 방산']);
});

const earlyRow=(o={})=>row({type:'breakout',stage:'BREAKOUT',priceAsOf:'2026-10-14',ret1:0.02,ret5:0.08,ret63:0.18,ret21:0.08,storySignals:{revenueAcceleration:true,profitTurnaround:false,lossNarrowing:false},reasons:[{kind:'plus',text:'매출 성장 가속',pts:20}],narrative:{lines:[],takeaway:'t',method:'m',quality:{growthBlocked:false,profitBlocked:false,growthFresh:true,profitFresh:true,revenuePeriod:'2026-06-30',profitPeriod:'2026-06-30'}},...o});
test('default discovery separates early turns from pullbacks, unconfirmed bottoms, themes and extended rallies',()=>{
 const rows=[earlyRow({symbol:'EARLY'}),earlyRow({symbol:'PULL',type:'pullback',stage:'BOUNCE'}),earlyRow({symbol:'BOTTOM',type:'weekly_bottom',stage:'AT_BOTTOM'}),earlyRow({symbol:'HOT',ret63:0.6}),earlyRow({symbol:'MEGA',mcap:30e9}),earlyRow({symbol:'THEME',storySignals:{},themes:['AI']}),earlyRow({symbol:'PARTIAL',type:'weekly_bottom',stage:'TURNING',higherLow:true,aboveMa:true,provisional:true}),earlyRow({symbol:'OLD',narrative:{quality:{growthFresh:false,profitFresh:false}}})];
 const data={asOf:'2026-10-14',candidates:rows};assert.deepEqual(storyPicks(data).map(p=>p.row.symbol),['EARLY']);assert.deepEqual(storyPicks(data,8,'watch').map(p=>p.row.symbol),['BOTTOM','PARTIAL']);
});
test('structured signals prevent loss-narrowing and profit-turnaround being claimed together from old text',()=>{
 const r=earlyRow({storySignals:{revenueAcceleration:false,profitTurnaround:true,lossNarrowing:false},narrative:{...earlyRow().narrative,lines:['지난해 적자가 70% 줄었습니다. 현재 흑자.']}});const d=storyPicks({asOf:'2026-10-14',candidates:[r]});assert.ok(d[0].why.includes('흑자 전환'));assert.ok(!d[0].why.includes('적자지만 개선 중'));
});

test('a short squeeze from a depressed level and stale last prints cannot masquerade as early accumulation',()=>{
 const data={asOf:'2026-10-14',candidates:[earlyRow({symbol:'GAP',ret1:0.3,ret5:0.1,ret21:-0.1}),earlyRow({symbol:'HALT',priceAsOf:'2026-10-09'})]};assert.equal(storyPicks(data).length,0);
});

test('holding-company reported profit is not an operating growth inflection without NAV review',()=>{assert.equal(storyPicks({asOf:'2026-10-14',candidates:[earlyRow({symbol:'CNNE'})]}).length,0);});
