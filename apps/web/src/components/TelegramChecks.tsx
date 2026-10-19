import { useEffect, useState } from 'react';
import { useTerminal } from '../lib/store';
import { fetchTelegram, type TelegramCheck } from '../lib/snapshot';
import { fmtEt } from '../lib/format';
import { PanelHead } from './ui';

const CLS: Record<string, string> = { '근거 있음': 'up', '주의': 'down', '근거 약함': 'neutral' };

/** Public Telegram channel posts fact-checked against the site data (GitHub Actions, every 30 min). */
export function TelegramChecks() {
  const { select, setPage } = useTerminal();
  const [data, setData] = useState<TelegramCheck | null>(null);
  useEffect(() => { fetchTelegram().then(setData).catch(() => setData(null)); }, []);
  if (!data) return null;
  return <section className="panel">
    <PanelHead kicker="TELEGRAM · 30분마다" title="텔레그램 채널 글 사실 점검" right={<span className="live-badge">{fmtEt(data.updatedAt)}</span>} />
    <p className="pad-box muted small">공개 채널 {data.channels.join(', ')}의 새 글에서 종목을 찾아, 최근 공시 실적(매출 가속)·증자 서류·급등 여부·실적 발표일·글의 주장을 사이트 데이터({data.dataAsOf} 기준)와 대조합니다. 매수 추천이 아닙니다.</p>
    {!data.posts.length && <p className="pad-box muted">아직 종목이 언급된 새 글이 없습니다.</p>}
    {data.posts.slice(0, 10).map((p) => <div key={`${p.channel}/${p.id}`} className="pad-box small" style={{ borderTop: '1px solid var(--line, #2a2f3a)' }}>
      <a className="text-link inline" href={p.url} target="_blank" rel="noreferrer">{p.channel} · {p.date?.slice(0, 16).replace('T', ' ')}</a>
      <p className="muted" style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{p.text.slice(0, 220)}{p.text.length > 220 ? '…' : ''}</p>
      {p.items.map((x) => <div key={x.symbol}>
        <b><button className="text-link inline" onClick={() => { select(x.symbol); setPage('charts'); }}>{x.symbol}</button></b> {x.name ?? ''} · <span className={CLS[x.verdict] ?? ''}>{x.verdict}</span>
        <ul className="thesis-list">{[...x.lines, ...x.checks.map((c) => `↳ ${c}`)].map((l, i) => <li key={i}>{l}</li>)}</ul>
      </div>)}
    </div>)}
  </section>;
}
