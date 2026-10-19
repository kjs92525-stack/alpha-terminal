import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChannelHtml, extractTickers, analyzePost, formatReport } from '../packages/analysis/telegram.mjs';

const msg = (id, html, date) => `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="usstocks/${id}" data-view="x"><div class="tgme_widget_message_bubble"><div class="tgme_widget_message_text js-message_text" dir="auto">${html}</div><div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="https://t.me/usstocks/${id}"><time datetime="${date}" class="time">12:00</time></a></div></div></div></div>`;
const page = `<html><body><section class="tgme_channel_history">${msg(101, '<b>$IREN</b> 흑자 전환!<br/>매출 급증 &amp; 증자 없음', '2026-10-18T03:00:00+00:00')}${msg(102, 'Market wrap: CPI 3.7%, FOMC next week', '2026-10-18T05:00:00+00:00')}${msg(100, 'JAKK 수주 공시', '2026-10-17T05:00:00+00:00')}</section></body></html>`;

test('parses the public channel preview into posts, oldest first, with decoded text', () => {
  const p = parseChannelHtml(page, 'usstocks');
  assert.deepEqual(p.map((x) => x.id), [100, 101, 102]);
  assert.equal(p[1].url, 'https://t.me/usstocks/101');
  assert.equal(p[1].date, '2026-10-18T03:00:00+00:00');
  assert.equal(p[1].text, '$IREN 흑자 전환!\n매출 급증 & 증자 없음');
});

test('tickers: $-tagged or listed upper-case words; macro acronyms ignored', () => {
  const known = new Set(['IREN', 'JAKK', 'CPI', 'NOW']);
  assert.deepEqual(extractTickers('$IREN 흑자 전환, JAKK 수주', known), ['IREN', 'JAKK']);
  assert.deepEqual(extractTickers('CPI 3.7%, FOMC next week', known), []);
  assert.deepEqual(extractTickers('$ZZZZ unknown', known), []);
  assert.deepEqual(extractTickers('AP통신에 따르면 IREN 급등', new Set(['AP', 'IREN'])), ['IREN'], 'news agency is not a ticker');
});

test('claims are checked against filings; dilution and chase risk are flagged', () => {
  const facts = { revenueQuarterly: [
    { end: '2025-03-31', value: 100, filed: '2025-05-10' }, { end: '2025-06-30', value: 100, filed: '2025-08-10' },
    { end: '2026-03-31', value: 110, filed: '2026-05-10' }, { end: '2026-06-30', value: 130, filed: '2026-08-10' }],
    netIncomeQuarterly: [{ end: '2025-06-30', value: 5, filed: '2025-08-10' }, { end: '2026-06-30', value: 2, filed: '2026-08-10' }] };
  const setups = new Map([['IREN', { symbol: 'IREN', name: 'IREN Ltd', stage: 'POST_BREAKOUT', ret63: 0.6, ret21: 0.1, plan: { entry: 40, stop: 35 }, edge: { dilution: { offering: false, shelf: true } } }]]);
  const ctx = { asOf: '2026-10-18', setups, known: new Set(['IREN']), facts: (s) => (s === 'IREN' ? facts : null) };
  const a = analyzePost(parseChannelHtml(page, 'usstocks')[1], ctx);
  const x = a.items[0];
  assert.equal(x.symbol, 'IREN');
  assert.equal(x.verdict, '주의');
  assert.ok(x.lines.some((l) => /매출 가속/.test(l)));
  assert.ok(x.lines.some((l) => /S-3/.test(l)) && x.lines.some((l) => /이미 급등/.test(l)));
  assert.ok(x.checks.some((c) => /흑자·이익 개선.*확인 안 됨/.test(c)), 'profit claim contradicted: net income fell');
  assert.ok(x.checks.some((c) => /증자 없음.*주장과 다름/.test(c)));
  const r = formatReport(a, { state: 'WAIT', label: '신규 진입 대기' });
  assert.match(r, /\[IREN IREN Ltd\] 주의/);
  assert.match(r, /신규 매수는 대기/);
  assert.ok(r.length <= 4000);
});
