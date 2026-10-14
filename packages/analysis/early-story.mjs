import { EARLY_CONTEXT } from './early-context.mjs';
const day = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? Date.parse(`${date}T00:00:00Z`) : NaN;
const publicEvidence = (row, asOf) => (row.evidence ?? []).filter((e) => Number.isFinite(day(e.publishedAt?.slice(0, 10))) && day(e.publishedAt.slice(0, 10)) <= day(asOf) && (!e.period || day(e.period) <= day(asOf)));
export function representativeEvidence(row, asOf) {
  const sorted = publicEvidence(row, asOf).sort((a, b) => (b.period || b.publishedAt).localeCompare(a.period || a.publishedAt));
  const seen = new Set(); const counts = new Map();
  return sorted.filter((e) => {
    const key = JSON.stringify([e.kind, e.period, e.value, e.url, e.kind === 'financial' ? '' : e.title]);
    if (seen.has(key)) return false;
    seen.add(key);
    const group = `${e.kind}:${e.title}`;
    const count = counts.get(group) ?? 0;
    counts.set(group, count + 1);
    return e.kind !== 'financial' || count < 2;
  });
}
export function buildEarlyStory(row, asOf) {
  const context = EARLY_CONTEXT[row.ticker];
  const evidence = publicEvidence(row, asOf);
  // Published evidence, never review date, controls historical visibility. A later
  // financial disclosure or 120-day lag requires another editorial review.
  const newerReport = evidence.some((e) => e.kind === 'financial' && e.publishedAt.slice(0, 10) > context?.reviewedAt);
  const fresh = context && day(context.publishedAt) <= day(asOf) && day(asOf) - day(context.publishedAt) <= 120 * 86400000 && !newerReport;
  const reasons = (row.reasons ?? []).filter((r) => r.points > 0);
  const growth = reasons.find((r) => r.factor === 'growth');
  const profit = reasons.find((r) => r.factor === 'profitability');
  const catalyst = evidence.find((e) => e.confidence === 'headline_only');
  const fallback = {
    title: profit ? '매출의 변화가 이익으로 이어지는지 볼 회사' : growth ? '성장 신호의 배경을 더 확인할 회사' : '아직 재평가 이야기를 뒷받침할 근거가 부족합니다',
    business: `${row.name}의 자동 발굴 자료를 요약했습니다. 구체적인 고객·제품·산업 수요와의 연결은 아직 원문 검증이 필요합니다.`,
    change: [growth ? `${growth.text}.` : '확인 가능한 매출 성장 신호가 부족합니다.', profit ? `${profit.text}.` : '지속적인 수익성 개선은 아직 확인되지 않았습니다.'].join(' '),
    thesis: profit ? '성장과 수익성 개선이 반복된다면 기업을 평가하는 이익 기준이 달라질 여지가 있습니다. 다만 일회성 수익인지, 실제 사업의 반복 이익인지는 수치만으로 구분할 수 없습니다.' : '매출 증가가 반복 주문과 현금 창출로 이어질 때 재평가 가설이 강해집니다. 현재 자료만으로는 그 사업 동력을 확정할 수 없습니다.',
    next: catalyst ? `관련 뉴스 제목은 “${catalyst.title}”입니다. 제목만 수집된 자료이므로 계약의 구속력·금액·납기와 실제 매출 반영을 원문에서 확인해야 합니다.` : '다음 실적의 반복 매출, 매출 증가 원인, 영업현금흐름과 자금 조달 조건을 확인해야 합니다. 확인되지 않은 전쟁·정책 수혜를 연결하지 않습니다.',
    risk: '새 계약·산업 수요·일회성 효과의 원문 검증 전에는 사업 스토리를 확정할 수 없습니다.',
    sources: [],
  };
  const story = fresh ? context : fallback;
  const funding = row.risk?.level === 'high' ? '희석 위험 신호가 있습니다. 발행 규모와 조건을 먼저 확인해야 합니다.' : !row.risk?.checked || row.risk?.level === 'unknown' ? '증자·워런트·전환사채 검증이 불완전합니다. 위험이 없다는 뜻이 아닙니다.' : '주식 수 변화와 추가 자금 조달 조건은 원문 확인이 필요합니다.';
  return { ...story, reviewed: Boolean(fresh), stale: Boolean(context && !fresh && day(context.publishedAt) <= day(asOf)), funding, status: row.status === 'excluded' ? '현재 발굴 기준에서 제외된 종목입니다.' : row.status === 'watch' ? '사업 스토리가 있어도 현재는 관찰·검증 대기 종목입니다.' : '재평가 후보이며 사업 가설의 추가 확인이 필요합니다.' };
}
