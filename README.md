# ALPHA TERMINAL — MVP 0.1

React + TypeScript + Vite investment research terminal with 3 equal pillars: stock discovery, advanced chart analysis, and event radar.

**Important: all displayed instruments SIM01–SIM06, prices, scores and events are synthetic demo data. Not financial advice. No live prices, recommendations or AI/SEC feed are connected in this build.**

## Run locally

Prerequisites: Node.js 22+ and npm, internet for the initial dependency install.

```bash
npm install
npm run dev
```

Open http://localhost:5173. Build with `npm run build`; test indicator algorithms with `npm test`.

## Features currently implemented
- Dark responsive terminal; dashboard, scanner, charts, event radar, research, strategy sections.
- Search, filters, ticker synchronization across panels, favorites persisted to localStorage.
- Lightweight Charts candlesticks and volume; 1/2/4-panel layouts; EMA/VWAP overlays.
- Deterministic technical indicators: SMA, EMA, RSI, ATR, OBV, VWAP, FVG, swing points, BOS/CHoCH heuristic.
- Synthetic seeded OHLCV generator, transparent mock status.
- SEC Worker API scaffold and Supabase SQL migration included, **not connected by default**.

## Not yet implemented
- Real exchange prices, real company fundamentals, production-grade ranking or real AI reports.
- Real-time alerts, official FDA/clinical feeds, comprehensive dilution parsing, order-book / short-borrow data.
- Historical point-in-time backtests, live authenticated persistence, automatic deployment.

## Architecture

- `apps/web/src`: React UI and TradingView Lightweight Charts integration.
- `packages/analysis/indicators.mjs`: pure deterministic analytics (unit-tested).
- `apps/api/src/index.ts`: Cloudflare Worker for SEC company submissions with cache and rate-limit guidance.
- `supabase/migrations`: database tables and per-user RLS.
- `docs/`: PRD, API contract, rollout plan.

## Cloudflare Pages
Build command: `npm run build`, output directory: `dist`. `VITE_DATA_MODE=mock` until backend credentials and licensing are ready. Worker must be deployed separately and connected through a route or configured API base. Do not put provider API keys in `VITE_*` variables.

## Official SEC filings panel (optional, real data)

The **Event Radar** page includes a separate, clearly marked SEC EDGAR filing lookup panel. The panel remains disabled until the SEC proxy Worker is deployed and `VITE_API_BASE_URL` points to it. Presets are Apple, Microsoft, NVIDIA and Amazon; CIK input is also supported. The rest of the application remains synthetic.

1. Deploy `apps/api` as a separate Cloudflare Worker using Wrangler.
2. Configure `SEC_USER_AGENT` with a truthful application name and contact email using `wrangler secret put SEC_USER_AGENT` (never in the browser).
3. Set `ALLOWED_ORIGIN` to your Cloudflare Pages origin when deployed publicly.
4. Set `VITE_API_BASE_URL` in the Pages build environment to the deployed Worker URL, rebuild the frontend.
5. Visit Event Radar and press **공식 공시 조회**. Results link to original SEC EDGAR filings.

API: `GET /api/v1/sec/filings/{CIK}?limit=15`, `GET /api/v1/sec/submissions/{CIK}`, `GET /health`.

The SEC API can be delayed and is subject to fair-access limits; caching is enabled. A filing appearing in this feed is **not** an AI recommendation.
