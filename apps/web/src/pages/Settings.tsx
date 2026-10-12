import { useState } from 'react';
import { useTerminal } from '../lib/store';
import { supabase } from '../lib/supabase';
import { PanelHead } from '../components/ui';
import { fmtEt } from '../lib/format';

const SOURCES: Array<[string, string, string, string]> = [
  ['SEC EDGAR submissions', '공식 · 무료', '공시 목록, 8-K 항목, 접수 시각', 'SEC_USER_AGENT 필요, 초당 10회 제한'],
  ['SEC XBRL companyfacts', '공식 · 무료', '매출, 순이익, 영업현금흐름, 현금, 주식수', '연간(10-K) 기준, 일부 기업 미제공'],
  ['Stooq', '무료 · 비공식', '일봉 OHLCV (EOD)', '장 마감 후 갱신, 접근 제한 가능'],
  ['Yahoo Finance chart', '무료 · 비공식', '일봉 대체, 5분/60분봉', '지연 시세, 약관·차단 위험 — PRICE_PROVIDERS로 끌 수 있음'],
  ['openFDA drugsfda', '공식 · 무료', 'FDA 승인 제출 이력', '임상 결과·PDUFA 일정 없음'],
  ['FINRA short interest', '미연결', '공매도 잔고', '다음 단계'],
  ['컨센서스 추정치', '미연결 (유료)', '어닝 서프라이즈', '사용자 승인 전 연결 안 함'],
  ['LLM 분석 (Claude API)', '미연결', '서술형 리서치 요약', 'API 키를 Worker secret으로만 보관해야 함'],
];

export function Settings() {
  const { mode, modeReason, health, session, syncError } = useTerminal();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const signIn = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    setMsg(error ? error.message : '로그인 링크를 이메일로 보냈습니다.');
  };
  return (
    <>
      <div className="detail-grid">
        <section className="panel">
          <PanelHead kicker="RUNTIME" title="현재 연결 상태" />
          <div className="fact-grid">
            <div><small>데이터 모드</small><b className={mode === 'live' ? 'up' : 'neutral'}>{mode === 'live' ? 'LIVE' : 'SIMULATED'}</b><em>{modeReason}</em></div>
            <div><small>API</small><b>{health ? `v${health.version}` : '미연결'}</b><em>{health ? fmtEt(health.time) : 'VITE_API_BASE_URL 또는 /api 배포 필요'}</em></div>
            <div><small>SEC User-Agent</small><b className={health?.secConfigured ? 'up' : 'down'}>{health?.secConfigured ? '설정됨' : '미설정'}</b></div>
            <div><small>시세 공급자</small><b>{health?.priceProviders.join(' → ') ?? '—'}</b></div>
            <div><small>Supabase</small><b className={supabase ? 'up' : 'neutral'}>{supabase ? '설정됨' : '미설정'}</b><em>{supabase ? (session ? session.user.email : '로그아웃 상태') : 'VITE_SUPABASE_URL / ANON_KEY'}</em></div>
          </div>
        </section>
        <section className="panel">
          <PanelHead kicker="ACCOUNT" title="관심종목 동기화 (Supabase)" />
          <div className="pad-box">
            {!supabase && <p className="muted">Supabase 환경변수가 없어 관심종목은 이 브라우저(localStorage)에만 저장됩니다.</p>}
            {supabase && !session && (
              <div className="inline-form">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일" />
                <button className="primary-button" onClick={signIn}>매직 링크 로그인</button>
              </div>
            )}
            {supabase && session && <button className="secondary-button" onClick={() => supabase?.auth.signOut()}>로그아웃 ({session.user.email})</button>}
            {msg && <p className="muted">{msg}</p>}
            {syncError && <p className="down">동기화 오류: {syncError}</p>}
            <p className="footnote">가상(SIM) 모드의 관심종목은 서버에 저장하지 않습니다.</p>
          </div>
        </section>
      </div>
      <section className="panel" style={{ marginTop: 12 }}>
        <PanelHead kicker="DATA SOURCES" title="데이터 출처와 한계" />
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>출처</th><th>구분</th><th>제공 데이터</th><th>제약</th></tr></thead>
            <tbody>{SOURCES.map((r) => <tr key={r[0]}><td><b>{r[0]}</b></td><td>{r[1]}</td><td>{r[2]}</td><td className="muted">{r[3]}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="footnote pad">유료 API는 사용자 승인 없이 연결하지 않습니다. 모든 API 키는 Cloudflare secret으로만 저장되며 브라우저 번들(VITE_*)에 넣지 않습니다.</p>
      </section>
    </>
  );
}
