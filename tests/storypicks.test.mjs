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

const earlyRow=(o={})=>row({type:'breakout',stage:'BREAKOUT',priceAsOf:'2026-10-14',ret1:0.02,ret5:0.08,ret63:0.18,ret21:0.08,storySignals:{revenueAcceleration:true,profitTurnaround:false,lossNarrowing:false},reasons:[{kind:'plus',text:'매출 성장 가속',pts:20}],revenueYoY:[{end:'2026-03-31',yoy:0.1},{end:'2026-06-30',yoy:0.25}],narrative:{lines:[],takeaway:'t',method:'m',quality:{growthBlocked:false,profitBlocked:false,growthFresh:true,profitFresh:true,revenuePeriod:'2026-06-30',profitPeriod:'2026-06-30'}},...o});
test('default discovery separates early turns from pullbacks, unconfirmed bottoms, themes and extended rallies',()=>{
 const rows=[earlyRow({symbol:'EARLY'}),earlyRow({symbol:'PULL',type:'pullback',stage:'BOUNCE'}),earlyRow({symbol:'BOTTOM',type:'weekly_bottom',stage:'AT_BOTTOM'}),earlyRow({symbol:'HOT',ret63:0.6}),earlyRow({symbol:'MEGA',mcap:30e9}),earlyRow({symbol:'THEME',storySignals:{},revenueYoY:[],themes:['AI']}),earlyRow({symbol:'PARTIAL',type:'weekly_bottom',stage:'TURNING',higherLow:true,aboveMa:true,provisional:true}),earlyRow({symbol:'OLD',revenueYoY:[{end:'2025-06-30',yoy:0.1},{end:'2025-09-30',yoy:0.25}],narrative:{quality:{growthFresh:false,profitFresh:false}}})];
 const data={asOf:'2026-10-14',candidates:rows};assert.deepEqual(storyPicks(data).map(p=>p.row.symbol),['EARLY']);assert.deepEqual(storyPicks(data,8,'watch').map(p=>p.row.symbol),['BOTTOM','PARTIAL']);
});
test('structured signals prevent loss-narrowing and profit-turnaround being claimed together from old text',()=>{
 const r=earlyRow({storySignals:{revenueAcceleration:false,profitTurnaround:true,lossNarrowing:false},narrative:{...earlyRow().narrative,lines:['지난해 적자가 70% 줄었습니다. 현재 흑자.']}});const d=storyPicks({asOf:'2026-10-14',candidates:[r]});assert.ok(d[0].why.includes('흑자 전환'));assert.ok(!d[0].why.includes('적자지만 개선 중'));
});

test('a short squeeze from a depressed level and stale last prints cannot masquerade as early accumulation',()=>{
 const data={asOf:'2026-10-14',candidates:[earlyRow({symbol:'GAP',ret1:0.3,ret5:0.1,ret21:-0.1}),earlyRow({symbol:'HALT',priceAsOf:'2026-10-09'})]};assert.equal(storyPicks(data).length,0);
});

test('holding-company reported profit is not an operating growth inflection without NAV review',()=>{assert.equal(storyPicks({asOf:'2026-10-14',candidates:[earlyRow({symbol:'CNNE'})]}).length,0);});

test('asset-pivot tab: loss-making company with a large contract and funded build-out passes; buyouts and thin cash do not', async () => {
  const { earlyIssues } = await import('../apps/web/src/lib/storyPicks.ts');
  const pv = { pivot: true, newsChecked: true, material: 1, contracts: [{ date: '2026-10-01', headline: 'Signs $1.5 billion AI cloud contract', url: null, amount: 1.5e9, ratio: 0.5 }], financing: [], acquisition: null, capex: { ttm: 150e6, prior: 40e6, growth: 3.75, toRevenue: 0.75, end: '2026-06-30' }, investmentPhase: true, fundedMonths: 33, selfFunded: false };
  const ok = row({ symbol: 'PIV', type: 'breakout', stage: 'NEAR_PIVOT', priceAsOf: '2026-10-14', ret1: 0.01, ret5: 0.03, ret21: 0.05, ret63: 0.1, assetPivot: pv,
    narrative: { lines: ['적자가 커졌습니다'], takeaway: 't', method: 'm' } });
  assert.deepEqual(earlyIssues(ok, '2026-10-14', 'pivot'), []);
  assert.ok(earlyIssues(ok, '2026-10-14', 'early').some((i) => /매출 가속/.test(i)), 'the plain early-turn list still needs reported sales acceleration');
  const picks = storyPicks({ asOf: '2026-10-14', candidates: [ok] }, 8, 'pivot');
  assert.equal(picks[0]?.row.symbol, 'PIV');
  assert.ok(picks[0].why.some((w) => /대형 계약/.test(w)));
  assert.ok(earlyIssues({ ...ok, assetPivot: { ...pv, fundedMonths: 9 } }, '2026-10-14', 'pivot').includes('설비투자 포함 현금 18개월 미만·미확인'));
  assert.ok(earlyIssues({ ...ok, assetPivot: { ...pv, pivot: false, acquisition: { headline: 'to be acquired' } } }, '2026-10-14', 'pivot').includes('인수·합병 기사 — 사업 전환 아님'));
  assert.ok(earlyIssues({ ...ok, ret63: 0.8 }, '2026-10-14', 'pivot').includes('63일 +35%·21일 +20% 초과'), 'no chasing after the move');
});

test('earnings inside 5 sessions holds the entry; an unchecked calendar is not read as "no earnings"', async () => {
  const { earlyIssues } = await import('../apps/web/src/lib/storyPicks.ts');
  const base = row({ symbol: 'E', type: 'breakout', stage: 'NEAR_PIVOT', priceAsOf: '2026-10-14', ret1: 0.01, ret5: 0.02, ret21: 0.05, ret63: 0.1 });
  assert.ok(earlyIssues({ ...base, earningsChecked: true, earnings: { date: '2026-10-16', hour: 'amc', sessions: 2 } }, '2026-10-14', 'early').some((i) => /실적 발표 2거래일 앞/.test(i)));
  assert.ok(!earlyIssues({ ...base, earningsChecked: true, earnings: { date: '2026-11-05', hour: '', sessions: 16 } }, '2026-10-14', 'early').some((i) => /실적 발표/.test(i)));
  assert.ok(earlyIssues({ ...base, earningsChecked: false, earnings: null }, '2026-10-14', 'early').includes('실적 발표일 미확인'));
  assert.ok(!earlyIssues({ ...base, earningsChecked: false }, '2026-10-14', 'legacy').includes('실적 발표일 미확인'), 'legacy list is unchanged');
});

test('insider buying cluster lifts a pick; a fresh offering is flagged', () => {
  const data = { asOf: '2026-10-14', candidates: [
    row({ symbol: 'INS', reasons: [{ kind: 'plus', text: '흑자 전환', pts: 25 }], edge: { checkedAt: '2026-10-14T00:00:00Z', insider: { days: 90, buyers: 3, buyValue: 400000, sellValue: 0, cluster: true, recent: [] }, dilution: { days: 180, count: 0, shelf: false, offering: false, recent: [] }, analyst: null, errors: [] } }),
    row({ symbol: 'DIL', chartScore: 75, reasons: [{ kind: 'plus', text: '흑자 전환', pts: 25 }], edge: { checkedAt: '2026-10-14T00:00:00Z', insider: null, dilution: { days: 180, count: 1, shelf: false, offering: true, recent: [{ form: '424B5', date: '2026-10-01', url: null }] }, analyst: null, errors: [] } }),
  ] };
  const picks = storyPicks(data, 8, 'legacy');
  assert.equal(picks[0].row.symbol, 'INS');
  assert.ok(picks[0].why.some((w) => /내부자 매수 3명/.test(w)));
  assert.ok(picks.find((p) => p.row.symbol === 'DIL').why.includes('⚠ 최근 발행 공시(424B)'));
});

test('early turns use the validated sales-acceleration rule; income-only improvement and dilution filings are excluded',async()=>{
 const { earlyIssues } = await import('../packages/analysis/discovery-rules.mjs');
 assert.deepEqual(earlyIssues(earlyRow({symbol:'OK',earningsChecked:true,earnings:null}),'2026-10-14','early'),[]);
 // looser than the old 15%+ multi-quarter rule: 6% → 9% counts
 assert.deepEqual(earlyIssues(earlyRow({symbol:'MILD',earningsChecked:true,earnings:null,revenueYoY:[{end:'2026-03-31',yoy:0.06},{end:'2026-06-30',yoy:0.09}]}),'2026-10-14','early'),[]);
 const niOnly=earlyRow({earningsChecked:true,earnings:null,revenueYoY:[{end:'2026-03-31',yoy:0.2},{end:'2026-06-30',yoy:0.15}],netIncomeQ:[{end:'2025-06-30',value:-5e6},{end:'2026-06-30',value:-1e6}]});
 assert.ok(earlyIssues(niOnly,'2026-10-14','early').some((i)=>/이익 개선만 · 매출 가속 없음/.test(i)));
 const dil=(d)=>earlyIssues(earlyRow({earningsChecked:true,earnings:null,edge:{dilution:{days:180,count:1,recent:[],...d}}}),'2026-10-14','early');
 assert.ok(dil({offering:true,shelf:false}).some((i)=>/424B.*-8\.4%p/.test(i)));
 assert.ok(dil({offering:false,shelf:true}).some((i)=>/S-3.*-8\.9%p/.test(i)));
 assert.deepEqual(dil({offering:false,shelf:false,likelyDebt:true}),[]);
});
