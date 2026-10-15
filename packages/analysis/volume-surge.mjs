// Volume surges with their likely cause. Volume says that something changed, not what or in
// which direction: the cause comes from dated headlines/filings around the surge day, and when
// none is found it stays "unexplained" rather than being guessed from the price move.
const DAY = 86400000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// minPriorDollarVolume keeps out shells whose normal trading is so thin that any print is a "1000x" surge
export const SURGE_RULES = { minMult: 3, minDollarVolume: 10e6, minPrice: 2, minPriorDollarVolume: 2e6, lookbackDays: 50, recentSessions: 3 };

/** Latest session (within the last few) whose volume is minMult× the prior 50-session average. */
export function detectVolumeSurge(bars, rules = SURGE_RULES) {
  const n = bars?.length ?? 0;
  if (n < rules.lookbackDays + 60) return null;
  for (let i = n - 1; i >= n - rules.recentSessions; i--) {
    const prior = bars.slice(i - rules.lookbackDays, i);
    const avg = mean(prior.map((b) => b.volume));
    const b = bars[i];
    const priorDollar = mean(prior.map((x) => x.close * x.volume));
    if (!(avg > 0) || b.volume / avg < rules.minMult || b.close < rules.minPrice || b.close * b.volume < rules.minDollarVolume || !(priorDollar >= rules.minPriorDollarVolume)) continue;
    const prev = bars[i - 1].close;
    const yearAgo = bars.slice(Math.max(0, i - 252), i);
    const hi = Math.max(...yearAgo.map((x) => x.high)), lo = Math.min(...yearAgo.map((x) => x.low));
    const ret63 = i >= 63 ? prev / bars[i - 63].close - 1 : null;
    const range = b.high - b.low;
    const closePos = range > 0 ? (b.close - b.low) / range : 0.5;
    const ret1 = b.close / prev - 1;
    // where the surge happened: a run-up already behind it reads differently from a turn off a low
    const context = ret63 !== null && ret63 > 0.5 ? 'after_run'
      : b.close >= hi * 0.98 ? 'new_high'
      : b.close <= lo * 1.25 ? 'near_low'
      : ret63 !== null && ret63 < -0.25 ? 'downtrend' : 'mid_range';
    return {
      date: new Date(b.time * 1000).toISOString().slice(0, 10), sessionsAgo: n - 1 - i,
      volMult: Math.round((b.volume / avg) * 10) / 10, dollarVolume: Math.round(b.close * b.volume), priorDollarVolume: Math.round(priorDollar), close: b.close, ret1, gap: b.open / prev - 1,
      closePos, ret63, fromHigh: b.close / hi - 1, fromLow: b.close / lo - 1, context,
      after: i < n - 1 ? bars[n - 1].close / b.close - 1 : 0,
    };
  }
  return null;
}

const CAUSES = [
  ['acquisition', '인수·합병', /\b(to acquire|acquired by|acquisition|merger|to be acquired|take[- ]private|buyout|tender offer)\b/i],
  ['financing', '증자·자금 조달', /\b(offering|convertible|private placement|at-the-market|registered direct|notes due|priced|raises? \$)/i],
  ['insider', '내부자 매수', /\b(form ?4|insiders?|ceo|cfo|director|chairman|officer)\b.{0,60}\b(buys?|bought|acquires?|purchases?d?|adds?)\b/i],
  ['earnings', '실적·전망', /\b(earnings|results|quarter|q[1-4]\b|revenue|guidance|outlook|eps|profit|loss)\b/i],
  ['regulatory', 'FDA·임상·승인', /\b(fda|approval|approves|clinical|trial|phase [123i]+|data readout|clearance|ema)\b/i],
  ['contract', '계약·수주·제휴', /\b(contract|agreement|award(?:ed|s)?|orders?|partnership|collaborat\w+|lease|deal|selected by)\b/i],
  ['index', '지수 편입·변경', /\b(s&p (?:500|400|600)|russell|index|added to|join(?:s|ing)? the)\b/i],
  ['analyst', '애널리스트 의견', /\b(upgrade[sd]?|downgrade[sd]?|price target|initiates?|reiterate[sd]?|overweight|underweight|outperform)\b/i],
  ['legal', '소송·조사·규제 위험', /\b(lawsuit|sec investigation|subpoena|probe|class action|fraud|short seller|short report|delist\w*)\b/i],
  ['split', '주식 분할·병합', /\b(reverse split|stock split|split)\b/i],
];
export const CAUSE_KO = Object.fromEntries([...CAUSES.map(([k, ko]) => [k, ko]), ['unexplained', '확인된 이유 없음']]);

// market-wrap / "why is X moving" headlines name no cause; they are listed last and never classify
const ROUNDUP = /(^(nasdaq|dow|s&p 500|u\.?s\.? stocks|stocks|wall street)\b.{0,40}\b(dips?|jumps?|falls?|rises?|slides?|surges?|tumbles?|gains?|climbs?|drops?|edges?)\b|\bstocks? moving\b|\bmovers?\b|\btop (gainers|losers)\b|^why (is|are) .{0,60}\b(stock|shares)\b|\bwhat'?s going on with\b|\b(mid-?day|pre-?market|after-?hours?) (session|movers|update)\b)/i;
export const isRoundup = (headline) => ROUNDUP.test(String(headline ?? ''));

export function classifyCause(headline) {
  const h = String(headline ?? '');
  if (isRoundup(h)) return null;
  for (const [key, , re] of CAUSES) if (re.test(h)) return key;
  return null;
}

const READ = {
  acquisition: '거래 조건(인수가·현금/주식·마감 조건)이 주가를 좌우합니다. 인수 대상이면 상승 여력이 인수가 근처로 제한될 수 있고, 인수하는 쪽이면 지급 방식과 희석을 확인합니다.',
  financing: '새 주식·전환사채 발행은 주당 가치를 희석합니다. 할인 발행가, 워런트, 조달 목적(성장 투자인지 운영자금인지)을 확인합니다.',
  earnings: '실적·전망 발표에 따른 재평가입니다. 매출·이익의 예상 대비 결과와 가이던스 변화, 일회성 요인을 원문에서 확인합니다.',
  regulatory: '승인·임상 결과는 이분법적 사건입니다. 결과의 통계적 의미, 상업화 시점, 필요한 추가 자금을 확인합니다.',
  contract: '계약 금액·기간·취소 조건과 실제 매출 인식 시점을 확인해야 합니다. 제목의 금액은 총액 상한일 수 있습니다.',
  insider: '경영진·이사의 장내 매수 공시입니다. 자기 돈으로 산 금액과 인원, 보상 주식 행사와의 구분(Form 4 거래 코드 P)을 원문에서 확인합니다. 여러 명이 함께 사면 신호가 강해집니다.',
  index: '지수 편입·변경은 수급 사건이며 사업 변화가 아닙니다. 편입일 전후 거래량이 일시적으로 몰립니다.',
  analyst: '의견 변경은 정보가 아니라 해석입니다. 근거로 든 사업 변화가 실제로 확인되는지가 중요합니다.',
  legal: '조사·소송·공매도 보고서는 손실 위험 신호입니다. 주장 내용과 회사 반박, 재무 영향 규모를 확인합니다.',
  split: '분할·병합은 가치 변화가 아닙니다. 주식 병합은 상장 유지 요건 때문일 수 있습니다.',
  unexplained: '수집한 뉴스·공시에서 이유를 찾지 못했습니다. 정보가 아직 공개되지 않았거나 수집 범위 밖일 수 있어, 가격 움직임만으로 이유를 추정하지 않습니다.',
};
const CONTEXT_KO = { after_run: '이미 3개월 +50% 넘게 오른 뒤', new_high: '1년 신고가 부근', near_low: '1년 저점 부근', downtrend: '3개월 -25% 넘게 빠진 하락 추세 중', mid_range: '1년 범위 중간' };

/**
 * surge: detectVolumeSurge() result; news: [{time, headline, url}] (null = not collected);
 * filings: [{filingDate, form, label}] optional.
 */
export function explainSurge({ surge, news = null, filings = [], asOf }) {
  const day = Date.parse(surge.date);
  const near = (t) => Number.isFinite(t) && t >= day - 3 * DAY && t <= Math.min(day + 2 * DAY, Date.parse(asOf) + DAY);
  const heads = (news ?? []).filter((n) => near(Date.parse(n.time))).map((n) => ({ date: String(n.time).slice(0, 10), headline: n.headline, url: n.url ?? null, cause: classifyCause(n.headline), roundup: isRoundup(n.headline) }))
    .sort((a, b) => Number(a.roundup) - Number(b.roundup) || Number(!a.cause) - Number(!b.cause));
  const docs = (filings ?? []).filter((f) => near(Date.parse(f.filingDate))).map((f) => ({ date: f.filingDate, form: f.form, label: f.label ?? null, url: f.url ?? null }));
  const counts = {};
  for (const h of heads) if (h.cause) counts[h.cause] = (counts[h.cause] ?? 0) + 1;
  // most specific cause first (deal / financing / filing-backed news outrank opinions)
  const order = CAUSES.map(([k]) => k);
  const cause = Object.keys(counts).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? 'unexplained';
  heads.sort((a, b) => Number(b.cause === cause) - Number(a.cause === cause)); // the headline behind the label first
  const up = surge.ret1 > 0;
  const tone = surge.context === 'after_run' && (!up || surge.closePos < 0.3) ? '오른 뒤 큰 거래량에 약하게 마감 — 차익 실현·분산 가능성을 경계합니다.'
    : surge.context === 'near_low' && up && surge.closePos > 0.6 ? '저점 부근에서 큰 거래량과 함께 강하게 마감 — 바닥에서 수요가 들어왔을 수 있으나 하루로 전환을 확정하지 않습니다.'
    : surge.context === 'new_high' && up ? '신고가에서 거래량 동반 — 추세 지속 신호일 수 있지만 추격 위험도 큽니다.'
    : !up && surge.closePos < 0.3 ? '큰 거래량과 함께 약하게 마감 — 매도 압력이 우세했습니다.'
    : '거래량은 변화가 있었다는 뜻일 뿐, 방향은 이후 며칠의 가격으로 확인합니다.';
  return {
    cause, causeKo: CAUSE_KO[cause], read: READ[cause], tone, contextKo: CONTEXT_KO[surge.context],
    headlines: heads.slice(0, 5), filings: docs.slice(0, 3), newsChecked: news !== null,
    confidence: cause === 'unexplained' ? 'none' : docs.length ? 'filing_and_headline' : 'headline_only',
  };
}
