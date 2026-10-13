// TradingView webhook integration.
//
// TradingView (paid plans) can POST an alert message to a URL. We accept the
// message, answer immediately (TradingView gives webhooks only a few seconds),
// then enrich the alert with SEC filings / dilution / runway / quant score in
// the background, store it in KV and optionally forward it to Telegram.
//
// TradingView cannot send custom headers, so the shared secret travels in the
// JSON body ("secret") or the URL (?key=). Use HTTPS only.

import type { Filing } from '../../../packages/analysis/types';

export interface TvEnv {
  TV_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ALERTS?: KVNamespace;
}

export interface WaitCtx { waitUntil(p: Promise<unknown>): void }

/** Subset of the /analyze result the enrichment needs. */
export interface AnalyzeLike {
  name: string | null;
  score: { score: number | null; rating: string; riskLevel: string; metrics: { price: number | null; runwayMonths: number | null; dilutionFilings365d: number }; scenarios: { nearestSupport: number | null; nearestResistance: number | null } | null };
  filings: Filing[];
}

export interface TvAlert {
  id: string;
  receivedAt: string;
  symbol: string;
  exchange: string | null;
  interval: string | null;
  signal: string | null;
  price: number | null;
  level: number | null;
  barTime: string | null;
  message: string | null;
  source: string | null;
  enrichment: Enrichment | null;
  enrichmentError?: string | null;
  telegram?: 'sent' | 'failed' | 'disabled';
}

export interface Enrichment {
  name: string | null;
  score: number | null;
  rating: string;
  riskLevel: string;
  flags: Array<{ level: 'warn' | 'info'; text: string; url?: string }>;
  nearestSupport: number | null;
  nearestResistance: number | null;
  computedAt: string;
}

const MAX_BODY = 8 * 1024;
const TTL_SECONDS = 30 * 86400;

export class TvError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function checkKey(env: TvEnv, provided: string | null | undefined) {
  const secret = env.TV_WEBHOOK_SECRET?.trim();
  if (!secret) throw new TvError(503, 'TV_WEBHOOK_SECRET is not configured');
  if (!provided || !safeEqual(String(provided), secret)) throw new TvError(401, 'Invalid webhook key');
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown, max = 200): string | null => (v === undefined || v === null || v === '' ? null : String(v).slice(0, max));

/** "NASDAQ:AAPL" / "aapl" / "BRK.B" -> "AAPL" / "BRK.B"; null if not a plausible US ticker. */
export function normalizeTvSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase().split(':').pop() ?? '';
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s) ? s : null;
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Parse a TradingView webhook body: JSON (recommended) or plain text "SYMBOL message". */
export async function parseTvAlert(req: Request, urlKey: string | null, env: TvEnv): Promise<TvAlert> {
  const text = (await req.text()).slice(0, MAX_BODY);
  let body: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    body = { message: text };
  }
  checkKey(env, (body.secret as string) ?? urlKey);
  let symbol = normalizeTvSymbol(body.symbol ?? body.ticker);
  if (!symbol && typeof body.message === 'string') symbol = normalizeTvSymbol(body.message.split(/\s+/)[0]);
  if (!symbol) throw new TvError(400, 'symbol (or ticker) is required');
  const barTimeRaw = body.bar_time ?? body.time ?? null;
  const barTime = typeof barTimeRaw === 'number' ? new Date(barTimeRaw).toISOString() : str(barTimeRaw, 40);
  const signal = str(body.signal, 60);
  const interval = str(body.interval, 10);
  const id = await sha256(`${symbol}|${signal}|${interval}|${barTime ?? text}`);
  return {
    id,
    receivedAt: new Date().toISOString(),
    symbol,
    exchange: str(body.exchange, 20),
    interval,
    signal,
    price: num(body.price ?? body.close),
    level: num(body.level),
    barTime,
    message: str(body.message, 500),
    source: str(body.source, 40),
    enrichment: null,
  };
}

const DAY = 86400000;

/** Turn an analysis into short, verifiable context flags. Every flag maps to a filing or a computed metric. */
export function buildEnrichment(a: AnalyzeLike, now = Date.now(), alertPrice: number | null = null): Enrichment {
  const flags: Enrichment['flags'] = [];
  const ref = a.score.metrics.price;
  if (alertPrice !== null && ref !== null && ref > 0 && Math.abs(alertPrice / ref - 1) > 0.2) {
    flags.push({ level: 'warn', text: `가격 불일치: 알림 ${alertPrice} vs ALPHA 종가 ${ref.toFixed(2)} — 다른 종목/거래소이거나 데이터 지연, 맥락 정보 신뢰도 낮음` });
  }
  const recent = (f: Filing, days: number) => f.filingDate !== null && now - new Date(f.filingDate).getTime() <= days * DAY;
  const dil = a.filings.filter((f) => f.category === 'DILUTION' && f.importance !== 'low' && recent(f, 90));
  for (const f of dil.slice(0, 2)) flags.push({ level: 'warn', text: `희석 공시 ${f.form} (${f.filingDate}) — ${f.label}`, url: f.url });
  const distress = a.filings.filter((f) => (f.category === 'DISTRESS' || f.importance === 'critical') && recent(f, 180));
  for (const f of distress.slice(0, 2)) flags.push({ level: 'warn', text: `위험 공시 ${f.form} (${f.filingDate}) — ${f.label}`, url: f.url });
  const earn = a.filings.find((f) => f.category === 'EARNINGS' && recent(f, 5));
  if (earn) flags.push({ level: 'info', text: `실적 발표 직후 (${earn.filingDate}) — 변동성 확대 구간`, url: earn.url });
  const runway = a.score.metrics.runwayMonths;
  if (runway !== null && runway < 12) flags.push({ level: 'warn', text: `현금 런웨이 약 ${runway.toFixed(0)}개월 — 추가 자금조달 가능성` });
  const contract = a.filings.find((f) => (f.category === 'CONTRACT' || f.category === 'M&A') && recent(f, 10));
  if (contract) flags.push({ level: 'info', text: `${contract.label} (${contract.filingDate})`, url: contract.url });
  if (a.score.riskLevel === 'HIGH') flags.push({ level: 'warn', text: '퀀트 위험도 HIGH (변동성·낙폭·유동성·희석 종합)' });
  return {
    name: a.name,
    score: a.score.score,
    rating: a.score.rating,
    riskLevel: a.score.riskLevel,
    flags,
    nearestSupport: a.score.scenarios?.nearestSupport ?? null,
    nearestResistance: a.score.scenarios?.nearestResistance ?? null,
    computedAt: new Date(now).toISOString(),
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function telegramText(a: TvAlert): string {
  const e = a.enrichment;
  const lines = [
    `<b>📡 ${esc(a.symbol)}</b> ${a.signal ? esc(a.signal) : 'TradingView 알림'}${a.interval ? ` · ${esc(a.interval)}` : ''}`,
    a.price !== null ? `가격 ${a.price}${a.level !== null ? ` · 레벨 ${a.level}` : ''}` : '',
    a.message ? esc(a.message) : '',
  ];
  if (e) {
    lines.push(`퀀트 ${e.score ?? '—'}/100 · ${esc(e.rating)} · 위험 ${e.riskLevel}`);
    if (e.nearestSupport !== null || e.nearestResistance !== null) lines.push(`지지 ${e.nearestSupport?.toFixed(2) ?? '—'} / 저항 ${e.nearestResistance?.toFixed(2) ?? '—'}`);
    for (const f of e.flags) lines.push(`${f.level === 'warn' ? '⚠️' : 'ℹ️'} ${esc(f.text)}`);
    if (!e.flags.length) lines.push('최근 희석·위험 공시 없음');
  } else if (a.enrichmentError) {
    lines.push(`(맥락 분석 실패: ${esc(a.enrichmentError)})`);
  }
  lines.push('<i>참고용 · 투자 자문 아님</i>');
  return lines.filter(Boolean).join('\n');
}

async function sendTelegram(env: TvEnv, text: string): Promise<'sent' | 'failed' | 'disabled'> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return 'disabled';
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

const kvKey = (a: TvAlert) => `alert:${String(9e15 - Date.parse(a.receivedAt)).padStart(16, '0')}:${a.id}`;

async function store(env: TvEnv, key: string, a: TvAlert) {
  if (env.ALERTS) await env.ALERTS.put(key, JSON.stringify(a), { expirationTtl: TTL_SECONDS });
}

/** Handle POST /api/v1/tv/webhook. */
export async function handleTvWebhook(
  req: Request, env: TvEnv, ctx: WaitCtx | undefined, urlKey: string | null,
  analyze: (symbol: string) => Promise<AnalyzeLike>,
): Promise<{ id: string; symbol: string; stored: boolean; duplicate: boolean }> {
  const alert = await parseTvAlert(req, urlKey, env);
  if (env.ALERTS && (await env.ALERTS.get(`dedupe:${alert.id}`))) {
    return { id: alert.id, symbol: alert.symbol, stored: false, duplicate: true };
  }
  const key = kvKey(alert);
  if (env.ALERTS) await env.ALERTS.put(`dedupe:${alert.id}`, '1', { expirationTtl: 86400 });
  await store(env, key, alert);

  const enrich = (async () => {
    try {
      alert.enrichment = buildEnrichment(await analyze(alert.symbol), Date.now(), alert.price);
    } catch (e) {
      alert.enrichmentError = (e as Error).message;
    }
    alert.telegram = await sendTelegram(env, telegramText(alert));
    await store(env, key, alert);
  })();
  if (ctx) ctx.waitUntil(enrich); else await enrich;
  return { id: alert.id, symbol: alert.symbol, stored: Boolean(env.ALERTS), duplicate: false };
}

/** Handle GET /api/v1/tv/alerts (requires the same key). */
export async function listTvAlerts(env: TvEnv, key: string | null, limit: number): Promise<{ alerts: TvAlert[]; storage: boolean }> {
  checkKey(env, key);
  if (!env.ALERTS) return { alerts: [], storage: false };
  const list = await env.ALERTS.list({ prefix: 'alert:', limit: Math.min(100, Math.max(1, limit)) });
  const values = await Promise.all(list.keys.map((k) => env.ALERTS!.get(k.name)));
  return { alerts: values.filter((v): v is string => Boolean(v)).map((v) => JSON.parse(v) as TvAlert), storage: true };
}
