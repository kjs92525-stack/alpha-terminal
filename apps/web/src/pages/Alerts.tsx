import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, RefreshCw } from 'lucide-react';
import pineCode from '../../../../integrations/tradingview/alpha_structure.pine?raw';
import { useTerminal } from '../lib/store';
import { API_BASE, fetchTvAlerts } from '../lib/api';
import { load, save } from '../lib/storage';
import { ErrorBox, Loading, PanelHead } from '../components/ui';
import { fmtAgo, fmtEt, RISK_LABEL } from '../lib/format';
import type { TvAlert } from '../lib/types';

const TEMPLATE = `{
  "secret": "여기에_TV_WEBHOOK_SECRET",
  "symbol": "{{ticker}}",
  "exchange": "{{exchange}}",
  "interval": "{{interval}}",
  "signal": "MY_ALERT",
  "price": {{close}},
  "bar_time": "{{time}}",
  "message": "{{strategy.order.action}} 또는 자유 문구"
}`;

function CopyBox({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="copy-box">
      <div className="copy-head"><span>{label}</span><button className="text-link" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }}><Copy size={11} /> {ok ? '복사됨' : '복사'}</button></div>
      <pre>{text}</pre>
    </div>
  );
}

function Status({ on, label, hint }: { on: boolean | undefined; label: string; hint: string }) {
  return <div><small>{label}</small><b className={on ? 'up' : 'down'}>{on ? '설정됨' : '미설정'}</b><em>{hint}</em></div>;
}

export function Alerts() {
  const { health, mode, select, setPage } = useTerminal();
  const [key, setKey] = useState(() => load('alpha:tvkey', ''));
  const [draft, setDraft] = useState(key);
  const [alerts, setAlerts] = useState<TvAlert[] | null>(null);
  const [storage, setStorage] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tv = health?.tradingview;
  const webhookUrl = `${API_BASE || location.origin}/api/v1/tv/webhook`;

  const refresh = useCallback(() => {
    if (!key || mode !== 'live') return;
    setBusy(true);
    fetchTvAlerts(key).then((r) => { setAlerts(r.alerts); setStorage(r.storage); setErr(null); }).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  }, [key, mode]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 30000); return () => clearInterval(t); }, [refresh]);

  return (
    <>
      <div className="detail-grid" style={{ marginTop: 0 }}>
        <section className="panel">
          <PanelHead kicker="STATUS" title="연동 상태" />
          <div className="fact-grid">
            <Status on={tv?.webhook} label="웹훅 시크릿" hint="TV_WEBHOOK_SECRET" />
            <Status on={tv?.storage} label="알림 저장소" hint="KV 바인딩 ALERTS" />
            <Status on={tv?.telegram} label="텔레그램 전송" hint="TELEGRAM_BOT_TOKEN / CHAT_ID" />
            <div><small>데이터 모드</small><b className={mode === 'live' ? 'up' : 'neutral'}>{mode === 'live' ? 'LIVE' : 'SIMULATED'}</b><em>{mode === 'live' ? '' : 'API 배포 후 사용 가능'}</em></div>
          </div>
        </section>
        <section className="panel">
          <PanelHead kicker="HOW IT WORKS" title="동작 방식" />
          <ol className="steps">
            <li>TradingView 알림이 발생하면 아래 웹훅 URL로 JSON이 전송됩니다 (유료 플랜 기능).</li>
            <li>서버는 즉시 응답한 뒤, 해당 종목의 SEC 공시·희석·런웨이·퀀트 점수·지지/저항을 계산해 알림에 붙입니다.</li>
            <li>결과를 저장하고(최근 30일) 텔레그램으로 보냅니다. 시크릿 키는 저장·전송하지 않습니다.</li>
          </ol>
          <p className="footnote pad">알림은 참고 정보이며 매매 지시가 아닙니다. 맥락 정보는 공시·계산값에서만 생성됩니다.</p>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 12 }}>
        <PanelHead kicker="FEED" title="수신된 TradingView 알림" right={<button className="text-link" onClick={refresh} disabled={busy}><RefreshCw size={11} className={busy ? 'spin' : ''} /> 새로고침</button>} />
        <div className="inline-form">
          <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="웹훅 시크릿 (이 브라우저에만 저장)" />
          <button className="secondary-button" onClick={() => { setKey(draft); save('alpha:tvkey', draft); }}>저장</button>
        </div>
        {mode !== 'live' && <div className="pad-box muted">API가 배포되면 알림 피드가 표시됩니다.</div>}
        {err && <ErrorBox error={err} />}
        {!storage && <div className="pad-box muted">KV 저장소(ALERTS)가 연결되지 않아 목록은 비어 있습니다. 텔레그램 전송은 동작합니다.</div>}
        {busy && !alerts && <Loading />}
        <div className="alert-list">
          {alerts?.map((a) => (
            <div key={a.id} className="alert-row">
              <div className="alert-main">
                <button className="alert-sym" onClick={() => { select(a.symbol); setPage('research'); }}>{a.symbol}</button>
                <span className={`sig ${/BULL/.test(a.signal ?? '') ? 'up' : /BEAR/.test(a.signal ?? '') ? 'down' : ''}`}>{a.signal ?? 'ALERT'}</span>
                {a.interval && <span className="chip">{a.interval}</span>}
                {a.price !== null && <span>@ {a.price}</span>}
                <small className="muted">{fmtEt(a.receivedAt)} · {fmtAgo(a.receivedAt)}{a.telegram === 'sent' ? ' · 텔레그램 ✓' : a.telegram === 'failed' ? ' · 텔레그램 실패' : ''}</small>
              </div>
              {a.message && <div className="muted small">{a.message}</div>}
              {a.enrichment ? (
                <div className="alert-ctx">
                  <span>퀀트 <b>{a.enrichment.score ?? '—'}</b> · {a.enrichment.rating} · 위험 {RISK_LABEL[a.enrichment.riskLevel] ?? a.enrichment.riskLevel}</span>
                  <span>지지 {a.enrichment.nearestSupport?.toFixed(2) ?? '—'} / 저항 {a.enrichment.nearestResistance?.toFixed(2) ?? '—'}</span>
                  {a.enrichment.flags.map((f, i) => (
                    <span key={i} className={f.level === 'warn' ? 'down' : 'neutral'}>{f.level === 'warn' ? '⚠' : 'ℹ'} {f.text}{f.url && <a href={f.url} target="_blank" rel="noreferrer"> <ExternalLink size={10} /></a>}</span>
                  ))}
                  {!a.enrichment.flags.length && <span className="up">최근 희석·위험 공시 없음</span>}
                </div>
              ) : <div className="muted small">{a.enrichmentError ? `맥락 분석 실패: ${a.enrichmentError}` : '맥락 분석 중…'}</div>}
            </div>
          ))}
          {alerts && !alerts.length && storage && <div className="empty">아직 수신된 알림이 없습니다.</div>}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <PanelHead kicker="SETUP 1" title="TradingView 알림 → 웹훅 설정" />
        <ol className="steps">
          <li>TradingView 알림 생성 → <b>Notifications</b> 탭 → <b>Webhook URL</b> 체크 후 아래 주소 입력</li>
          <li>메시지 칸에 아래 JSON 템플릿을 붙여넣고 <code>secret</code>을 실제 값으로 교체 (지표·가격 알림 모두 가능)</li>
          <li>ALPHA Pine 지표를 쓰는 경우: 조건을 <b>ALPHA STRUCT → Any alert() function call</b>로 선택하면 메시지는 지표가 자동 생성합니다 (지표 설정에 시크릿 입력)</li>
        </ol>
        <div className="pad-box"><CopyBox label="Webhook URL" text={webhookUrl} /></div>
        <div className="pad-box"><CopyBox label="알림 메시지 템플릿 (JSON)" text={TEMPLATE} /></div>
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <PanelHead kicker="SETUP 2" title="Pine Script — ALPHA 구조 신호를 TradingView에" />
        <ol className="steps">
          <li>TradingView 하단 <b>Pine Editor</b> → 새 지표 → 아래 코드 전체 붙여넣기 → 저장 → <b>차트에 추가</b></li>
          <li>BOS/CHoCH, FVG, 오더블록이 ALPHA 엔진과 같은 규칙으로 표시됩니다. 스윙은 오른쪽 {3}봉 마감 후 확정, 알림은 봉 마감 시에만 발송(리페인트 없음)</li>
          <li>참고: TradingView의 <code>ta.pivothigh</code>는 동일 고가(타이) 처리 방식이 ALPHA 엔진과 미세하게 다를 수 있습니다</li>
        </ol>
        <div className="pad-box"><CopyBox label="alpha_structure.pine (Pine v6)" text={pineCode} /></div>
      </section>
    </>
  );
}
