import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Star } from 'lucide-react';
import { useTerminal } from '../lib/store';
import type { NewsResponse, Quote, SecLatestResponse } from '../lib/types';
import { CATEGORY_LABEL, fmtPct } from '../lib/format';
import { ErrorBox, Loading, SourceBadge } from './ui';

type Tab = 'news' | 'sec';
type Scope = 'market' | 'mine';

const TAG_KO: Record<string, string> = { EARNINGS: '실적', GUIDANCE: '가이던스', FDA: 'FDA', OFFERING: '오퍼링', 'M&A': 'M&A', CONTRACT: '계약', ANALYST: '애널리스트', AI: 'AI', RISK: '리스크', BUYBACK: '자사주' };
const SENT: Record<string, [string, string]> = { positive: ['긍정', 'pos'], negative: ['부정', 'neg'], neutral: ['중립', 'neu'] };
const IMP_RANK = { low: 1, medium: 2, high: 4, critical: 5 } as const;

const timeEt = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '—');

function ChangePill({ q }: { q: Quote | undefined }) {
  if (!q || q.changePct === null) return null;
  return <span className={`chg-pill ${q.changePct >= 0 ? 'pos' : 'neg'}`}>{fmtPct(q.changePct, 2)}</span>;
}

export function NewsFeed() {
  const { source, mode, select, setPage, watchlist, universe, toggleWatch } = useTerminal();
  const [tab, setTab] = useState<Tab>('news');
  const [scope, setScope] = useState<Scope>('market');
  const [news, setNews] = useState<NewsResponse | null>(null);
  const [sec, setSec] = useState<SecLatestResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    setBusy(true);
    setErr(null);
    const mine = [...new Set([...watchlist, ...universe])].slice(0, 50);
    const p = tab === 'news' ? source.news(scope === 'mine' ? mine : []).then(setNews) : source.secLatest().then(setSec);
    p.catch((e) => setErr(e.message)).finally(() => setBusy(false));
  }, [tab, scope, source, watchlist, universe]);
  useEffect(() => { load(); if (mode !== 'live') return; const t = setInterval(load, 60000); return () => clearInterval(t); }, [load, mode]);

  const open = (sym: string | null) => { if (sym) { select(sym.replace('-', '.')); setPage('research'); } };
  const needle = q.trim().toUpperCase();

  return (
    <section className="panel feed-panel">
      <div className="feed-head">
        <div className="seg">
          <button className={tab === 'news' ? 'on' : ''} onClick={() => setTab('news')}>뉴스 피드</button>
          <button className={tab === 'sec' ? 'on' : ''} onClick={() => setTab('sec')}>SEC 공시</button>
        </div>
        {tab === 'news' && (
          <div className="seg small">
            <button className={scope === 'market' ? 'on' : ''} onClick={() => setScope('market')}>전체 시장</button>
            <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>관심·유니버스</button>
          </div>
        )}
        <input className="mini-input feed-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="티커 또는 키워드" />
        <button className="text-link" onClick={load} disabled={busy}><RefreshCw size={11} className={busy ? 'spin' : ''} /></button>
        <span className="feed-src">{tab === 'news' && news && <SourceBadge name={news.source} fetchedAt={news.fetchedAt} note={news.note} />}{tab === 'sec' && sec && <SourceBadge name={sec.source} fetchedAt={sec.fetchedAt} />}</span>
      </div>
      {err && <ErrorBox error={err} hint={/ALPACA/.test(err) ? 'Cloudflare Pages 시크릿에 ALPACA_KEY_ID / ALPACA_SECRET_KEY를 등록하세요.' : undefined} />}
      {busy && !(tab === 'news' ? news : sec) && <Loading />}
      <div className="table-wrap feed-scroll">
        {tab === 'news' && news && (
          <table className="data-table feed-table">
            <thead><tr><th>시간(ET)</th><th>영향</th><th>감정</th><th>종목</th><th>제목</th><th>요약</th><th>태그</th><th /></tr></thead>
            <tbody>
              {news.items.filter((n) => !needle || n.symbols.includes(needle) || n.headline.toUpperCase().includes(needle)).map((n) => {
                const sym = n.symbols[0] ?? null;
                return (
                  <tr key={n.id} className={n.importance >= 4 ? 'hot' : ''}>
                    <td className="mono">{timeEt(n.time)}</td>
                    <td><span className={`imp imp-${n.importance}`} title="태그 기반 규칙 점수 (1–5)">{n.importance}</span></td>
                    <td><span className={`sent ${SENT[n.sentiment][1]}`} title={`+${n.matched.positive.join(', ') || '없음'} / -${n.matched.negative.join(', ') || '없음'}`}>{SENT[n.sentiment][0]}</span></td>
                    <td className="sym-cell"><button onClick={() => open(sym)}>{sym ?? '—'}</button><ChangePill q={sym ? news.quotes[sym] : undefined} />{n.symbols.length > 1 && <small className="muted">+{n.symbols.length - 1}</small>}</td>
                    <td className="headline">{n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.headline}</a> : n.headline}</td>
                    <td className="summary">{n.summary}</td>
                    <td>{n.tags.slice(0, 3).map((t) => <span key={t} className="tag-pill">{TAG_KO[t] ?? t}</span>)}</td>
                    <td>{sym && <button className="icon-mini" onClick={() => toggleWatch(sym)} aria-label="관심등록"><Star size={11} className={watchlist.includes(sym) ? 'star-on' : ''} /></button>}</td>
                  </tr>
                );
              })}
              {!news.items.length && <tr><td colSpan={8} className="muted">뉴스 없음</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'sec' && sec && (
          <table className="data-table feed-table">
            <thead><tr><th>접수(ET)</th><th>영향</th><th>종목</th><th>서식</th><th>회사</th><th>내용</th><th>분류</th><th /></tr></thead>
            <tbody>
              {sec.items.filter((f) => !needle || (f.ticker ?? '').includes(needle) || f.company.toUpperCase().includes(needle) || f.form.includes(needle)).map((f) => {
                const sym = f.ticker ? f.ticker.replace('-', '.') : null;
                return (
                  <tr key={f.accession ?? `${f.cik}${f.acceptedAt}`} className={IMP_RANK[f.importance] >= 4 ? 'hot' : ''}>
                    <td className="mono">{timeEt(f.acceptedAt)}</td>
                    <td><span className={`imp imp-${IMP_RANK[f.importance]}`}>{IMP_RANK[f.importance]}</span></td>
                    <td className="sym-cell">{sym ? <button onClick={() => open(sym)}>{sym}</button> : <span className="muted">비상장/미매핑</span>}<ChangePill q={sym ? sec.quotes[sym] : undefined} /></td>
                    <td className="mono"><b>{f.form}</b></td>
                    <td className="summary">{f.company}</td>
                    <td className="headline">{f.label}{f.items && <small className="muted"> · Items {f.items}</small>}</td>
                    <td><span className={`tag-pill cat-${f.category.replace('&', '')}`}>{CATEGORY_LABEL[f.category] ?? f.category}</span></td>
                    <td>{f.url && <a className="icon-mini" href={f.url} target="_blank" rel="noreferrer" aria-label="SEC 원문"><ExternalLink size={11} /></a>}</td>
                  </tr>
                );
              })}
              {!sec.items.length && <tr><td colSpan={8} className="muted">공시 없음</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
