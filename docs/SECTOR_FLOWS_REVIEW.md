# Sector capital-flow review — 2026-10-15

The discovery page now separates reported fund subscriptions from price-cycle labels. The reviewed report covers 2026-10-05 through 2026-10-09, not the current session. Seeking Alpha's October 13 TradingView article attributes the eleven SPDR sector ETF figures to ETF Database. We could read the article but ETF Database blocked direct historical verification. The UI explicitly labels this secondary report and incomplete original-series reconciliation. Dollar inflows are not normalized by AUM, cover one ETF per sector, and do not measure all institutional demand or prove purchases in individual companies.

The snapshot expires after October 20. Future/unreviewed and expired snapshots expose no ranked rows. No daily refresh is claimed. ETF price/cycle data continues to come from the existing nightly sectors snapshot with an independent four-calendar-day guard and future-date rejection. A price gain, turnover, or AUM growth never substitutes for subscriptions. No new pipeline source, secrets, recommendation score, ledger, or performance record changes.

Four expandable stories cover technology, energy, communication services, and utilities. Each distinguishes source observations/forecasts from conditional demand-to-cash economics, names failure conditions and unresolved valuation checks, and links primary business/industry evidence. Examples are business relationships, not assertions of ETF holdings or current buy candidates. Other sectors remain visible as reported flows without fabricated deep analysis. In particular, the energy discussion includes demand destruction; utility demand requires regulatory and financing translation; AI performance is not assumed to mechanically raise total power consumption.

Primary sources read: EIA October 2026 STEO (October 6 PDF); IEA October 2026 OMR (October 14); Vertiv March 30 cooling-capacity announcement (planned Q2 2027 commissioning); Alphabet Q2 2026 10-Q (SEC filing date July 23, period June 30). Business stories are reviewed prose, not dynamically generated claims.

Validation: report expiry/future guards, ranking, no price-to-flow substitution and causal-story completeness tests; full repository tests, TypeScript and production build; browser checks at 390 and 1440 pixels for expansion, bottom collapse, no horizontal overflow, preserved early-discovery/legacy tabs and readable order-block legend.

## Daily collection feasibility — 2026-10-15 (not implemented)

No daily collector was added. The reviewed weekly snapshot (valid through October 20) stays as is, and ranked rows still disappear after expiry.

The most consistent candidate source is the issuer's daily fund data: shares outstanding × NAV. A day's net flow ≈ (today's shares − yesterday's shares) × today's NAV. All eleven SPDR sector ETFs come from one issuer (State Street), so period, unit and method can be kept identical across sectors.

Not verified: this work environment's network policy blocks both the issuer site and ETF Database, so the file format (spreadsheet or not, column names, holiday handling) and access from GitHub Actions are unconfirmed. A parser written against a guessed format could publish silently wrong numbers, so it was deferred.

Requirements for an implementation: rank only when all eleven funds are collected for the same date, otherwise mark the day missing; store the last successful collection time and the period; never substitute price, turnover or AUM growth for share-count changes; flag share-count jumps from splits or consolidations for review.

Next step: an Actions job that downloads and archives the issuer files verbatim, to confirm the format before building the calculator.
