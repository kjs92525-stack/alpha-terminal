// Falsifiable, data-checked conditions for a discovery candidate: what must be true to move it
// from "watch" to "review", and what drops it. Unknown values stay unknown (never counted as met
// or as safe). These are screening rules over reported numbers and prices, not a buy signal.
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const DAY = 86400000;
const usd = (v) => `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1e6).toFixed(1)}M`;
const TURN = new Set(['BREAKOUT', 'POST_BREAKOUT', 'NEAR_PIVOT', 'TURNING']);
const STAGE_KO = { BREAKOUT: '오늘 돌파', POST_BREAKOUT: '돌파 후 눌림', NEAR_PIVOT: '돌파 임박', TURNING: '전환 시작', AT_BOTTOM: '바닥권', IN_BASE: '바닥 다지는 중', BOUNCE: '지지 반등', AT_SUPPORT: '지지 테스트', APPROACHING: '지지 접근', EXTENDED: '추격 금지', FAILED: '돌파 실패' };

/** Same calendar quarter one year earlier (±25 days), from a [{end,value}] list. */
function yearAgo(list, end) {
  const t = Date.parse(end) - 365 * DAY;
  return list.find((q) => Math.abs(Date.parse(q.end) - t) <= 25 * DAY) ?? null;
}

export function thesisChecks(row, asOf) {
  const q = row?.narrative?.quality ?? {};
  const rev = (row?.revenueYoY ?? []).filter((x) => finite(x?.yoy) && x.end <= asOf);
  const ni = (row?.netIncomeQ ?? []).filter((x) => finite(x?.value) && x.end <= asOf);
  const fresh = (end) => Boolean(end) && Date.parse(asOf) - Date.parse(end) <= 200 * DAY && Date.parse(end) <= Date.parse(asOf);
  const lastRev = rev.at(-1), prevRev = rev.at(-2), lastNi = ni.at(-1), agoNi = lastNi ? yearAgo(ni, lastNi.end) : null;
  const plan = row?.plan, f = row?.funding ?? {};
  const pivot = row?.assetPivot ?? null, build = Boolean(pivot?.investmentPhase && pivot.capex);
  const item = (label, met, observed) => ({ label, met, observed });

  const promote = [
    item('최근 분기 매출 성장 유지·가속 (YoY 15% 이상이거나 직전 분기보다 빨라짐)',
      lastRev && fresh(lastRev.end) && !q.growthBlocked ? lastRev.yoy >= 0.15 || (prevRev ? lastRev.yoy > prevRev.yoy : false) : null,
      lastRev ? `${lastRev.end} 매출 YoY ${pct(lastRev.yoy)}${prevRev ? ` (직전 ${pct(prevRev.yoy)})` : ''}${fresh(lastRev.end) ? '' : ' · 200일 초과'}` : '분기 매출 자료 없음'),
    item('순이익이 1년 전 같은 분기보다 개선 (적자 축소 또는 흑자)',
      lastNi && agoNi && fresh(lastNi.end) && !q.profitBlocked ? lastNi.value > agoNi.value : null,
      lastNi && agoNi ? `${lastNi.end} 순이익 ${usd(lastNi.value)} (1년 전 ${usd(agoNi.value)})` : '비교할 분기 순이익 없음'),
    item('가격이 바닥 전환·돌파 단계 (진행 중인 봉 제외)',
      row?.stage ? TURN.has(row.stage) && !row.provisional : null, `${row?.stage ? STAGE_KO[row.stage] ?? row.stage : '단계 미확인'}${row?.provisional ? ' · 진행 중인 봉의 잠정 신호' : ''}`),
    item('손절 폭 15% 이하, 목표까지 손절 폭의 1.5배 이상',
      plan && finite(plan.riskPct) && finite(plan.rMultiple) ? plan.riskPct <= 0.15 && plan.rMultiple >= 1.5 : null,
      plan && finite(plan.riskPct) ? `손절 폭 ${(plan.riskPct * 100).toFixed(0)}% · ${finite(plan.rMultiple) ? plan.rMultiple.toFixed(1) : '—'}R` : '매수 계획 없음'),
  ];
  const drop = [
    item('종가가 무효화 가격 아래', plan && finite(plan.stop) && finite(row?.price) ? row.price < plan.stop : null,
      plan && finite(plan.stop) ? `종가 $${finite(row?.price) ? row.price.toFixed(2) : "—"} · 무효화 $${plan.stop.toFixed(2)}` : '무효화 가격 없음'),
    item('매출이 역성장으로 돌아섰거나 직전 분기보다 10%p 넘게 둔화',
      lastRev && fresh(lastRev.end) ? lastRev.yoy < 0 || (prevRev ? prevRev.yoy - lastRev.yoy > 0.1 : false) : null,
      lastRev ? `매출 YoY ${pct(lastRev.yoy)}${prevRev ? ` ← ${pct(prevRev.yoy)}` : ''}` : '분기 매출 자료 없음'),
    // a build-out (capex at least doubled) widens losses by design: judge it on cash and dilution instead
    item(build ? '적자 확대 — 설비 투자 확대기라 아래 현금·희석 기준으로 대신 판단' : '적자가 1년 전 같은 분기보다 커짐',
      build ? false : lastNi && agoNi && fresh(lastNi.end) ? lastNi.value < 0 && lastNi.value < agoNi.value : null,
      `${lastNi && agoNi ? `순이익 ${usd(lastNi.value)} ← ${usd(agoNi.value)}` : '비교할 분기 순이익 없음'}${build ? ` · 설비투자 1년 ${usd(pivot.capex.ttm)}${finite(pivot.capex.prior) ? ` (1년 전 ${usd(pivot.capex.prior)})` : ''}` : ''}`),
    item('주식 수가 1년 새 15% 넘게 늘어남 (희석)', finite(f.sharesYoY) ? f.sharesYoY > 0.15 : null, finite(f.sharesYoY) ? `주식 수 ${pct(f.sharesYoY)}` : '최근 주식 수 변화 미확인'),
    build
      ? item('설비투자까지 포함해 현금으로 버틸 기간 18개월 미만', pivot.selfFunded ? false : finite(pivot.fundedMonths) ? pivot.fundedMonths < 18 : null,
        pivot.selfFunded ? '영업현금으로 설비투자를 충당 중' : finite(pivot.fundedMonths) ? `약 ${pivot.fundedMonths}개월 (영업현금 − 설비투자 기준)` : '현금·설비투자 자료 미확인')
      : item('현금으로 버틸 기간 12개월 미만', finite(f.runwayMonths) ? f.runwayMonths < 12 : null, finite(f.runwayMonths) ? `약 ${f.runwayMonths.toFixed(0)}개월` : '런웨이 미확인 (흑자이거나 자료 없음)'),
  ];
  const state = drop.some((d) => d.met === true) ? 'drop' : promote.every((p) => p.met === true) ? 'review' : 'watch';
  const unknown = [...promote, ...drop].filter((x) => x.met === null).length;
  // next reported quarter is due roughly 45 days after the following quarter ends
  const next = lastRev ?? lastNi;
  const nextDue = next ? new Date(Date.parse(next.end) + (91 + 45) * DAY).toISOString().slice(0, 10) : null;
  return { state, promote, drop, unknown, nextDue };
}
