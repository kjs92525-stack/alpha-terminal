// ALPHA TERMINAL — "story" signals: is the business improving faster than the
// price/narrative suggests? Every point comes from a computed number or a counted
// headline, and is returned as a human-readable reason (Korean) with its evidence.
//
// Inputs: Fundamentals (SEC XBRL summary incl. quarterly revenue / net income),
// classified filings, and classified news items (optional).

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const DAY = 86400000;

/** YoY growth for each quarter that has a same-quarter value ~1 year earlier. */
export function quarterlyYoY(series) {
  const out = [];
  for (const q of series ?? []) {
    const t = Date.parse(q.end);
    const prior = series.find((p) => Math.abs(Date.parse(p.end) - (t - 365 * DAY)) <= 20 * DAY);
    if (prior && prior.value > 0) out.push({ end: q.end, yoy: q.value / prior.value - 1, value: q.value });
  }
  return out;
}

export const THEMES = [
  ['AI', /\b(AI|artificial intelligence|generative|LLM|GPU|inference|data cent(er|re)s?)\b/],
  ['방산', /\b(defense|defence|Pentagon|Army|Navy|Air Force|DoD|missile|drone)s?\b/i],
  ['원전·에너지', /\b(nuclear|uranium|SMR|reactor|grid|power demand)\b/i],
  ['우주', /\b(satellites?|orbit(al)?|rockets?|spacecraft|space (force|station|launch|company|economy))\b/i],
  ['양자', /\bquantum\b/i],
  ['비만·바이오', /\b(GLP-1|obesity|FDA approv\w*|phase 3)\b/i],
  ['크립토', /\b(bitcoin|crypto|blockchain|stablecoin)\b/i],
  ['로봇·자율주행', /\b(robot\w*|humanoid|autonomous|robotaxi)\b/i],
];

export function storySignals({ fundamentals: f, filings = [], news = [], asOf }) {
  const asOfMs = Date.parse(asOf);
  const reasons = [];
  let score = 0;
  const add = (pts, text, kind = 'plus') => { score += pts; reasons.push({ kind, text, pts }); };

  // 1. revenue growth and acceleration (30)
  const yoy = quarterlyYoY(f?.revenueQuarterly ?? []).filter((q) => Date.parse(q.end) <= asOfMs);
  const g = yoy.slice(-3);
  if (g.length >= 2) {
    const latest = g[g.length - 1].yoy;
    const earlier = g[0].yoy;
    if (latest > 0.15) add(10, `최근 분기 매출 +${(latest * 100).toFixed(0)}% (전년 동기 대비)`);
    if (latest - earlier > 0.05 && latest > 0) add(20, `매출 성장 가속: ${(earlier * 100).toFixed(0)}% → ${(latest * 100).toFixed(0)}% (${g.length}개 분기)`);
    else if (latest - earlier < -0.1) add(-10, `매출 성장 둔화: ${(earlier * 100).toFixed(0)}% → ${(latest * 100).toFixed(0)}%`, 'minus');
  } else if (isNum(f?.revenueGrowth) && f.revenueGrowth > 0.2) {
    add(8, `연간 매출 +${(f.revenueGrowth * 100).toFixed(0)}% (분기 데이터 부족)`);
  }

  // 2. profitability inflection (25)
  const ni = (f?.netIncomeQuarterly ?? []).filter((q) => Date.parse(q.end) <= asOfMs);
  if (ni.length >= 2) {
    const lastQ = ni[ni.length - 1];
    const yearAgo = ni.find((p) => Math.abs(Date.parse(p.end) - (Date.parse(lastQ.end) - 365 * DAY)) <= 20 * DAY);
    const prevQ = ni[ni.length - 2];
    if (lastQ.value > 0 && ((yearAgo && yearAgo.value <= 0) || prevQ.value <= 0)) add(25, `흑자 전환 (분기 순이익 ${fmtUsd(lastQ.value)}, ${lastQ.end})`);
    else if (lastQ.value > 0 && yearAgo && yearAgo.value > 0 && lastQ.value > yearAgo.value * 1.5) add(12, `분기 순이익 전년 대비 +${((lastQ.value / yearAgo.value - 1) * 100).toFixed(0)}%`);
    else if (lastQ.value < 0 && yearAgo && yearAgo.value < 0 && lastQ.value > yearAgo.value * 0.5) add(8, '적자 폭 절반 이하로 축소 — 흑자 전환 접근');
  }

  // 3. narrative heat: news volume and themes (20)
  const recent = news.filter((n) => asOfMs - Date.parse(n.time) <= 7 * DAY);
  const older = news.filter((n) => { const d = asOfMs - Date.parse(n.time); return d > 7 * DAY && d <= 60 * DAY; });
  // only meaningful when the fetched news reaches back past the last week (a capped request of a
  // heavily covered stock can be all from this week, which is not a "surge")
  const oldest = news.reduce((m, n) => Math.min(m, Date.parse(n.time)), Infinity);
  const covered = news.length > 0 && asOfMs - oldest > 21 * DAY;
  const weeklyBase = older.length / (53 / 7);
  if (covered && recent.length >= 5 && recent.length >= Math.max(2, weeklyBase * 2)) add(10, `최근 1주 뉴스 ${recent.length}건 (평소 주 ${weeklyBase.toFixed(1)}건) — 관심 급증`);
  // a theme counts when several headlines (and a real share of them) are about it
  const themes = THEMES.filter(([, re]) => {
    const hits = news.filter((n) => re.test(n.headline ?? '')).length;
    return hits >= 3 && hits / news.length >= 0.2;
  }).map(([t]) => t);
  if (themes.length) add(Math.min(10, themes.length * 5), `테마 연결: ${themes.join(', ')}`);

  // 4. "doubted while improving" (10): negative headline share with improving fundamentals
  const neg = news.filter((n) => n.sentiment === 'negative').length;
  const improving = reasons.some((r) => r.kind === 'plus' && /가속|흑자|순이익|축소/.test(r.text));
  if (news.length >= 5 && neg / news.length >= 0.3 && improving) add(10, `부정적 기사 비중 ${Math.round((neg / news.length) * 100)}%인데 실적은 개선 중 — 시장이 의심하는 성장`);

  // 5. risks (penalties)
  const within = (x, days) => x.filingDate && asOfMs - Date.parse(x.filingDate) <= days * DAY && Date.parse(x.filingDate) <= asOfMs;
  const dil = filings.filter((x) => x.category === 'DILUTION' && x.importance !== 'low' && within(x, 180));
  if (dil.length) add(-15, `최근 6개월 희석 공시 ${dil.length}건 (${dil.map((d) => d.form).slice(0, 3).join(', ')})`, 'minus');
  if (isNum(f?.sharesYoY) && f.sharesYoY > 0.1) add(-10, `주식 수 1년 +${(f.sharesYoY * 100).toFixed(0)}%`, 'minus');
  if (isNum(f?.runwayMonths) && f.runwayMonths < 12) add(-15, `현금 런웨이 약 ${f.runwayMonths.toFixed(0)}개월`, 'minus');
  const distress = filings.filter((x) => (x.category === 'DISTRESS' || x.importance === 'critical') && within(x, 365));
  if (distress.length) add(-25, `위험 공시: ${distress[0].label}`, 'minus');

  const narrative = narrate({ f, yoy: g, ni, news: news.filter((n) => Date.parse(n.time) <= asOfMs + DAY), themes, dilution: dil.length, distress: distress.length });
  return { storyScore: Math.max(0, Math.min(100, score)), reasons, themes, revenueYoY: g, newsCount: { week: recent.length, weeklyAvg: weeklyBase }, narrative };
}

const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
const mmdd = (iso) => { const d = new Date(iso); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };

/**
 * Plain-Korean summary built only from the numbers and headlines above (rule-based, no AI):
 * where the business is now, what is changing, what the market is saying, the risks, and a
 * one-line takeaway. Every sentence restates a value that is shown elsewhere with its source.
 */
export function narrate({ f, yoy, ni, news, themes, dilution = 0, distress = 0 }) {
  const lines = [];
  // 1. profit now vs a year ago
  const lastQ = ni.at(-1);
  const yearAgo = lastQ ? ni.find((p) => Math.abs(Date.parse(p.end) - (Date.parse(lastQ.end) - 365 * DAY)) <= 20 * DAY) : null;
  let profit = null; // 'loss-narrowing' | 'loss-widening' | 'loss' | 'turned' | 'profit-growing' | 'profit'
  if (lastQ) {
    const q = `${lastQ.end.slice(0, 7)} 분기`;
    if (lastQ.value < 0) {
      if (yearAgo && yearAgo.value < 0) {
        const chg = 1 - lastQ.value / yearAgo.value;
        profit = chg > 0.15 ? 'loss-narrowing' : chg < -0.15 ? 'loss-widening' : 'loss';
        lines.push(`${q} 순손실 ${fmtUsd(lastQ.value)}로 아직 적자지만, 1년 전(${fmtUsd(yearAgo.value)})보다 적자가 ${chg > 0 ? `${(chg * 100).toFixed(0)}% 줄었습니다` : `${(-chg * 100).toFixed(0)}% 늘었습니다`}.`);
      } else {
        profit = 'loss';
        lines.push(`${q} 순손실 ${fmtUsd(lastQ.value)}로 적자 상태입니다.`);
      }
    } else if (yearAgo && yearAgo.value <= 0) {
      profit = 'turned';
      lines.push(`${q} 순이익 ${fmtUsd(lastQ.value)}로 1년 전 적자(${fmtUsd(yearAgo.value)})에서 흑자로 돌아섰습니다.`);
    } else if (yearAgo && yearAgo.value > 0) {
      profit = lastQ.value > yearAgo.value * 1.2 ? 'profit-growing' : 'profit';
      lines.push(`${q} 순이익 ${fmtUsd(lastQ.value)} (1년 전 ${fmtUsd(yearAgo.value)}, ${pct(lastQ.value / yearAgo.value - 1)}).`);
    } else {
      profit = 'profit';
      lines.push(`${q} 순이익 ${fmtUsd(lastQ.value)} 흑자입니다.`);
    }
  }
  // 2. revenue trend
  let growth = null; // 'accel' | 'decel' | 'steady'
  if (yoy.length >= 2) {
    const a = yoy[0].yoy;
    const b = yoy.at(-1).yoy;
    growth = b - a > 0.05 ? 'accel' : b - a < -0.1 ? 'decel' : 'steady';
    const path = yoy.map((q) => pct(q.yoy)).join(' → ');
    lines.push(growth === 'accel' ? `매출 성장률이 ${yoy.length}개 분기 연속 빨라지고 있습니다 (전년 대비 ${path}).`
      : growth === 'decel' ? `매출 성장률은 느려지는 중입니다 (전년 대비 ${path}).`
        : `매출은 전년 대비 ${path} 수준으로 비슷하게 유지되고 있습니다.`);
  } else if (isNum(f?.revenueGrowth)) {
    lines.push(`최근 1년 매출 ${pct(f.revenueGrowth)} (분기 추이는 데이터 부족).`);
  }
  // 3. staying power
  if (isNum(f?.runwayMonths)) lines.push(f.runwayMonths < 12 ? `현금은 지금 속도로 약 ${f.runwayMonths.toFixed(0)}개월 버틸 수준이라 추가 자금 조달(주식 발행) 가능성이 있습니다.` : `영업에서 돈이 나가고 있지만 현금으로 약 ${f.runwayMonths.toFixed(0)}개월 버틸 수 있습니다.`);
  // 4. what the news says
  const recentNews = [...news].sort((x, y) => Date.parse(y.time) - Date.parse(x.time));
  const key = recentNews.filter((n) => n.sentiment === 'positive' || (n.tags ?? []).length).slice(0, 2);
  if (key.length) lines.push(`최근 소식: ${key.map((n) => `"${n.headline}" (${mmdd(n.time)})`).join(', ')}.`);
  if (themes.length) lines.push(`뉴스 흐름상 ${themes.join('·')} 테마로 묶여 다뤄지고 있습니다.`);
  const neg = news.filter((n) => n.sentiment === 'negative').length;
  const doubted = news.length >= 5 && neg / news.length >= 0.3;
  if (doubted) lines.push(`부정적 기사 비중이 ${Math.round((neg / news.length) * 100)}%로, 시장은 아직 의심하는 분위기입니다.`);
  // 5. risks
  if (dilution) lines.push(`최근 6개월 신주 발행 관련 공시 ${dilution}건 — 주주 몫이 희석될 수 있습니다.`);
  if (distress) lines.push('최근 1년 내 위험 공시가 있어 주의가 필요합니다.');
  // takeaway
  const improving = growth === 'accel' || profit === 'loss-narrowing' || profit === 'turned';
  let takeaway;
  if (!lastQ && !yoy.length) takeaway = '실적 데이터가 없어 차트와 뉴스만으로 판단해야 합니다.';
  else if (profit === 'loss-narrowing' && growth === 'accel') takeaway = '적자지만 매출이 빨라지고 적자가 줄고 있어, 흑자 전환이 확인되면 재평가될 수 있는 유형입니다.';
  else if (profit === 'loss' && growth === 'accel') takeaway = '적자지만 매출은 빨라지는 중입니다 — 적자가 줄어드는지는 아직 확인되지 않았습니다.';
  else if (profit === 'loss-narrowing') takeaway = '아직 적자지만 개선 중입니다 — 다음 분기에 적자가 더 줄어드는지가 관건입니다.';
  else if (profit === 'turned') takeaway = '흑자 전환 초기입니다 — 이익이 다음 분기에도 이어지는지 확인이 필요합니다.';
  else if ((profit === 'profit-growing' || profit === 'profit') && growth === 'accel') takeaway = '이미 흑자에 성장도 빨라지는 실적 모멘텀형입니다.';
  else if (growth === 'decel') takeaway = '성장이 느려지는 중이라, 차트가 좋아도 실적 뒷받침은 약합니다.';
  else if (profit === 'loss-widening') takeaway = '적자가 커지는 중이라, 스토리보다 위험이 큽니다.';
  else takeaway = improving ? '실적이 개선되는 흐름입니다.' : '실적에 뚜렷한 변화는 아직 보이지 않습니다.';
  if (doubted && improving) takeaway += ' 시장의 의심과 실적 개선이 엇갈리는 구간입니다.';
  return { lines, takeaway, method: '규칙 기반 자동 요약 — 위 숫자·뉴스 제목만으로 작성 (AI 해석 아님)' };
}

function fmtUsd(v) {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toFixed(0)}`;
}
