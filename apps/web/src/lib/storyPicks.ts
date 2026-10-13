// "스토리 확인 추천": scanner candidates whose chart is at a buy area AND whose numbers or news
// hint at a story worth checking (turnaround, accelerating growth, doubted while improving,
// sudden attention, theme). Pure ranking over setups.json — no extra data or API calls.

import type { SetupRow, SetupType, Setups } from './snapshot';

export const TYPE_KO: Record<SetupType, string> = { breakout: '바닥 돌파', pullback: '눌림목', weekly_bottom: '주봉 바닥', monthly_bottom: '월봉 바닥' };
export const STAGE_KO: Record<string, string> = {
  BREAKOUT: '오늘 돌파', POST_BREAKOUT: '돌파 후 눌림', NEAR_PIVOT: '돌파 임박', BOUNCE: '지지 반등', AT_SUPPORT: '지지 테스트',
  APPROACHING: '지지 접근', TURNING: '전환 시작', AT_BOTTOM: '바닥권', EXTENDED: '추격 금지', FAILED: '돌파 실패', IN_BASE: '바닥 형성 중', NONE: '—',
};
const BUY_AREA = new Set(['BREAKOUT', 'POST_BREAKOUT', 'NEAR_PIVOT', 'BOUNCE', 'AT_SUPPORT', 'TURNING', 'AT_BOTTOM']);

export interface StoryPick { row: SetupRow; priority: number; why: string[]; hook: string }

export function storyPicks(data: Setups | null, limit = 8): StoryPick[] {
  if (!data) return [];
  const best = new Map<string, StoryPick>();
  for (const row of data.candidates) {
    if (!BUY_AREA.has(row.stage) || !row.plan || row.plan.riskPct == null || row.plan.riskPct > 0.15) continue;
    const text = row.reasons.map((r) => r.text).join(' ');
    const why: string[] = [];
    let bonus = 0;
    const loss = /아직 적자|적자 상태/.test(row.narrative?.lines.join(' ') ?? '');
    const accel = /가속/.test(text);
    const turned = /흑자 전환/.test(text);
    const narrowing = /축소/.test(text) || /적자가 \d+% 줄었/.test(row.narrative?.lines.join(' ') ?? '');
    const doubted = /의심/.test(text);
    const surge = /관심 급증/.test(text);
    if (loss && (narrowing || accel)) { why.push('적자지만 개선 중'); bonus += 15; }
    if (turned) { why.push('흑자 전환'); bonus += 12; }
    if (accel) { why.push('매출 성장 가속'); bonus += 8; }
    if (doubted) { why.push('시장은 의심 중'); bonus += 10; }
    if (surge) { why.push('뉴스 관심 급증'); bonus += 5; }
    if (row.themes.length) { why.push(`테마: ${row.themes.join('·')}`); bonus += 4; }
    const penalty = row.reasons.filter((r) => r.kind === 'minus').reduce((s, r) => s + Math.abs(r.pts), 0) * 0.5;
    if (!why.length) continue; // nothing story-like: chart only
    const priority = Math.round(row.chartScore * 0.4 + row.storyScore * 0.6 + bonus - penalty);
    const hook = `${TYPE_KO[row.type ?? 'breakout']} · ${STAGE_KO[row.stage] ?? row.stage}`;
    const prev = best.get(row.symbol);
    if (!prev || priority > prev.priority) best.set(row.symbol, { row, priority, why, hook });
  }
  return [...best.values()].sort((a, b) => b.priority - a.priority).slice(0, limit);
}

const money = (v: number | null | undefined) => (v == null ? '—' : `$${v >= 1000 ? v.toFixed(0) : v.toFixed(2)}`);

/** Ready-to-paste prompt for a deep story check in the Claude chat. */
export function buildStoryPrompt(row: SetupRow, asOf: string): string {
  const p = row.plan;
  const news = row.news.slice(0, 5).map((n) => `- ${n.time.slice(0, 10)} ${n.headline}`).join('\n') || '- (수집된 뉴스 없음)';
  const lines = row.narrative ? [...row.narrative.lines, `→ ${row.narrative.takeaway}`].join('\n') : '(실적 데이터 없음)';
  return `${STORY_PROMPT_HEAD}

[종목] ${row.symbol} (${row.name ?? ''}) · ${row.sector}
[기준일] ${asOf} · 종가 ${money(row.price)}
[차트 셋업] ${TYPE_KO[row.type ?? 'breakout']} / ${STAGE_KO[row.stage] ?? row.stage}
[매수타점] ${p?.how ?? '—'}
[손절·목표] 손절 ${money(p?.stop)} (${p?.riskPct != null ? `-${(p.riskPct * 100).toFixed(1)}%` : '—'}) · 목표 ${money(p?.target)} · 손익비 ${p?.rMultiple != null ? p.rMultiple.toFixed(1) : '—'}R
[자동 요약 — 숫자 기반]
${lines}
[최근 뉴스 제목]
${news}
[자동 점수] 차트 ${row.chartScore}/100 · 스토리 ${row.storyScore}/100

${STORY_PROMPT_TASKS}`;
}

export const STORY_PROMPT_HEAD = `너는 미국 성장주를 오래 본 애널리스트야. 아래 종목에 '숫자에 아직 다 반영되지 않은 스토리'가 진짜 있는지 검증해줘.
과장하지 말고, 사실과 의견을 구분하고, 모든 사실에는 출처와 날짜를 붙여. 최신 정보는 웹에서 직접 확인해.`;

export const STORY_PROMPT_TASKS = `다음 순서로 한국어로, 쉬운 말로 정리해줘:
1. 한 줄 결론 — "매수 검토 / 관찰 / 패스" 중 하나와 이유 한 문장
2. 이 회사가 돈을 버는 방법 (3줄)
3. 시장이 의심하는 이유 — 공매도 리포트, 부정 기사, 밸류에이션, 경쟁, 소송 등 (출처)
4. 실제로 바뀌고 있는 것 — 최근 2~4분기 매출·이익·현금 숫자, 신규 계약·고객·제품 (출처·날짜)
5. 앞으로 3~6개월 촉매 — 실적 발표일, 승인, 계약, 출시 일정 (날짜)
6. 반대 논리 — 이 스토리가 틀릴 수 있는 이유 3가지와, 틀렸다는 걸 알려줄 신호
7. 희석·현금·부채 위험 — 유상증자, 전환사채, 남은 현금으로 버틸 기간
8. 매수타점 점검 — 위 진입·손절이 합리적인지, 더 나은 자리가 있는지
9. 매수 전 체크리스트 3~5개
규칙: 모르는 건 모른다고 써. 추측은 "추정"이라고 표시해. 투자 권유가 아니라 검토 자료로 써.`;
