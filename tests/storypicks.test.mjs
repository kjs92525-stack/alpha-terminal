import test from 'node:test';
import assert from 'node:assert/strict';
import { storyPicks, buildStoryPrompt } from '../apps/web/src/lib/storyPicks.ts';

const row = (o) => ({
  type: 'pullback', symbol: 'X', name: 'X Corp', sector: 'Information Technology', price: 10, mcap: 1e9, adv20: 5e6, stage: 'BOUNCE',
  plan: { entry: 10.2, stop: 9.5, stopKind: '눌림 저점 아래', target: 12, riskPct: 0.07, rMultiple: 2.6, note: null, how: '다음 거래일 오늘 고가 $10.20 위에서 매수 · 손절 $9.50' },
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
  ] };
  const picks = storyPicks(data);
  assert.deepEqual(picks.map((p) => p.symbol ?? p.row.symbol), ['TURN', 'THEME']);
  assert.ok(picks[0].why.includes('적자지만 개선 중') && picks[0].why.includes('시장은 의심 중'));
});

test('story prompt carries the setup, buy point, numbers, headlines and the analysis checklist', () => {
  const r = row({ symbol: 'ACME', news: [{ time: '2026-10-08T12:00:00Z', headline: 'ACME wins Army contract' }], narrative: { lines: ['매출 가속'], takeaway: '개선 중', method: 'm' } });
  const p = buildStoryPrompt(r, '2026-10-12');
  for (const s of ['ACME', '눌림목', '지지 반등', '오늘 고가 $10.20', '손절 $9.50 (-7.0%)', '2.6R', 'ACME wins Army contract', '→ 개선 중', '시장이 의심하는 이유', '반대 논리', '출처']) assert.ok(p.includes(s), s);
});
