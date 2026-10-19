// Fact-check of public Telegram channel posts against the site's own data.
// Posts come from the public web preview (https://t.me/s/<channel>), no account login. Each
// ticker a post mentions is checked against what the site measures: sales acceleration in the
// latest filed quarter (the signal that beat SPY), offering / shelf filings (the signal that
// lagged), chart stage and chase risk, upcoming earnings, and the market gate. Claims in the post
// (profit turnaround, growth, contracts, "no dilution") are compared with the filings.
import { storyAsOf } from './story-pit.mjs';

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const text = (html) => decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').trim();
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v) => (num(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%` : '—');

/** Posts from a t.me/s/<channel> page, oldest first: { id, channel, url, date, text }. */
export function parseChannelHtml(html, channel) {
  const out = [];
  const re = /<div class="tgme_widget_message [^"]*"[^>]*data-post="([^"\/]+)\/(\d+)"[^>]*>([\s\S]*?)(?=<div class="tgme_widget_message [^"]*"[^>]*data-post=|$)/g;
  for (const m of String(html).matchAll(re)) {
    const body = m[3];
    const t = body.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const d = body.match(/<time[^>]*datetime="([^"]+)"/);
    if (!t) continue;
    out.push({ id: Number(m[2]), channel: m[1] || channel, url: `https://t.me/${m[1] || channel}/${m[2]}`, date: d ? d[1] : null, text: text(t[1]) });
  }
  return out.sort((a, b) => a.id - b.id);
}

const STOP = new Set(['A', 'I', 'AI', 'CEO', 'CFO', 'IPO', 'ETF', 'USA', 'US', 'EPS', 'FDA', 'SEC', 'GDP', 'CPI', 'FOMC', 'PER', 'PBR', 'ROE', 'YOY', 'QOQ', 'ATH', 'DM', 'OK', 'TP', 'SL', 'PM', 'AM', 'ET', 'KST', 'NYSE', 'NASDAQ', 'AMEX', 'OTC', 'LLC', 'INC', 'LTD', 'Q1', 'Q2', 'Q3', 'Q4', 'EV', 'IT', 'TV', 'VS', 'BUY', 'SELL', 'HOLD', 'NEW', 'ALL', 'FOR', 'THE', 'AND', 'ON', 'AT', 'BY', 'TO', 'UP', 'GO']);
/** Tickers named in a post: $TICKER always; bare upper-case words only when they are listed symbols. */
export function extractTickers(postText, known) {
  const found = new Set();
  for (const m of postText.matchAll(/\$([A-Za-z]{1,5}(?:\.[A-Za-z])?)\b/g)) found.add(m[1].toUpperCase());
  for (const m of postText.matchAll(/(?<![A-Za-z$])([A-Z]{2,5})(?![A-Za-z])/g)) if (!STOP.has(m[1]) && known.has(m[1])) found.add(m[1]);
  return [...found].filter((t) => known.has(t)).slice(0, 6);
}

const CLAIMS = [
  { key: 'profit', re: /흑자|턴어라운드|turn(ed)?\s*profit|profitab/i, label: '흑자·이익 개선' },
  { key: 'loss', re: /적자\s*(축소|감소|개선)|loss(es)?\s*narrow/i, label: '적자 축소' },
  { key: 'growth', re: /매출\s*(급증|증가|성장|폭증|가속)|revenue\s*(growth|surge|jump|up)|record\s*revenue/i, label: '매출 성장' },
  { key: 'contract', re: /수주|계약|공급\s*계약|contract|award|partnership|파트너십/i, label: '계약·수주' },
  { key: 'nodil', re: /증자\s*(없|안)|유상증자\s*없|no\s*dilution/i, label: '증자 없음' },
];

/** ctx: { asOf, setups: Map, facts(symbol) -> facts|null, gate: {state,label} } */
export function analyzePost(post, ctx) {
  const tickers = extractTickers(post.text, ctx.known);
  const claims = CLAIMS.filter((c) => c.re.test(post.text));
  const items = tickers.map((sym) => {
    const row = ctx.setups.get(sym) ?? null, facts = ctx.facts(sym);
    const st = facts ? storyAsOf(facts, ctx.asOf) : { known: false };
    const lines = [], flags = [];
    if (st.known) {
      lines.push(st.revAccel ? `✅ 매출 가속: 최근 분기 매출 ${pct(st.prevYoY)} → ${pct(st.revYoY)} (과거 검증상 120일 SPY 대비 +3.1%p 신호)` : `• 매출 ${pct(st.prevYoY)} → ${pct(st.revYoY)} — 가속 아님`);
      lines.push(st.niImproved ? '• 순이익 1년 전보다 개선' : '• 순이익 1년 전보다 개선 안 됨');
    } else lines.push('• 최근 공시 분기 실적 자료 없음');
    const dil = row?.edge?.dilution;
    if (dil?.offering) { flags.push('424B'); lines.push('⚠ 최근 증자 설명서(424B) — 과거 120일 SPY 대비 -8.4%p'); }
    else if (dil?.shelf) { flags.push('S-3'); lines.push('⚠ 증자 대기 등록(S-3) — 과거 120일 SPY 대비 -8.9%p'); }
    if (row) {
      if (num(row.ret63) && (row.ret63 > 0.35 || (num(row.ret21) && row.ret21 > 0.2))) lines.push(`⚠ 이미 급등: 3개월 ${pct(row.ret63)}, 1개월 ${pct(row.ret21)} — 추격 주의`);
      if (row.plan) lines.push(`• 차트: ${row.stage} · 진입 $${row.plan.entry} / 무효화 $${row.plan.stop}`);
      if (row.earnings?.sessions != null && row.earnings.sessions <= 10) lines.push(`• 실적 발표 ${row.earnings.date} (${row.earnings.sessions}거래일 뒤)`);
    } else lines.push('• 오늘 스캔 후보 아님 (유동성·가격 조건 또는 차트 신호 없음)');
    // claim vs data
    const checks = [];
    for (const c of claims) {
      if (c.key === 'profit' && st.known) checks.push(st.niImproved ? `"${c.label}" — 데이터와 일치` : `"${c.label}" — 최근 공시로는 확인 안 됨`);
      if (c.key === 'loss' && st.known) checks.push(st.niImproved ? `"${c.label}" — 데이터와 일치` : `"${c.label}" — 최근 공시로는 확인 안 됨`);
      if (c.key === 'growth' && st.known) checks.push(num(st.revYoY) && st.revYoY > 0 ? `"${c.label}" — 매출 ${pct(st.revYoY)}로 일치${st.revAccel ? '·가속' : ', 가속은 아님'}` : `"${c.label}" — 최근 매출 ${pct(st.revYoY)}, 일치 안 함`);
      if (c.key === 'nodil' && dil) checks.push(dil.offering || dil.shelf ? `"${c.label}" — 증자 서류 있음, 주장과 다름` : `"${c.label}" — 최근 180일 증자 서류 없음`);
      if (c.key === 'contract') checks.push(`"${c.label}" — 계약 규모를 시가총액·매출과 비교해 원문 확인 필요`);
    }
    const verdict = flags.length ? '주의' : st.revAccel ? '근거 있음' : '근거 약함';
    return { symbol: sym, name: row?.name ?? null, verdict, lines, checks };
  });
  return { ...post, tickers, claims: claims.map((c) => c.label), items };
}

/** Telegram message (plain text, ≤ 4096 chars). */
export function formatReport(a, gate) {
  const head = `📡 ${a.channel} · ${a.date ? a.date.slice(0, 16).replace('T', ' ') : ''} UTC\n${a.text.slice(0, 280)}${a.text.length > 280 ? '…' : ''}\n${a.url}`;
  const body = a.items.map((x) => [`\n[${x.symbol}${x.name ? ` ${x.name}` : ''}] ${x.verdict}`, ...x.lines, ...x.checks.map((c) => `↳ ${c}`)].join('\n')).join('\n');
  const g = gate?.state ? `\n\n시장 판정: ${gate.label ?? gate.state}${gate.state === 'WAIT' ? ' — 신규 매수는 대기' : ''}` : '';
  return `${head}${body}${g}\n\n※ 사이트 데이터 기준 사실 점검이며 매수 추천이 아닙니다.`.slice(0, 4000);
}
