# TradingView 연동

TradingView에는 시세 데이터 API가 없어서 분석용 데이터 공급원으로는 쓰지 않습니다. 대신 아래 3가지를 공식 기능으로 연동합니다.

| 기능 | 파일 | 요구 사항 |
|---|---|---|
| 알림 웹훅 → 공시·위험 맥락 → 텔레그램 | `apps/api/src/tradingview.ts` | TradingView 유료 플랜(웹훅), `TV_WEBHOOK_SECRET` |
| ALPHA 구조 신호 Pine Script | `alpha_structure.pine` | 없음 |
| 차트 위젯 | `apps/web/src/components/TradingViewWidget.tsx` | 없음 |

## 1. 서버 설정 (Cloudflare Pages)
1. Settings → Variables and Secrets
   - `TV_WEBHOOK_SECRET`: 긴 무작위 문자열 (예: `openssl rand -hex 24`)
   - (선택) `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
2. (선택, 알림 기록 보관) KV 네임스페이스 생성 후 Pages → Settings → Bindings에 `ALERTS` 이름으로 연결. 없으면 텔레그램 전송만 동작합니다.
3. 웹 앱의 **TradingView 연동** 메뉴에서 상태가 모두 "설정됨"인지 확인.

## 2. TradingView 알림 설정
- 알림 → Notifications → **Webhook URL**: `https://<배포 도메인>/api/v1/tv/webhook`
- 메시지(JSON):
```json
{"secret":"<TV_WEBHOOK_SECRET>","symbol":"{{ticker}}","exchange":"{{exchange}}","interval":"{{interval}}","signal":"MY_ALERT","price":{{close}},"bar_time":"{{time}}","message":"자유 문구"}
```
- 일반 텍스트 메시지도 가능: URL에 `?key=<시크릿>`을 붙이고 메시지를 `AAPL 돌파`처럼 티커로 시작.

## 3. Pine Script
Pine Editor에 `alpha_structure.pine`을 붙여넣고 차트에 추가. 지표 설정의 *Webhook secret*에 시크릿 입력 후, 알림 조건을 **ALPHA STRUCT → Any alert() function call**로 하나만 만들면 BOS/CHoCH(선택 시 FVG)가 봉 마감 시 자동 전송됩니다.

규칙은 `packages/analysis/indicators.mjs`와 같습니다: 스윙은 오른쪽 N봉 마감 후 확정, 구조 돌파는 종가 기준, 알림은 봉 마감 시 1회.

## 보안
- 시크릿은 알림 본문 또는 URL로만 전달됩니다(TradingView는 헤더를 지원하지 않음). HTTPS만 사용하세요.
- 서버는 시크릿을 저장하거나 텔레그램으로 보내지 않습니다. 같은 알림은 24시간 동안 중복 처리하지 않습니다.
- 알림 목록 조회(`GET /api/v1/tv/alerts`)도 같은 시크릿(`X-Alpha-Key` 헤더)이 필요합니다.

## 검증 상태
- 웹훅: 단위·통합 테스트(인증, 파싱, 중복, 백그라운드 분석, 텔레그램, 가격 불일치) 통과.
- Pine Script: 외부 Pine 컴파일러(TextToQuant)로 문법 검증 통과. **TradingView 실제 차트에서는 아직 실행해 보지 않았습니다** — 첫 적용 시 오류가 나면 메시지를 알려주세요.
