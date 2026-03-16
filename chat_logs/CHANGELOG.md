# Changelog

All significant changes to the backtesting platform are documented here. See individual files in `/docs/changelogs/` for detailed information on each change.

## 2026-03-12: Unified Equity Display and Scroll Fix

**File**: `/docs/changelogs/2026-03-12-163000-unified-equity-display-scroll-fix.md`

Fixed critical UI consistency issues in paper trading dashboard. Unified real-time equity display across sidebar and detail view using a centralized Zustand store (`realtimeEquityStore.ts`), added live equity points to equity charts, fixed funding payment visibility in event history (added `funding_payment` case to SSE handler), and corrected layout scrolling by changing App.tsx from `min-h-screen` to `h-screen overflow-hidden` for independent panel scrolling.

**Key changes**:
- New `realtimeEquityStore.ts` as single source of truth for live equity data
- `useSessionEquity()` hook consumed by sidebar and detail view
- `PaperEquityChart` now accepts `realtimePoint` prop for live equity visualization
- Funding payments now trigger cache invalidation in SSE event handler
- Layout supports independent scrollable panels with fixed header

---

## 2026-03-10: Strategy Configurations Feature

**File**: `/docs/changelogs/2026-03-10-130000-strategy-configurations.md`

Introduced StrategyConfig as a first-class entity with SHA256 content-address deduplication. System now stores each unique (strategy_name, symbol, timeframe, params) combination once and references it across backtest runs, paper trading sessions, and optimization results. Removed spot/futures mode distinction — all trading is now futures-based with spot behavior via 1x leverage. Added 7 new API endpoints for config CRUD, new "Configurations" UI page with strategy/aggregation browser, and RunBacktestModal for reusing configs.

**Key changes**:
- `strategy_configs` table with content_hash UNIQUE constraint and 381-config backfill migration
- `backtest_runs` now links via strategy_config_id; denormalized run-level fields (initial_capital, exchange, start_date, end_date)
- `aggregation_configs` restructured with sub_strategy_config_ids array; mode column removed
- `paper_sessions` and `optimized_params` gain strategy_config_id FK
- 7 REST endpoints for config management (CRUD, versions, run/paper linking)
- New "Configurations" UI page with Strategies/Aggregations tabs, detail panel, metrics display
- RunBacktestModal for creating/reusing configs with immediate/deferred execution option

---

## 2026-03-05: HF Scalping Investigation — Comprehensive Results & No Viable Edge Found

**File**: `/docs/changelogs/2026-03-05-193000-hf-scalping-research.md`

Extensive investigation into high-frequency scalping strategies (1m, 5m, 15m timeframes) concluded with **no viable edge found**. Implemented 3 new scalping strategies (FR Epoch Scalper, BB-RSI Scalper, OI-Delta Regime Scalper) with full backtest infrastructure. Key finding: **fee-to-move ratio makes 1m scalping mathematically impossible with 0.06% taker fees**. Only marginal viability on 5m/15m for specific symbols (OI-Delta on SOL/ARB showed +3-4%), and overfitting confirmed (BB-RSI +17% on DOGE alone, losses on all others). Best proven edge remains FR V2 on 4h timeframe.

**Key results**:
- FR Epoch Scalper (1m): -26% worst case, FR edge too weak at 1m
- BB-RSI Scalper (1m): -97% (fee death), impossible fees-to-move ratio
- BB-RSI Scalper (5m): +17.52% on DOGE (overfits), -4% to -11% on BTC/ETH/SOL/ARB
- OI-Delta Regime Scalper (15m): +3-4% on SOL/ARB (real edge), fails on DOGE
- Walk-forward FR V2: 6 symbols in progress, IOST passed with 26.6% degradation

---

## 2026-03-01: Fix Chart Real-Time Updates When Session Paused

**File**: `/docs/changelogs/2026-03-01-160000-fix-chart-realtime-when-paused.md`

Fixed paper trading price chart not updating in real-time when session is paused/stopped. Stabilized `endRounded` value in PaperTradingPage to prevent React Query cache key changes on WebSocket ticks. Updated Chart component to use TradingView's `update()` method for incremental candle updates instead of `setData()` which was resetting zoom/scroll position.

**Key fixes**:
- Chart continues real-time updates regardless of session status (running/paused/stopped)
- WebSocket ticks no longer trigger React Query refetches
- Chart zoom/scroll position preserved during updates
- TradingView `update()` method properly handles new bar appends

---

## 2026-02-26: Paper Trading System Implementation

**File**: `/chat_logs/2026-02-26-160000-paper-trading-system.md`

Implemented comprehensive paper trading system for running live multi-asset strategies in parallel with backtesting. Includes tick-based execution engine mirroring backtest architecture, real-time Bybit data ingestion, Telegram notifications, PostgreSQL persistence, and full React UI with equity charting. 115 new tests ensure robustness of capital management and order execution.

**Key additions**:
- Paper trading engine with tick loop, signal processing, funding rate handling
- SessionManager singleton for lifecycle control and auto-restore on crash
- 11 REST API endpoints for CRUD and real-time SSE updates
- React components for session management, live metrics, equity charting
- Telegram notifications for trade events and daily summaries
- Production-ready Docker + PM2 + Nginx + PostgreSQL stack
- 115 tests covering engine, positions, funding, persistence, and notifications

---

## 2026-02-23: Expanded FR-Spike Scan and Aggregations

**File**: `/docs/changelogs/2026-02-23-160000-expanded-fr-spike-scan-and-aggregations.md`

Expanded funding-rate-spike strategy from 26 to 74 Bybit symbols. Batch scanned 148 runs, discovered 10 new profitable assets, validated 4 with walk-forward testing. Created 6 aggregation portfolio configs with best Sharpe of 2.31. Results saved to database.

**Key achievements**:
- 74 Bybit symbols with 2-year candle + funding rate data
- 56/120 qualifying runs profitable (47%)
- Top performer: ADA 1h (Sharpe 1.56)
- 4 WF-validated assets (ETC 1h improved 86% OOS!)
- Production-ready portfolio configs saved to DB

---

## Previous Work

See `/docs/changelogs/` for all historical changes.
