import { useEffect, useState } from 'react';
import { Copy, Check, LineChart } from 'lucide-react';
import { useTerminal } from '../lib/store';
import { fetchSetups, NoSnapshotError, SECTOR_KO, type Setups } from '../lib/snapshot';
import { buildStoryPrompt, storyPicks } from '../lib/storyPicks';
import { fmtPrice } from '../lib/format';
import { Loading, PanelHead } from './ui';

export function StoryPicks({ limit = 8 }: { limit?: number }) {
  const { select, setPage } = useTerminal();
  const [data, setData] = useState<Setups | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'error' | 'ok'>('loading');
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    fetchSetups().then((d) => { setData(d); setState('ok'); }).catch((e) => setState(e instanceof NoSnapshotError ? 'missing' : 'error'));
  }, []);
  const picks = storyPicks(data, limit);

  const copy = async (sym: string) => {
    const pick = picks.find((p) => p.row.symbol === sym);
    if (!pick || !data) return;
    const text = buildStoryPrompt(pick.row, data.asOf);
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    setCopied(sym);
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <section className="panel story-picks">
      <PanelHead kicker="STORY CHECK · NIGHTLY" title="스토리 확인 추천" right={data && <span className="live-badge">기준일 {data.asOf}</span>} />
      <p className="pad-box muted small">차트가 매수 자리이면서, 숫자·뉴스에 "숨은 스토리" 신호(적자지만 개선, 매출 가속, 흑자 전환, 시장의 의심, 관심 급증, 테마)가 있는 종목입니다. <b>분석 프롬프트 복사</b>를 눌러 Claude 채팅에 붙여넣으면 깊게 검증해 줍니다.</p>
      {state === 'loading' && <Loading label="추천 불러오기" />}
      {state === 'missing' && <div className="pad-box muted">아직 야간 수집 결과가 없습니다.</div>}
      {state === 'error' && <div className="pad-box muted">추천을 불러오지 못했습니다.</div>}
      {state === 'ok' && !picks.length && <div className="pad-box muted">오늘은 차트와 스토리 신호가 함께 있는 종목이 없습니다.</div>}
      <div className="pick-grid">
        {picks.map(({ row, why, hook }) => (
          <div key={row.symbol} className="pick-card">
            <div className="pick-top">
              <b>{row.symbol}</b>
              <span className="muted small">{row.name ?? ''} · {SECTOR_KO[row.sector] ?? row.sector}</span>
            </div>
            <div className="pick-hook">{hook} · ${fmtPrice(row.price)}</div>
            <div className="pick-why">{why.map((w) => <span key={w} className="chip">{w}</span>)}</div>
            {row.narrative && <p className="pick-take">→ {row.narrative.takeaway}</p>}
            {row.plan?.how && <p className="pick-how">매수타점: {row.plan.how}</p>}
            <div className="pick-actions">
              <button className="primary-button" onClick={() => copy(row.symbol)}>{copied === row.symbol ? <><Check size={12} /> 복사됨</> : <><Copy size={12} /> 분석 프롬프트 복사</>}</button>
              <button className="secondary-button" onClick={() => { select(row.symbol); setPage('charts'); }}><LineChart size={12} /> 차트</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
