// "오늘 볼 종목": one short list built only from names that pass the shared discovery rules, each
// with a transparent point count and a tier. Points are evidence weights, not a forecast; the
// market regime caps the tier because a good stock in a bad tape still loses more often.
import { earlyIssues } from '../../../../packages/analysis/discovery-rules.mjs';
import { thesisChecks } from '../../../../packages/analysis/thesis-checks.mjs';
import type { SetupRow, Setups } from './snapshot';

export type Tier = 'A' | 'B' | 'C';
export type Gate = 'SELECTIVE' | 'LIMIT' | 'WAIT' | 'UNKNOWN';
export interface Conviction { row: SetupRow; mode: 'early' | 'pivot' | 'watch'; points: number; tier: Tier; plus: string[]; minus: string[]; capped: string | null }

export function scoreConviction(row: SetupRow, asOf: string, mode: Conviction['mode'], gate: Gate): Conviction {
  const plus: string[] = [], minus: string[] = [];
  let pts = 0;
  const add = (n: number, why: string) => { pts += n; (n >= 0 ? plus : minus).push(why); };
  const t = thesisChecks(row, asOf);
  if (t.state === 'review') add(30, '검토 승격 조건 모두 충족');
  if (t.state === 'drop') add(-40, '탈락 조건 해당');
  if (mode === 'early') add(10, '실적 개선 + 전환·돌파 동시 충족');
  if (mode === 'pivot') add(10, '대형 계약·설비 확장 근거');
  if (mode === 'watch') add(-10, '아직 바닥 관찰 단계');
  if (row.edge?.insider?.cluster) add(20, `내부자 ${row.edge.insider.buyers}명 장내 매수`);
  if (row.edge?.dilution?.offering) add(-20, '최근 발행 공시(424B)');
  else if (row.edge?.dilution?.shelf) add(-5, '증자 대기 등록(S-3)');
  if (row.trend && row.trend.total > 0 && row.trend.passed / row.trend.total >= 0.75) add(10, `추세 템플릿 ${row.trend.passed}/${row.trend.total}`);
  if (row.rs?.newHigh) add(5, '상대강도 신고가');
  if (row.edge?.analyst?.direction === 'up') add(5, '애널리스트 매수 의견 증가');
  if (row.edge?.analyst?.direction === 'down') add(-5, '애널리스트 매수 의견 감소');
  if (row.plan?.rMultiple != null && row.plan.rMultiple >= 3) add(5, `손익비 ${row.plan.rMultiple.toFixed(1)}`);
  let tier: Tier = pts >= 50 ? 'A' : pts >= 30 ? 'B' : 'C';
  let capped: string | null = null;
  if (gate === 'WAIT' || gate === 'UNKNOWN') { if (tier !== 'C') capped = gate === 'WAIT' ? '시장 진입 대기 — 관찰용으로 낮춤' : '시장 상태 미확인 — 관찰용으로 낮춤'; tier = 'C'; }
  else if (gate === 'LIMIT' && tier === 'A') { tier = 'B'; capped = '제한적 진입 시장 — 한 단계 낮춤'; }
  return { row, mode, points: pts, tier, plus, minus, capped };
}

/** Up to `limit` names: early/pivot passers first; watch-list names only fill in, always tier C. */
export function topConviction(data: Setups | null, gate: Gate, limit = 5): Conviction[] {
  if (!data) return [];
  const best = new Map<string, Conviction>();
  for (const mode of ['early', 'pivot', 'watch'] as const) for (const row of data.candidates) {
    if (earlyIssues(row, data.asOf, mode).length) continue;
    const c = scoreConviction(row, data.asOf, mode, gate);
    if (mode === 'watch') c.tier = 'C';
    const prev = best.get(row.symbol);
    if (!prev || c.points > prev.points) best.set(row.symbol, c);
  }
  const order = { A: 0, B: 1, C: 2 };
  return [...best.values()].sort((a, b) => order[a.tier] - order[b.tier] || b.points - a.points).slice(0, limit);
}
