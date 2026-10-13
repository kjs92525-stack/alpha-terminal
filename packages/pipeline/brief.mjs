// Small plain-text daily brief (Markdown) for chat assistants that browse a URL (ChatGPT etc.):
// the full JSON snapshots are too large to read in one go.

const pct = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '—');
const px = (v) => (typeof v === 'number' && Number.isFinite(v) ? `$${v < 10 ? v.toFixed(2) : v.toFixed(1)}` : '—');
const clean = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

const TABS = [
  ['breakout', '바닥 돌파', ['BREAKOUT', 'POST_BREAKOUT', 'NEAR_PIVOT']],
  ['base', '바닥 다지기', ['IN_BASE']],
  ['pullback', '눌림목', ['BOUNCE', 'AT_SUPPORT']],
  ['weekly_bottom', '주봉 바닥', ['TURNING', 'AT_BOTTOM']],
  ['monthly_bottom', '월봉 바닥', ['TURNING', 'AT_BOTTOM']],
];
const STAGE_KO = { BREAKOUT: '오늘 돌파', POST_BREAKOUT: '돌파 후 눌림', NEAR_PIVOT: '돌파 임박', IN_BASE: '바닥 다지는 중', BOUNCE: '지지 반등', AT_SUPPORT: '지지 테스트', TURNING: '전환 시작', AT_BOTTOM: '바닥권' };

/** setups.json + sectors.json objects → Markdown string. */
export function buildBrief({ setups, sectors, perTab = 12, siteUrl = null }) {
  const L = [];
  L.push(`# ALPHA TERMINAL 데일리 브리프 — 기준일 ${setups.asOf}`);
  L.push('');
  L.push(`생성 ${setups.generatedAt} · 미국 주식 · 데이터: Alpaca 일봉, SEC/Finnhub 재무, Alpaca 뉴스. 규칙 기반 자동 스캔이며 투자 자문이 아닙니다.${siteUrl ? ` 사이트: ${siteUrl}` : ''}`);
  L.push('');
  L.push('읽는 법: 손절폭 = 매수가에서 손절가까지 하락률, R = (1차 목표-매수가)/(매수가-손절가). "스토리"는 재무·뉴스 규칙 기반 자동 요약(AI 해석 아님)이라 직접 검증이 필요합니다. 백테스트상 차트 신호만으로는 시장(SPY) 대비 우위가 확인되지 않았습니다.');
  if (sectors?.groups?.length) {
    L.push('', '## 업종·테마 사이클 (ETF 기준)', '');
    const by = {};
    for (const g of sectors.groups) (by[g.phaseKo ?? g.phase] ??= []).push(`${g.name}(${g.etf} 12M ${pct(g.metrics?.ret12m)}, 2Y ${pct(g.metrics?.ret24m)})`);
    for (const [k, v] of Object.entries(by)) L.push(`- **${k}**: ${v.join(', ')}`);
  }
  for (const [type, ko, stages] of TABS) {
    const rows = (setups.candidates ?? []).filter((x) => (x.type ?? 'breakout') === type && stages.includes(x.stage)).slice(0, perTab);
    if (!rows.length) continue;
    const total = Object.values(setups.stats?.byType?.[type] ?? {}).reduce((a, b) => a + b, 0);
    L.push('', `## ${ko} — 상위 ${rows.length}개${total ? ` (전체 ${total}개 중)` : ''}`, '');
    L.push('| 종목 | 현재가 | 상태 | 매수 방법 | 손절폭 | R | 점수(차트/스토리) | 스토리 요약 |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const x of rows) {
      const p = x.plan ?? {};
      L.push(`| ${x.symbol} ${clean(x.name).slice(0, 28)} | ${px(x.price)} | ${STAGE_KO[x.stage] ?? x.stage} | ${clean(p.how ?? '—')} | ${typeof p.riskPct === "number" ? `${(p.riskPct * 100).toFixed(0)}%` : "—"} | ${typeof p.rMultiple === 'number' ? p.rMultiple.toFixed(1) : '—'} | ${x.chartScore}/${x.storyScore} | ${clean(x.narrative?.takeaway ?? '—')} |`);
    }
  }
  L.push('', '---', '이 문서는 매일 밤 자동으로 다시 만들어집니다. 종목별 상세(분기 매출·이익, 뉴스 원문)는 같은 폴더의 setups.json에 있습니다.');
  return L.join('\n') + '\n';
}
