# EARLY ALPHA v1

EARLY ALPHA finds small-cap business inflections independently of the existing chart/setup and cross-sectional ranking engines. It does not change their scores, recommendations, ledgers or APIs. Existing SEC/Alpaca/Finnhub caches are reused; news enrichment has its own bounded budget. The current universe covers US-listed common equities, including foreign issuers; it is not a US-domicile filter.

## Eligibility and model

Default universe: estimated market cap $100M–$2B, price >= $1, 20-session dollar volume >= $500K, 126 sessions of prices, recent close <= 4 calendar days old, 52-week high drawdown >= 20%. SPACs are excluded. A 63-session rally >50% or 21-session rally >30% is excluded; 63-session gains >20% receive a 10-point penalty. Market cap uses reported shares no more than 180 days old times adjusted close; splits and recent issues can distort this estimate. When reported shares are unavailable, dated Finnhub profile shares collected on/before asOf and <=45 days old can estimate size for watch screening. The collection date, method and warning are displayed; these rows can never become confirmed candidates. Future/undated/stale collections remain excluded.

Absolute, explainable score (not upside/probability):

| Factor | Maximum | Rule |
|---|---:|---|
| Revenue growth / acceleration | 30 | Latest quarterly YoY >=15%: 10; positive growth accelerating >=5 percentage points vs preceding quarter: 20 |
| Profitability inflection | 25 | YoY loss to profit: 25; loss narrows >=35%: 15; positive earnings grow >30%: 10; mutually exclusive |
| Catalyst | 10 | Explicit award/signing of contract or first commercialization/FDA approval in linked headline; provisional, not official verification |
| Neglect proxy | 15 | 63-session return <=15% and high drawdown >=30% |
| Value gap proxy | 10 | Improving business and reported annual/TTM revenue >0, market-cap/revenue <=3; not industry fair value |
| Base | 10 | No new low in latest 21 of 63 sessions, average volume declining |

Penalties: 12-month dilution filings or 90-day offering news -15; shares YoY >10% -10; cash runway <12 months -15; price rally above -10. Runway <6 months or distress/critical filings exclude. A shelf registration does not imply completed issuance. The cached SEC filing window is finite: an unexpired older shelf/warrant can be missed. Outstanding warrant counts, exercise prices, ATM capacity and convertible terms require document review and are not invented.

`candidate`: eligible, score >=40, actual revenue/profitability inflection, fresh reported quarter (<=200 days), fresh cash-flow safety data, recent SEC collection and successful complete news request. `watch`: eligible with incomplete checks or only provisional catalysts. `excluded`: ineligible or no business/catalyst evidence. First-commercialization candidates without financial proof remain visible in watch, rather than being represented as confirmed investments. A lack of evidence never means low dilution risk.

The engine scores financial *reported* points with filing date and period <=asOf. It ignores later accepted filings and future news/bars. The current compact companyfacts cache can discard older restatement versions: it is unsuitable for retrospective backtests. This feature only starts a forward record from deployment; no fabricated past performance.

## Pipeline / outputs

`packages/analysis/early-alpha.mjs`: pure independent scoring and evidence.
`packages/pipeline/early-alpha.mjs`: bounded paginated news enrichment, immutable daily records and forward outcomes.
`runNightly` invokes the engine after existing output publication, catches feature-specific failures, writes a failure status and preserves other products. UI checks `status.json` to avoid displaying stale successful results as a fresh failed run.

- `early-alpha/latest.json`: frozen daily research results + live forward-performance summary.
- `early-alpha/status.json`: publication date / success status.
- `early-alpha/ledger/YYYY-MM-DD.json`: entire candidate/watch/excluded research record, with score components, reasons, dated financial/news/filing evidence, risks, firstSeen, isNew; never overwritten.
- `early-alpha/index.json`: dated ledger links and first-candidate dates.
- `early-alpha/performance.json`: first-discovery outcomes; 21/63/126 SPY trading sessions.

`EARLY_NEWS_MAX` (default 80, clamp 0–500) bounds **symbols** enriched per run. Up to 5 pages x50 news items per symbol over 90 days, throttled at 320ms between pages, with end bounded to the asOf day. Paginated windows still truncated after 5 pages remain `watch`. Priority is pre-news business score; candidates outside the budget retain explicit `not_checked` status. Existing setup news can provide provisional evidence but cannot promote them to candidate. This budget is separate from `SETUP_NEWS_MAX`; no setup prerequisite. All eligible companies are scored; no top-N cap hides them. Missing market-cap data is counted in scanned but cannot establish small-cap eligibility.

Set optional `EARLY_NEWS_MAX` in the nightly job env to tune cost; no new secret or paid API dependency is introduced. The regular schedule and `data` branch writer are unchanged. The publication guard now protects both existing and EARLY ALPHA dated ledgers. Do not manually run the feature branch against the production data branch before review/merge.

## New discoveries / tracking

`isNew` means the first `candidate` appearance in saved history, never first watch appearance or re-entry. Same-day reruns retain the original scores/evidence/cohort. Daily latest candidates and statistics match the frozen ledger, even if intraday re-fetches change inputs. Historic watch/exclusions remain in ledger URLs for audit.

Each symbol is tracked once at first discovery, entry at the next SPY session's adjusted open; exit at session 21/63/126 close. Exact date matching with SPY prevents suspended stocks being shifted to later entry dates. Returns, SPY excess, MFE (highest high vs entry) and MAE (lowest low vs entry) use the same window. Pending and missing/delisted symbols remain in the total denominator. Complete-case averages exclude missing observations and can have survivor bias; the UI reports missing counts explicitly. Adjusted history can change after corporate actions. Costs, slippage and tax are excluded. Cache retention (default 800 calendar days) may make old outcomes missing; longer retention is needed for a permanent full-price record. Small samples (<30 complete) carry a warning.

## UI / validation

`#early-alpha` adds a responsive dedicated workspace: candidate/new/watch/excluded tabs, search, factor breakdown, evidence links and provenance, risk warnings, last source collection time, stale-data warning, and first-discovery performance. Data errors and first-run empty states are explicit; no fake fallback stocks. Existing Research is accessible per ticker.

Validation: deterministic scoring, future-data rejection, hot-stock exclusion, news deduplication/LOI/nonbinding/negation handling, dilution/runway, incomplete data, immutable reruns, first discovery, exact benchmark-date matching, MFE/MAE, missing denominator, news budgets/pagination; existing full test suite, API/frontend typechecks and production build. Live API results require the repository's secrets and nightly execution after merge. Local tests use synthetic fixtures and do not assert today's live recommendations.

Release activation: a main push affecting the EARLY ALPHA engine or nightly workflow refreshes the full cached universe immediately. The release run sets FINNHUB_MAX_CALLS=0 to reuse the latest collected fundamentals; scheduled/manual runs retain 1500 calls. If SEC is blocked, profile-size watch candidates remain visible with incomplete-dilution warnings, and the initial UI opens the watch tab when no confirmed candidates exist.

News requests use the official Alpaca page limit of 50 (https://docs.alpaca.markets/us/reference/news-3). A same-day successful retry of failed news checks refreshes evidence only in latest.json with enrichmentStatus; scores/status/cohorts remain immutable until the next dated ledger. Original failed checks remain auditable in the ledger; latest enrichment request/failure counters are separate.

## Business stories

The story reader leads with business changes, a conditional revaluation hypothesis, the next event to verify, and failure/funding risks. Scoring, raw evidence and full warnings are closed dossiers by default; mobile presents the story first with a company picker. Financial evidence deduplicates the same period/value/source and retains two recent comparisons per signal; nonfinancial risk evidence remains available.

`packages/analysis/early-story.mjs` automatically summarizes every row from each daily snapshot without modifying scores or discovery cohorts. Company-specific business connections are separately reviewed in `early-context.mjs`: initial coverage FF, KOPN, ICHR, KODK, ARVN, with company-issued links, publication and review dates. These editorial contexts are not generated by the nightly pipeline. Uncovered companies explicitly show business-context verification pending. No sector label alone creates a war/policy/AI demand claim. Headline-only items remain unverified. Future publications, contexts more than 120 days old, or new financial disclosures after review fall back to conservative automatic summaries until reviewed again. Reviewed interpretations remain hypotheses, never completed contracts or guaranteed reratings.

## Investment review release (v2)

The card and Research page include a decision dossier: repeatable earnings, reported liquid funds vs restricted cash, dilution and senior claims, contract realization, market skepticism, confirmation/invalidation events and price requirements. Initial primary-source period coverage is FF, KOPN, ICHR, KODK and ARVN Q2 2026, in financial-review.mjs. Unknown companies and later quarters retain explicit verification gaps. These are reviewed source facts, not a complete securities audit. Reviewed cash is displayed separately from automated financials, whose cash periods can lag. Restricted cash is excluded; prospective Finnhub ingestion no longer uses combined restricted-cash concepts as unrestricted cash.

Known nonrecurring profits cap profitability points (FF/KOPN/ARVN: zero, KODK: 10). KOPN's grant-led total growth is capped at 10, ARVN's licensing/milestone-driven growth at zero. Unreviewed profitability awards at most 10. ICHR's completed ATM carries a sourced -15 penalty, without doubling an existing dilution penalty. These rules are bounded to the public reviewed reporting period and expire on new financial periods. Scores are research priorities, not confidence or upside. Model v2 refreshes current display scores on a v1 same-day ledger but never changes the immutable original record, discovery cohort or performance. Same-model reruns remain frozen; revisions do not create NEW flags. Every valuation verdict currently remains incomplete because fully diluted shares, complete senior claims and defensible valuation ranges are not available.

Price sensitivity is reverse earnings: current common-equity capitalization x (1 + assumed future share-count increase) / hypothetical P/E. Multiples/dilution are explicit illustrative assumptions, not peer comparisons or price targets; issuance proceeds and business changes must be assessed separately. Cash is not added again to this equity calculation. ARVN uses a program/contract cash-flow framework and does not receive a generic P/E valuation. Mock Research data cannot issue an investment verdict.

Quarter derivation now uses explicit duration instead of magnitude to distinguish annual and quarterly data, allowing annual profits with loss-making Q4. Missing durations stay missing. Consecutive acceleration requires adjacent and strictly rising growth rates. Validation includes one-off caps, restricted cash, future/stale reviews, reverse-earnings math, model-revision ledger immutability, loss-making Q4, missing/nonmonotonic quarters and mobile dossier/accordion behavior.

## World context and sector radar

EARLY ALPHA and Discover include a sector story radar; Research and reviewed company cards include world/industry-to-earnings transmission paths. Initial primary-source coverage is grid/data-center electrical and cooling infrastructure, semiconductor equipment/components, and drones/military optics. Related business links: POWL/NVT, ICHR/UCTT, KOPN/AVAV. Existing FF/KODK/ARVN stories receive policy/input-cost/capital-environment context with conditional interpretation, never a fabricated war/Fed benefit.

The nightly job writes sector-radar.json from actual ETF phases and six companies' collected price/market-cap data. Industrial forecasts do not override ETF phase: LEADING/LATE explicitly are not price-cycle entry; NEUTRAL/DOWN remain unconfirmed. Proxy ETFs are broad and do not represent an identical subindustry. Related companies are selected from reviewed business disclosure, not inferred from return correlation. Large caps, microcaps, stale/missing quotes and prior sharp rallies retain visible warnings. Quotes use dated adjusted closes and estimated caps; no fair value is inferred.

Source facts and interpretations are dated and expire: sector sources 180/365 days, company links 180 days. Unknown businesses get no invented supply-chain link. The sector/company source library is editorial; daily automatic updates cover prices/phase and warnings, not new primary-source deep verification. Before the first radar snapshot, UI derives phases from sectors.json and explicitly leaves company quotes missing. Existing correlation-only SectorCycle candidates are labelled price-linked chart candidates.

### 기업별 투자 논리 전문

FF·KOPN·ICHR·KODK·ARVN은 점수보다 사업 논리를 먼저 읽도록 기업별 전문을 제공합니다. 산업 수요가 주문·납품·현금으로 이어지는 경로, 확인된 사실과 조건부 해석, 낙관론과 반론, 현재 시총이 요구하는 가상 정상 이익, 다음 판단 조건을 연결합니다. 실제 시장 할인 원인을 조사한 것처럼 표현하지 않습니다. 원문·보고기간·편집 검토일과 경쟁력·계약·가치 검증의 공백을 표시합니다.

현재 시총/15는 추가 희석이 없는 가상의 P/E 15배 역산 예시이며 이익 전망·적정 배수·목표가가 아닙니다. ARVN은 임상/계약별 현금흐름 프레임을 사용합니다. 오래된 가격의 역산은 보류하며 새 보고기간·후속 재무 공시·편집 유효기간 종료·데모 모드에서는 전문을 표시하지 않습니다. 기타 자동 발굴 종목에는 기업 스토리 검증 대기를 명시합니다. 전 종목 자동 심층 분석이나 매수 검증 완료를 뜻하지 않습니다.

### 제품 수요를 만드는 구체적 원리

기업 전문과 섹터 연결 기업은 `demand-stories.mjs`의 원문 기반 설명을 함께 사용합니다. 산업 변화가 만든 고객 문제 → 해당 제품의 기능 → 실제 채택 근거와 미확인 경쟁력 → 주문·마진·현금 전환을 문장으로 설명합니다. 예를 들어 ICHR는 식각·증착의 가스 제어, KOPN은 드론 영상과 주변 시야, NVT는 랙 전력 밀도와 냉각 부담을 연결합니다. AI 성능 향상과 발열을 항상 같은 것으로 취급하지 않습니다.

기술의 필요성을 독점력·가격 결정력으로 확대하지 않으며, 회사 제품 주장을 독립 검증된 효능으로 표시하지 않습니다. 기존 제품의 효용은 최근 성장의 입증된 원인이나 신규 촉매와 구분합니다. 제품 설명의 원문 날짜를 표시하고 기준일 이후의 자료·180일을 초과한 최신 근거는 숨깁니다. 섹터 스냅샷 발행 시각과 별도로 검토된 제품 설명을 클라이언트에서 읽으므로 문장 수정은 웹 배포 즉시 반영되며 가격·점수·원장 계산은 변경하지 않습니다.

### v3 검토 수정 (2026-10-14)

* 52주 고점에서 20% 하락은 필수 자격에서 제거합니다. 급등 제한과 시총·거래대금·이력·시세 신선도 조건은 유지하며, 횡보 기업도 사업 변화를 평가합니다. 매출 성장률 15% 이상이면서 직전 양의 성장률보다 가속될 때 가속 점수를 부여합니다. 감소 기저에서 +1%로 회복한 경우는 가속 가점에서 제외합니다.
* ETF 가격 국면 `price-cycle-v2`는 저점 반등 40% 초과, 200일선 이격 15% 초과, 3개월 30% 초과 상승을 가격 초입에서 제외합니다. 200일선 위 5~63거래일의 전환 지속성을 확인하며, 그보다 오래 진행된 상승은 구분합니다. 약세·상대강도 악화를 중립 ‘숨고르기’로 표시하지 않습니다. 주봉 RSI는 실제 주별 집계로 계산합니다. 이는 검증된 상승 확률이나 산업 실물 경기의 측정 결과가 아닙니다.
* 산업 화면은 가격 국면과 분리된 원문 수주·잔고·전망 및 연결 기업의 보고 매출 추이를 표시합니다. 수주 증감·재고·가동률·정상 마진의 충분한 시계열이 없어 정량 산업 사이클은 ‘부분 근거 / 방향 미판정’으로 표시합니다. 단일 계약, 설비 계획, ETF 상승을 회복 확정으로 바꾸지 않습니다.
* SEC 조회가 실패하면 예산 내에서 Finnhub `/stock/filings`의 1년 범위 목록을 별도로 조회합니다. 목록 수집은 본문·워런트·전환 조건 검증과 구분하며, 401/403 시 해당 실행의 추가 조회를 중단하고 실패를 표시합니다. 프로필 시총·목록 수집만으로 검증 후보를 승격시키지 않습니다. 뉴스 예산의 40%는 점수 우선, 나머지는 조회가 오래된 이름을 순환해 동일 상위 종목만 반복 조회하는 편향을 줄입니다.
* 사업 신호 연구 후보는 별도의 `early-alpha/research-ledger/`에 처음 기록하고 신규·성과를 전향 추적합니다. 원문/희석 검증 대기 단계이며 기존 `early-alpha/ledger/` 검증 후보·원장과 섞지 않습니다. 두 원장은 같은 날짜 재실행으로 수정하지 않습니다. 기록 시각이 미국 정규장 시가 이후라면 이미 지난 시가에 진입하지 않으며 NY 서머타임을 반영합니다. 과거 백테스트·비용 반영된 실전 전략 검증을 뜻하지 않습니다.
* 일회성 이익·매출로 가점을 제한한 결과를 자동 요약과 스토리 추천 보너스에도 전달합니다. 미래 뉴스·나중 제출한 분기는 점수와 요약에서 제외합니다.
* 가치 도구는 직접 입력한 정상 연간 매출·순이익률·P/E·주식 수 증가 가정으로 보수/기준/낙관 주당 가치와 안전마진을 계산합니다. 자동 이익 전망·검증된 적정 배수·매수 판정이 아닙니다. ARVN에는 일반 P/E 틀을 적용하지 않습니다. 계좌 계획은 총자산·사용 가능 현금·진입/손절·보유 기한·기존 손절 위험·같은 산업 노출·유동성 한도를 함께 계산합니다. 예시 비율은 권장 비중이 아니며 갭 스트레스와 실제 손실 초과 가능성을 표시합니다.

자금 안전성 판정에는 200일 이내 현금흐름 보고를 요구하고, SEC 목록과 뉴스의 교차 확인에는 3일 이내 수집본만 사용합니다. 오래된 양의 현금흐름이나 한 달 전 목록으로 최근 증자 위험을 해소하지 않습니다.
