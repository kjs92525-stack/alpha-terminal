import { useEffect, useState } from 'react';
import { fetchTelegramDigest, type TelegramDigest } from '../lib/snapshot';
import { fmtEt } from '../lib/format';
import { PanelHead } from './ui';

/** Claude's digest of the public Telegram channel posts (written by a scheduled session, also sent to the bot). */
export function TelegramChecks() {
  const [data, setData] = useState<TelegramDigest | null>(null);
  useEffect(() => { fetchTelegramDigest().then(setData).catch(() => setData(null)); }, []);
  if (!data) return null;
  return <section className="panel">
    <PanelHead kicker="TELEGRAM · CLAUDE 브리핑" title="채널 글로 본 시장·투자 방향" right={<span className="live-badge">{fmtEt(data.createdAt)}</span>} />
    <p className="pad-box small" style={{ whiteSpace: 'pre-wrap' }}>{data.text}</p>
    <p className="pad-box muted small">채널 글을 Claude가 사이트 데이터와 함께 읽고 정리한 의견입니다. 매수 추천이 아닙니다.</p>
  </section>;
}
