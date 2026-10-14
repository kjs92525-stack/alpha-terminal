# EARLY ALPHA v1

EARLY ALPHA finds small-cap business inflections independently of the existing chart/setup and cross-sectional ranking engines. It does not change their scores, recommendations, ledgers or APIs. Existing SEC/Alpaca/Finnhub caches are reused; news enrichment has its own bounded budget. The current universe covers US-listed common equities, including foreign issuers; it is not a US-domicile filter.

## Eligibility and model

Default universe: estimated market cap $100M–$2B, price >= $1, 20-session dollar volume >= $500K, 126 sessions of prices, recent close <= 4 calendar days old, 52-week high drawdown >= 20%. SPACs are excluded. A 63-session rally >50% or 21-session rally >30% is excluded; 63-session gains >20% receive a 10-point penalty. Market cap uses reported shares no more than 180 days old times adjusted close; splits and recent issues can distort this estimate. Undated vendor profile market caps are not silently substituted.

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

`EARLY_NEWS_MAX` (default 80, clamp 0–500) bounds **symbols** enriched per run. Up to 5 pages x100 news items per symbol over 90 days, throttled at 320ms between pages, with end bounded to the asOf day. Paginated windows still truncated after 5 pages remain `watch`. Priority is pre-news business score; candidates outside the budget retain explicit `not_checked` status. Existing setup news can provide provisional evidence but cannot promote them to candidate. This budget is separate from `SETUP_NEWS_MAX`; no setup prerequisite. All eligible companies are scored; no top-N cap hides them. Missing market-cap data is counted in scanned but cannot establish small-cap eligibility.

Set optional `EARLY_NEWS_MAX` in the nightly job env to tune cost; no new secret or paid API dependency is introduced. The regular schedule and `data` branch writer are unchanged. The publication guard now protects both existing and EARLY ALPHA dated ledgers. Do not manually run the feature branch against the production data branch before review/merge.

## New discoveries / tracking

`isNew` means the first `candidate` appearance in saved history, never first watch appearance or re-entry. Same-day reruns retain the original scores/evidence/cohort. Daily latest candidates and statistics match the frozen ledger, even if intraday re-fetches change inputs. Historic watch/exclusions remain in ledger URLs for audit.

Each symbol is tracked once at first discovery, entry at the next SPY session's adjusted open; exit at session 21/63/126 close. Exact date matching with SPY prevents suspended stocks being shifted to later entry dates. Returns, SPY excess, MFE (highest high vs entry) and MAE (lowest low vs entry) use the same window. Pending and missing/delisted symbols remain in the total denominator. Complete-case averages exclude missing observations and can have survivor bias; the UI reports missing counts explicitly. Adjusted history can change after corporate actions. Costs, slippage and tax are excluded. Cache retention (default 800 calendar days) may make old outcomes missing; longer retention is needed for a permanent full-price record. Small samples (<30 complete) carry a warning.

## UI / validation

`#early-alpha` adds a responsive dedicated workspace: candidate/new/watch/excluded tabs, search, factor breakdown, evidence links and provenance, risk warnings, last source collection time, stale-data warning, and first-discovery performance. Data errors and first-run empty states are explicit; no fake fallback stocks. Existing Research is accessible per ticker.

Validation: deterministic scoring, future-data rejection, hot-stock exclusion, news deduplication/LOI/nonbinding/negation handling, dilution/runway, incomplete data, immutable reruns, first discovery, exact benchmark-date matching, MFE/MAE, missing denominator, news budgets/pagination; existing full test suite, API/frontend typechecks and production build. Live API results require the repository's secrets and nightly execution after merge. Local tests use synthetic fixtures and do not assert today's live recommendations.
