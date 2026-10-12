# ALPHA TERMINAL — V0.4

미국 주식 퀀트 분석 터미널. React 19 + TypeScript + Vite, TradingView Lightweight Charts v5, Cloudflare Pages Functions(Workers) API, Supabase(선택).

세 가지 핵심 기능을 같은 우선순위로 제공합니다.

| 기능 | 구현 내용 | 데이터 |
|---|---|---|
| **AI 종목 발굴** | 6팩터(모멘텀·추세·재무 품질·밸류에이션·유동성·안정성) 규칙 기반 점수, 대형/중소형·성장/가치 분류, 위험도, 근거 목록, 변동성 기반 상승·중립·하락 시나리오 | 일봉 시세 + SEC XBRL 재무 + SEC 공시 |
| **전문 차트 분석** | 캔들, 5m/1H/1D/1W, EMA/SMA, VWAP, RSI, MACD, ATR, 거래량, 거래량 프로파일(POC·가치영역), 지지/저항, 추세 체계, BOS/CHoCH, FVG, Order Block, 신호 원장(기준 봉 vs **확정 봉**), 미확정 신호 별도 표시 | 시세 공급자 |
| **이벤트 레이더** | SEC 공시 분류(8-K 항목별, S-1/S-3/424B 희석, 13D, M&A 등), 중요도, 접수 시각(ET), 공시 후 첫 거래일 주가·거래량 반응, 현금·런웨이·주식수 증가, openFDA 승인 이력 | SEC EDGAR, openFDA |

> **투자 자문이 아닙니다.** 점수는 결정적 규칙 기반 상대평가이며 확률이 아닙니다. 시나리오 범위는 과거 변동성 ±1σ이며 예측이 아닙니다. LLM 서술형 분석은 아직 연결되지 않았습니다.

## TradingView 연동 (V0.4)

TradingView 알림 웹훅 수신 → SEC 공시·희석·런웨이·퀀트 점수를 붙여 텔레그램 전송, ALPHA 구조 신호 Pine Script, TradingView 차트 위젯. 설정은 [`integrations/tradingview/README.md`](integrations/tradingview/README.md).

## 데이터 모드

- **LIVE**: `/api/v1/health`가 응답하면 자동 전환. 실제 티커, SEC 공식 데이터, 무료 지연 시세. 모든 패널에 출처와 갱신 시각 표시.
- **SIMULATED**: API가 없으면 가상 종목 `SIM01–SIM06`과 합성 시세로 동작(실제 기업명/티커를 쓰지 않음). 상단 경고 배너 표시.

## 데이터 출처 (모두 무료, 유료 API 미사용)

| 출처 | 구분 | 비고 |
|---|---|---|
| SEC EDGAR submissions / XBRL companyfacts / company_tickers | 공식 | `SEC_USER_AGENT` 시크릿 필수, 초당 10회 |
| openFDA drugsfda | 공식 | 임상 결과·PDUFA 일정 없음 |
| Stooq 일봉 CSV | 비공식·무료 | EOD |
| Yahoo Finance chart | 비공식·무료 | 지연, 분/시간봉 제공. `PRICE_PROVIDERS`에서 제외 가능 |

미연결: FINRA 공매도 잔고(다음 단계), 컨센서스 추정치·대차수수료(유료 — 승인 필요), Claude API 기반 서술 분석(키는 Worker secret으로만).

## 구조

```
apps/web/src/          React UI (pages/, components/, lib/)
apps/api/src/handler.ts  API 라우터 (Worker와 Pages Functions 공용)
apps/api/src/index.ts    독립 Worker 엔트리 (apps/api/wrangler.toml)
functions/api/[[path]].ts Pages Functions 엔트리 → 같은 도메인의 /api/*
packages/analysis/     순수 분석 모듈 (indicators, sec, market, scoring) + .d.mts 타입
tests/                 node:test 단위·API 통합 테스트 (상류 API는 fetch 목으로 대체)
supabase/migrations/   스키마 + RLS
```

### API

`GET /api/v1/health` · `/api/v1/search?q=` · `/api/v1/bars/{SYMBOL}?tf=5m|1H|1D|1W` · `/api/v1/analyze/{SYMBOL}` · `/api/v1/screen?symbols=A,B` · `/api/v1/sec/filings/{CIK|SYMBOL}?limit=&forms=` · `/api/v1/sec/facts/{CIK}` · `/api/v1/sec/submissions/{CIK}` · `/api/v1/fda?q=` · `POST /api/v1/tv/webhook` · `/api/v1/tv/alerts` (키 필요)

## 로컬 실행

Node.js 22.18+ 필요.

```bash
npm install
npm test            # 49 tests
npm run typecheck
npm run build
npm run dev         # UI만 (API 없으면 SIMULATED 모드)
# API 포함:
echo 'SEC_USER_AGENT="AlphaTerminal/0.3 you@example.com"' > .dev.vars
npm run dev:pages   # wrangler pages dev — UI + /api 를 함께 서비스
```

## Cloudflare Pages 배포

**방법 A — Git 연동 (토큰 불필요, 권장)**
1. Cloudflare 대시보드 → Workers & Pages → Create → Pages → Connect to Git → `kjs92525-stack/alpha-terminal`
2. Build command `npm run build`, Output `dist`, 환경변수 `NODE_VERSION=22`
3. Settings → Variables and Secrets: `SEC_USER_AGENT`(Secret) = `AlphaTerminal/0.3 your@email` (나머지 vars는 `wrangler.toml`에 있음)
4. `functions/` 폴더가 자동으로 `/api/*`로 배포됩니다.

**방법 B — GitHub Actions**: 저장소 Secrets에 `CLOUDFLARE_API_TOKEN`(Pages 편집 권한), `CLOUDFLARE_ACCOUNT_ID`를 넣으면 `main` 푸시 시 `.github/workflows/deploy-pages.yml`이 배포합니다(없으면 건너뜀). 이후 `wrangler pages secret put SEC_USER_AGENT --project-name alpha-terminal`.

Cloudflare 무료 플랜은 요청당 서브요청 50개 제한이 있어 스크리너는 4종목씩 나눠 호출합니다(`SCREEN_MAX=5`).

## Supabase (선택)

1. 프로젝트 생성 후 `supabase/migrations/*.sql` 적용 (SQL Editor 또는 `supabase db push`)
2. Pages 빌드 환경변수 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 설정 → 재빌드
3. "데이터 연결" 메뉴에서 이메일 매직 링크 로그인 → 관심종목 동기화

service_role 키는 브라우저에 절대 넣지 마세요.

## 검증 상태 (2026-10-12)

- ✅ 단위·통합 테스트 49개 통과, TypeScript 검사, 프로덕션 빌드, Wrangler 번들(Pages Functions + Worker)
- ✅ 헤드리스 Chromium에서 전체 화면(데스크톱·모바일) 렌더링 확인 — API는 실제 핸들러, 상류 응답은 합성 픽스처
- ⚠️ 실제 SEC/Stooq/Yahoo/openFDA 호출은 개발 환경 네트워크 정책으로 차단되어 **실서버 검증 전**입니다. 배포 후 `/api/v1/health`, `/api/v1/analyze/AAPL`로 확인하세요.
