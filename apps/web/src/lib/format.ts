import type { Num } from './types';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const fmtPrice = (v: Num | undefined) => (isNum(v) ? (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toFixed(v < 1 ? 4 : 2)) : '—');
export const fmtPct = (v: Num | undefined, d = 1) => (isNum(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '—');
export const fmtNum = (v: Num | undefined, d = 0) => (isNum(v) ? v.toFixed(d) : '—');
export function fmtUsd(v: Num | undefined) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}
export function fmtShares(v: Num | undefined) {
  if (!isNum(v)) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toLocaleString('en-US');
}

/** Wall-clock time in New York, labelled ET. */
export function fmtEt(iso: string | null | undefined, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) };
  return `${d.toLocaleString('en-CA', opts).replace(',', '')}${withTime ? ' ET' : ''}`;
}

export function fmtAgo(iso: string | null | undefined) {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.round(s / 60)}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  return `${Math.round(s / 86400)}일 전`;
}

export const barDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
export const signClass = (v: Num | undefined) => (isNum(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '');
export const scoreClass = (v: Num | undefined) => (isNum(v) ? (v >= 65 ? 'up' : v >= 45 ? 'neutral' : 'down') : '');

export const SIZE_LABEL: Record<string, string> = { mega: '초대형', large: '대형', mid: '중형', small: '소형', micro: '초소형', unknown: '규모 미상' };
export const STYLE_LABEL: Record<string, string> = { growth: '성장', value: '가치', blend: '혼합' };
export const RISK_LABEL: Record<string, string> = { LOW: '낮음', MODERATE: '보통', HIGH: '높음', UNKNOWN: '미상' };
export const CATEGORY_LABEL: Record<string, string> = {
  EARNINGS: '실적', CONTRACT: '계약', 'M&A': '인수합병', DILUTION: '희석·오퍼링', FINANCING: '자금조달', DISTRESS: '위험·부실',
  RISK: '리스크', GOVERNANCE: '지배구조', DISCLOSURE: '수시공시', PERIODIC: '정기보고', OWNERSHIP: '대량보유', INSIDER: '내부자',
  EXHIBIT: '첨부', OTHER: '기타', FDA: 'FDA',
};

// Heat-map background for 0–100 values: salmon (low) -> slate -> blue -> teal (high).
const HEAT_STOPS: Array<[number, [number, number, number]]> = [[0, [179, 106, 110]], [40, [58, 63, 107]], [70, [47, 111, 184]], [100, [31, 155, 176]]];
export function heatColor(v: Num | undefined): string {
  if (!isNum(v)) return '#1a1d40';
  const x = Math.max(0, Math.min(100, v));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [x1, c1] = HEAT_STOPS[i];
    const [x0, c0] = HEAT_STOPS[i - 1];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t)).join(',')})`;
    }
  }
  return 'rgb(31,155,176)';
}
