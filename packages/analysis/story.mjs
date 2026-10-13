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

  return { storyScore: Math.max(0, Math.min(100, score)), reasons, themes, revenueYoY: g, newsCount: { week: recent.length, weeklyAvg: weeklyBase } };
}

function fmtUsd(v) {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toFixed(0)}`;
}
