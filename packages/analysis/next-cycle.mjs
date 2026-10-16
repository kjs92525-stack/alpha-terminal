// "Next cycle" sector candidates: where the business is turning before the price has priced it.
//
// Evidence per GICS sector, each shown with its number so the reader can disagree:
//  A. business breadth — share of the sector's companies whose latest filed quarter shows sales
//     acceleration (the definition that beat SPY in the filing event study), now vs 91 days ago,
//     point in time (only quarters filed by each date);
//  B. not yet priced — 2-year return vs SPY and drawdown from the 2-year high of the sector ETF;
//  C. price stabilising — 3-month relative strength or a rising 50-day average.
// The sector-level combination is a hypothesis (not backtested); a forward ledger records it.
import { storyAsOf } from './story-pit.mjs';

const DAY = 86400000;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v, d = 0) => (num(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '—');
const share = (v) => (num(v) ? `${(v * 100).toFixed(0)}%` : '—');
const pp = (v) => (num(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%p` : '—');
const median = (a) => { const s = a.filter(num).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

export const SECTOR_MAP = {
  'Information Technology': { etf: 'XLK', ko: '기술', themes: ['SMH', 'IGV', 'QTUM', 'BOTZ'], macro: 'duration' },
  'Communication Services': { etf: 'XLC', ko: '커뮤니케이션', themes: [], macro: 'duration' },
  Financials: { etf: 'XLF', ko: '금융', themes: ['KRE', 'KIE', 'BLOK'], macro: 'curve' },
  'Health Care': { etf: 'XLV', ko: '헬스케어', themes: ['XBI', 'IHI'], macro: 'defensive' },
  Energy: { etf: 'XLE', ko: '에너지', themes: ['XOP', 'OIH', 'URA', 'TAN'], macro: 'inflation' },
  Industrials: { etf: 'XLI', ko: '산업재', themes: ['ITA', 'IYT', 'JETS', 'PAVE', 'UFO'], macro: 'cycle' },
  'Consumer Discretionary': { etf: 'XLY', ko: '경기소비재', themes: ['XRT', 'ITB', 'ARKK'], macro: 'consumer' },
  'Consumer Staples': { etf: 'XLP', ko: '필수소비재', themes: [], macro: 'defensive' },
  Materials: { etf: 'XLB', ko: '소재', themes: ['XME', 'COPX', 'LIT', 'GDX', 'SIL'], macro: 'inflation' },
  Utilities: { etf: 'XLU', ko: '유틸리티', themes: [], macro: 'rates' },
  'Real Estate': { etf: 'XLRE', ko: '부동산', themes: [], macro: 'rates' },
};

/** entries: [{ sector, facts }]. Share of companies whose latest filed quarter shows sales acceleration, now and `lagDays` ago. */
export function sectorBreadth(entries, asOf, lagDays = 91) {
  const then = new Date(Date.parse(asOf) - lagDays * DAY).toISOString().slice(0, 10);
  const acc = {};
  for (const { sector, facts } of entries) {
    if (!SECTOR_MAP[sector] || !facts?.revenueQuarterly?.length) continue;
    const a = (acc[sector] ??= { n: 0, accel: 0, ni: 0, yoy: [], prevN: 0, prevAccel: 0, prevYoy: [] });
    const now = storyAsOf(facts, asOf), prev = storyAsOf(facts, then);
    if (now.known) { a.n++; if (now.revAccel) a.accel++; if (now.niImproved) a.ni++; a.yoy.push(now.revYoY); }
    if (prev.known) { a.prevN++; if (prev.revAccel) a.prevAccel++; a.prevYoy.push(prev.revYoY); }
  }
  return Object.fromEntries(Object.entries(acc).map(([s, a]) => {
    const share = a.n ? a.accel / a.n : null, prevShare = a.prevN ? a.prevAccel / a.prevN : null;
    return [s, { n: a.n, accel: a.accel, share, prevN: a.prevN, prevShare, delta: num(share) && num(prevShare) ? share - prevShare : null, niShare: a.n ? a.ni / a.n : null, medYoY: median(a.yoy), prevMedYoY: median(a.prevYoy), since: then }];
  }));
}

/** One sentence linking today's macro reading to how this kind of sector usually reacts — context, not a forecast. */
export function macroNote(kind, macro, gate) {
  const hot = macro && num(macro.headlineMonthly) && num(macro.coreMonthly) && macro.headlineMonthly >= 0.4 && macro.coreMonthly >= 0.3;
  const cpi = macro && num(macro.headlineAnnual) ? `${macro.period} CPI 전년 대비 ${macro.headlineAnnual.toFixed(1)}%, 전월 대비 ${macro.headlineMonthly.toFixed(1)}%` : '최근 CPI 미확인';
  const lines = {
    rates: hot ? `${cpi}로 물가가 다시 뜨거워져 금리 인하 기대가 늦춰질 수 있습니다. 차입 비용과 배당 매력에 민감한 업종이라 역풍입니다.` : `${cpi}. 물가 둔화가 이어져 금리가 내려가면 차입 비용·배당 매력 면에서 수혜를 보는 업종입니다.`,
    duration: hot ? `${cpi}. 금리 상승 압력은 먼 미래 이익의 현재가치를 깎아 성장주 비중이 큰 업종에 역풍입니다.` : `${cpi}. 금리 부담이 줄면 성장 기대가 큰 업종의 할인율이 낮아집니다.`,
    inflation: hot ? `${cpi}. 물가가 높을 때는 원자재·에너지 가격이 버티는 경우가 많아 상대적으로 순풍일 수 있습니다.` : `${cpi}. 물가가 내려가면 원자재 가격 기대도 약해질 수 있습니다.`,
    curve: `${cpi}. 금리 수준과 장단기 금리차에 따라 예대마진·채권 평가손익이 달라지는 업종입니다.`,
    consumer: hot ? `${cpi}. 물가 상승은 실질 소득을 줄여 재량 소비를 압박합니다.` : `${cpi}. 물가 둔화는 실질 소득을 늘려 재량 소비에 우호적입니다.`,
    cycle: `${cpi}. 경기 민감 업종이라 제조업 지표·수주가 같은 방향인지 함께 확인해야 합니다.`,
    defensive: `${cpi}. 경기 둔화기에 방어적인 업종이지만, 위험 선호가 살아나는 반등장에서는 소외되기 쉽습니다.`,
  };
  const g = gate === 'WAIT' ? ' 시장 판정은 "신규 진입 대기" — 후보라도 지금은 관찰만 합니다.' : gate === 'LIMIT' ? ' 시장 판정은 "제한적 진입" — 비중을 줄여 접근합니다.' : '';
  return (lines[kind] ?? cpi) + g;
}

/**
 * groups: sectors.json groups (ETF metrics); breadth: sectorBreadth(); macro: market-brief macro; gate: decision state;
 * stocksBySector: { sector: [...] } already filtered and sorted by the caller.
 */
export function rankNextCycle({ groups, breadth, macro = null, gate = null, stocksBySector = {} }) {
  const byEtf = new Map((groups ?? []).map((g) => [g.etf, g]));
  // compare each sector with the others: an earnings season lifts most sectors at once
  const medShare = median(Object.values(breadth).map((b) => b.share)), medDelta = median(Object.values(breadth).map((b) => b.delta));
  const rows = [];
  for (const [sector, cfg] of Object.entries(SECTOR_MAP)) {
    const g = byEtf.get(cfg.etf), b = breadth[sector], m = g?.metrics ?? {};
    const why = [], risks = [], check = [];
    let pts = 0, business = 0;
    if (!g || !b || b.n < 15) { rows.push({ sector, ko: cfg.ko, etf: cfg.etf, status: 'insufficient', pts: 0, why: [], risks: [`자료 부족 (실적 확인 기업 ${b?.n ?? 0}곳 · ETF ${g ? '있음' : '없음'})`], check: [], breadth: b ?? null, metrics: m, phase: g?.phase ?? null, phaseKo: g?.phaseKo ?? null, themes: [], stocks: [], macro: macroNote(cfg.macro, macro, gate) }); continue; }
    // A. business breadth
    const rel = num(b.delta) && num(medDelta) ? b.delta - medDelta : null;
    const line = `매출 가속 기업 비중 ${share(b.prevShare)} → ${share(b.share)} (3개월 새 ${pp(b.delta)}, ${b.n}곳 중 ${b.accel}곳 · 11개 업종 중간 변화 ${pp(medDelta)})`;
    if (num(rel) && rel >= 0.05) { pts += 2; business += 2; why.push(`${line} — 다른 업종보다 빠르게 개선`); }
    else if (num(rel) && rel >= 0.02) { pts += 1; business += 1; why.push(`${line} — 다른 업종보다 다소 빠름`); }
    else if (num(rel) && rel <= -0.03) risks.push(`${line} — 다른 업종보다 개선이 느림`);
    if (num(b.share) && num(medShare) && b.share >= medShare + 0.05) { pts += 1; business += 1; why.push(`가속 기업 비중 ${share(b.share)} — 11개 업종 중간값(${share(medShare)})보다 5%p 이상 높음`); }
    if (num(b.medYoY) && num(b.prevMedYoY)) (b.medYoY > b.prevMedYoY ? why : risks).push(`업종 매출 성장률 중간값 ${pct(b.prevMedYoY, 1)} → ${pct(b.medYoY, 1)}`);
    // B. not yet priced
    const priced = g.phase === 'LATE' || (g.phase === 'LEADING' && ((num(m.rs24m) && m.rs24m >= 0.15) || (num(m.rs12m) && m.rs12m >= 0.15)));
    if (num(m.rs24m) && m.rs24m <= 0) { pts += 1; why.push(`2년간 시장 대비 ${pct(m.rs24m)} — 가격에 덜 반영`); }
    if (num(m.ddFromHigh) && m.ddFromHigh >= 0.15) { pts += 1; why.push(`2년 고점 대비 -${(m.ddFromHigh * 100).toFixed(0)}%`); }
    if (priced) risks.push(`이미 ${g.phaseKo} 국면 (1년 시장 대비 ${pct(m.rs12m)}, 2년 ${pct(m.rs24m)}) — 다음 사이클이 아니라 진행 중인 사이클`);
    // C. price stabilising
    if ((num(m.rs3m) && m.rs3m > 0) || (num(m.ma50Slope) && m.ma50Slope > 0)) { pts += 1; why.push(`가격 안정 신호: 3개월 시장 대비 ${pct(m.rs3m)}, 50일선 ${num(m.ma50Slope) && m.ma50Slope > 0 ? '상승' : '하락'}`); }
    if (g.phase === 'DOWN' && num(m.ma50Slope) && m.ma50Slope < 0) { pts -= 1; risks.push('가격은 아직 하락 추세 (200일선 아래, 50일선 하락) — 바닥 확인 전'); }
    const status = priced ? 'priced' : business >= 2 && pts >= 4 ? 'candidate' : business >= 1 ? 'watch' : 'none';
    check.push(`다음 분기 실적 시즌에 가속 기업 비중이 ${share(b.share)}보다 늘어나는지`, `${cfg.etf}가 50일선 위로 올라서고 시장 대비 3개월 강도가 플러스로 바뀌는지`);
    if (!why.length) why.push('뚜렷한 근거 없음');
    const themes = cfg.themes.map((t) => byEtf.get(t)).filter(Boolean).map((t) => ({ etf: t.etf, name: t.name, phase: t.phase, phaseKo: t.phaseKo, rs3m: t.metrics?.rs3m ?? null, rs24m: t.metrics?.rs24m ?? null }));
    rows.push({ sector, ko: cfg.ko, etf: cfg.etf, status, pts, why, risks, check, breadth: b, metrics: m, phase: g.phase, phaseKo: g.phaseKo, themes, stocks: stocksBySector[sector] ?? [], macro: macroNote(cfg.macro, macro, gate) });
  }
  const order = { candidate: 0, watch: 1, priced: 2, none: 3, insufficient: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || b.pts - a.pts);
  return rows;
}
